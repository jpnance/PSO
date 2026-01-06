var auction = require('./auction/service.js');
var simulator = require('./simulator/service.js');
var scuttlebot = require('./scuttlebot/service.js');
var league = require('./league/service.js');
var admin = require('./admin/service.js');
var adminPlayers = require('./admin/players.js');
var draft = require('./draft/service.js');
var history = require('./history/service.js');
var calendar = require('./calendar/service.js');

module.exports = function(app) {
	app.get('/', function(request, response) {
		response.redirect('https://thedynastyleague.wordpress.com/');
	});

	app.get('/league', league.overview);
	app.get('/league/franchise/:id', league.franchise);
	
	app.get('/history/trades', history.tradeHistory);

	app.get('/draft', draft.draftBoard);
	
	app.get('/calendar', calendar.calendar);

	app.get('/auction/login/:key', auction.authenticateOwner);
	app.get('/auction/resetorder', auction.resetNominationOrder);

	app.post('/simulator', simulator.filterByConditions);
	app.post('/simulator/:conditions', simulator.filterByConditions);
	app.get('/simulator/clear', simulator.clearCache);

	app.get('/scuttlebutt', (request, response) => {
		response.redirect('/scuttlebot');
	});
	app.get('/scuttlebot', scuttlebot.prompt);
	app.post('/scuttlebot/message', scuttlebot.postMessage);
	
	// Admin routes
	app.get('/admin', admin.configPage);
	app.post('/admin/config', admin.updateConfig);
	app.get('/admin/advance-season', admin.advanceSeasonForm);
	app.post('/admin/advance-season', admin.advanceSeason);
	app.get('/admin/transfer-franchise', admin.transferFranchiseForm);
	app.post('/admin/transfer-franchise', admin.transferFranchise);
	
	// Player management
	app.get('/admin/players', adminPlayers.listPlayers);
	app.get('/admin/players/new', adminPlayers.newPlayerForm);
	app.post('/admin/players/new', adminPlayers.createPlayer);
	app.get('/admin/players/:id', adminPlayers.editPlayerForm);
	app.post('/admin/players/:id', adminPlayers.editPlayer);
	app.post('/admin/players/:id/merge', adminPlayers.mergePlayer);
};
