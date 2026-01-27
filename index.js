var dotenv = require('dotenv').config({ path: '/app/.env' });

var express = require('express');
var bodyParser = require('body-parser');
var cookieParser = require('cookie-parser');
var formatPick = require('./helpers/formatPick');
var viewHelpers = require('./helpers/view');
var navHelpers = require('./helpers/nav');
var { attachSession } = require('./middleware/auth');
var app = express();

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static('public'));
app.use('/js', express.static(__dirname + '/node_modules/popper.js/dist'));
app.use('/js', express.static(__dirname + '/node_modules/bootstrap/dist/js'));
app.use('/js', express.static(__dirname + '/node_modules/jquery/dist'));
app.use('/css', express.static(__dirname + '/node_modules/bootstrap/dist/css'));

// Block AI training crawlers
app.use(function(req, res, next) {
	var ua = req.get('User-Agent') || '';
	if (ua.includes('ClaudeBot') || ua.includes('GPTBot')) {
		return res.status(403).send('Bots not allowed');
	}
	next();
});

app.set('view engine', 'pug');

// Attach session to all requests
app.use(attachSession);

// Make user available to all templates
app.use(function(req, res, next) {
	res.locals.user = req.user;
	next();
});

// Make banner and navigation data available to all templates
var LeagueConfig = require('./models/LeagueConfig');
var Regime = require('./models/Regime');
var Franchise = require('./models/Franchise');
var Proposal = require('./models/Proposal');
app.use(async function(req, res, next) {
	try {
		var config = await LeagueConfig.findById('pso').lean();
		var currentSeason = config ? config.season : new Date().getFullYear();
		
		// Banner
		if (config && config.banner) {
			res.locals.banner = config.banner;
			res.locals.bannerStyle = config.bannerStyle || 'info';
		}
		
		// Get all franchises for rosterId lookup
		var franchises = await Franchise.find({}).lean();
		var franchiseById = {};
		franchises.forEach(function(f) {
			franchiseById[f._id.toString()] = f;
		});
		
		// Get all current franchises for sidebar navigation
		var regimes = await Regime.find({ 'tenures.endSeason': null })
			.populate('ownerIds')
			.lean();
		
		// Build nav franchises from active tenures
		var navFranchises = [];
		regimes.forEach(function(r) {
			r.tenures.forEach(function(t) {
				if (t.endSeason === null && t.startSeason <= currentSeason) {
					var franchise = franchiseById[t.franchiseId.toString()];
					navFranchises.push({
						rosterId: franchise ? franchise.rosterId : null,
						displayName: r.displayName
					});
				}
			});
		});
		navFranchises.sort(function(a, b) {
			return a.displayName.localeCompare(b.displayName);
		});
		res.locals.navFranchises = navFranchises;
		
		// Find current user's franchise (if logged in)
		if (req.user) {
			var userRegime = regimes.find(function(r) {
				return r.ownerIds && r.ownerIds.some(function(owner) {
					return owner._id.equals(req.user._id);
				});
			});
			if (userRegime) {
				var activeTenure = userRegime.tenures.find(function(t) { return t.endSeason === null; });
				if (activeTenure) {
					var userFranchiseDoc = franchiseById[activeTenure.franchiseId.toString()];
					res.locals.userFranchise = {
						rosterId: userFranchiseDoc ? userFranchiseDoc.rosterId : null,
						displayName: userRegime.displayName
					};
				}
			}
		}
		
		// Check if user is admin
		res.locals.isAdmin = req.session && req.session.user && req.session.user.admin;
		
		// For admins, count proposals awaiting approval
		if (res.locals.isAdmin) {
			var pendingApprovalCount = await Proposal.countDocuments({ status: 'accepted' });
			res.locals.pendingApprovalCount = pendingApprovalCount;
		}
		
	} catch (err) {
		// Silently ignore - navigation is non-critical, will fall back to empty
		console.error('Nav middleware error:', err);
	}
	next();
});

// Make helpers available to all templates
app.locals.formatPickDisplay = formatPick.formatPickDisplay;
app.locals.formatMoney = viewHelpers.formatMoney;
app.locals.formatRecord = viewHelpers.formatRecord;
app.locals.formatPoints = viewHelpers.formatPoints;
app.locals.formatScore = viewHelpers.formatScore;
app.locals.ordinal = viewHelpers.ordinal;
app.locals.formatContractYears = viewHelpers.formatContractYears;
app.locals.formatDateISO = viewHelpers.formatDateISO;
app.locals.formatDateTime = viewHelpers.formatDateTime;
app.locals.formatDateTimeLong = viewHelpers.formatDateTimeLong;
app.locals.formatDateLong = viewHelpers.formatDateLong;
app.locals.formatTime = viewHelpers.formatTime;
app.locals.deltaClass = viewHelpers.deltaClass;
app.locals.sortedPositions = viewHelpers.sortedPositions;
app.locals.getPositionIndex = viewHelpers.getPositionIndex;
app.locals.getPositionKey = viewHelpers.getPositionKey;
app.locals.shortenPlayerName = viewHelpers.shortenPlayerName;
app.locals.oxfordJoin = viewHelpers.oxfordJoin;
app.locals.formatPicksGrouped = viewHelpers.formatPicksGrouped;
app.locals.formatPartyAssets = viewHelpers.formatPartyAssets;
app.locals.summarizeTradeAssets = viewHelpers.summarizeTradeAssets;
app.locals.tradeOgTitle = viewHelpers.tradeOgTitle;
app.locals.tradeOgDescription = viewHelpers.tradeOgDescription;
app.locals.tradeOgPlainEnglish = viewHelpers.tradeOgPlainEnglish;
app.locals.POSITION_ORDER = viewHelpers.POSITION_ORDER;
app.locals.buildNav = navHelpers.buildNav;
require('./routes')(app);

var mongoose = require('mongoose');
mongoose.Promise = global.Promise;
mongoose.connect(process.env.MONGODB_URI);

process.env.PORT = process.env.PORT || 3333;

var server;

if (process.env.NODE_ENV == 'dev') {
	var fs = require('fs');
	var https = require('https');

	var options = {
		key: fs.readFileSync('./ssl/pso-key.pem'),
		cert: fs.readFileSync('./ssl/pso.pem'),
		requestCert: false,
		rejectUnauthorized: false
	};

	server = https.createServer(options, app);

	server.listen(process.env.PORT, () => {
		console.log('Listening on port', process.env.PORT);
	});
}
else {
	server = app.listen(process.env.PORT, function() {
		console.log('yes okay ' + process.env.PORT);
	});
}

var ws = require('ws');
var wss = new ws.WebSocketServer({ server: server });

var auction = require('./services/auction');
wss.on('connection', auction.handleConnection);

// Graceful shutdown
process.on('SIGTERM', () => {
	console.log('SIGTERM received, shutting down...');
	server.close(() => {
		mongoose.connection.close(false).then(() => {
			console.log('Closed out remaining connections');
			process.exit(0);
		});
	});
});
