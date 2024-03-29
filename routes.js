var auction = require('./auction/service.js');
var simulator = require('./simulator/service.js');
var scuttlebot = require('./scuttlebot/service.js');

module.exports = function(app) {
	app.get('/', function(request, response) {
		response.redirect('https://thedynastyleague.wordpress.com/');
	});

	app.get('/auction/activate', auction.activateAuction);
	app.get('/auction/callroll', auction.callRoll);
	app.get('/auction/current', auction.currentAuction);
	app.get('/auction/login/:key', auction.authenticateOwner);
	app.get('/auction/pause', auction.pauseAuction);
	app.get('/auction/pop', auction.popBid);
	app.get('/auction/quickauth', auction.quickAuth);
	app.get('/auction/resetorder', auction.resetNominationOrder);
	app.get('/auction/rollcall', auction.rollCall);

	app.post('/auction/bid', auction.makeBid);
	app.post('/auction/nominate', auction.nominatePlayer);
	app.post('/auction/removeowner', auction.removeFromNominationOrder);

	app.post('/simulator', simulator.filterByConditions);
	app.post('/simulator/:conditions', simulator.filterByConditions);
	app.get('/simulator/clear', simulator.clearCache);

	app.get('/scuttlebutt', (request, response) => {
		response.redirect('/scuttlebot');
	});
	app.get('/scuttlebot', scuttlebot.prompt);
	app.post('/scuttlebot/message', scuttlebot.postMessage);
};
