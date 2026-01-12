var dotenv = require('dotenv').config({ path: '/app/.env' });

var express = require('express');
var bodyParser = require('body-parser');
var cookieParser = require('cookie-parser');
var formatPick = require('./helpers/formatPick');
var viewHelpers = require('./helpers/view');
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

// Make helpers available to all templates
app.locals.formatPickDisplay = formatPick.formatPickDisplay;
app.locals.formatMoney = viewHelpers.formatMoney;
app.locals.formatRecord = viewHelpers.formatRecord;
app.locals.formatPoints = viewHelpers.formatPoints;
app.locals.formatScore = viewHelpers.formatScore;
app.locals.ordinal = viewHelpers.ordinal;
app.locals.formatContractYears = viewHelpers.formatContractYears;
app.locals.formatDateISO = viewHelpers.formatDateISO;
app.locals.sortedPositions = viewHelpers.sortedPositions;
app.locals.getPositionKey = viewHelpers.getPositionKey;
app.locals.POSITION_ORDER = viewHelpers.POSITION_ORDER;
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
