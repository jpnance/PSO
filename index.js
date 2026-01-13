var dotenv = require('dotenv').config({ path: '/app/.env' });

var express = require('express');
var bodyParser = require('body-parser');
var cookieParser = require('cookie-parser');
var formatPick = require('./helpers/formatPick');
var viewHelpers = require('./helpers/view');
var navHelpers = require('./helpers/nav');
var { attachSession } = require('./auth/middleware');
var app = express();

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static('public'));
app.use('/js', express.static(__dirname + '/node_modules/popper.js/dist'));
app.use('/js', express.static(__dirname + '/node_modules/bootstrap/dist/js'));
app.use('/js', express.static(__dirname + '/node_modules/jquery/dist'));
app.use('/css', express.static(__dirname + '/node_modules/bootstrap/dist/css'));
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
		var regimes = await Regime.find({
			$or: [
				{ endSeason: null },
				{ endSeason: { $gte: currentSeason } }
			]
		}).populate('ownerIds').lean();
		
		// Filter to current regimes and sort by display name
		var currentRegimes = regimes
			.filter(function(r) {
				return r.startSeason <= currentSeason &&
					(r.endSeason === null || r.endSeason >= currentSeason);
			})
			.sort(function(a, b) {
				return a.displayName.localeCompare(b.displayName);
			});
		
		res.locals.navFranchises = currentRegimes.map(function(r) {
			var franchise = franchiseById[r.franchiseId.toString()];
			return {
				rosterId: franchise ? franchise.rosterId : null,
				displayName: r.displayName
			};
		});
		
		// Find current user's franchise (if logged in)
		if (req.user) {
			var userRegime = currentRegimes.find(function(r) {
				return r.ownerIds && r.ownerIds.some(function(owner) {
					return owner._id.equals(req.user._id);
				});
			});
			if (userRegime) {
				var userFranchiseDoc = franchiseById[userRegime.franchiseId.toString()];
				res.locals.userFranchise = {
					rosterId: userFranchiseDoc ? userFranchiseDoc.rosterId : null,
					displayName: userRegime.displayName
				};
			}
		}
		
		// Check if user is admin
		res.locals.isAdmin = req.session && req.session.user && req.session.user.admin;
		
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
app.locals.deltaClass = viewHelpers.deltaClass;
app.locals.sortedPositions = viewHelpers.sortedPositions;
app.locals.getPositionKey = viewHelpers.getPositionKey;
app.locals.shortenPlayerName = viewHelpers.shortenPlayerName;
app.locals.oxfordJoin = viewHelpers.oxfordJoin;
app.locals.formatPicksGrouped = viewHelpers.formatPicksGrouped;
app.locals.formatPartyAssets = viewHelpers.formatPartyAssets;
app.locals.summarizeTradeAssets = viewHelpers.summarizeTradeAssets;
app.locals.tradeOgTitle = viewHelpers.tradeOgTitle;
app.locals.tradeOgDescription = viewHelpers.tradeOgDescription;
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
		key: fs.readFileSync('../ssl/server.key'),
		cert: fs.readFileSync('../ssl/server.crt'),
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

var auction = require('./auction/service');
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
