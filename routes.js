var auction = require('./auction/service.js');

module.exports = function(app) {
	app.get('/', function(request, response) {
		response.redirect('https://thedynastyleague.wordpress.com/');
	});

	app.get('/auction/activate', auction.activateAuction);
	app.get('/auction/current', auction.currentAuction);
	app.get('/auction/pause', auction.pauseAuction);
	app.get('/auction/pop', auction.popBid);

	app.post('/auction/bid', auction.makeBid);
	app.post('/auction/nominate', auction.nominatePlayer);
};
