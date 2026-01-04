var auction = require('./auction/service.js');
var simulator = require('./simulator/service.js');
var scuttlebot = require('./scuttlebot/service.js');
var league = require('./league/service.js');
var admin = require('./admin/service.js');

module.exports = function(app) {
	app.get('/', function(request, response) {
		response.redirect('https://thedynastyleague.wordpress.com/');
	});

	app.get('/league', league.overview);
	app.get('/league/franchise/:id', league.franchise);

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
	app.post('/admin/config/advance-season', admin.advanceSeason);
};
