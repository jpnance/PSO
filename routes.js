var auction = require('./auction/service.js');
var simulator = require('./simulator/service.js');
var scuttlebot = require('./scuttlebot/service.js');
var league = require('./league/service.js');

module.exports = function(app) {
	app.get('/', function(request, response) {
		response.redirect('https://thedynastyleague.wordpress.com/');
	});

	// League views
	app.get('/league', async function(request, response) {
		try {
			var franchises = await league.getLeagueOverview();
			var currentSeason = parseInt(process.env.SEASON, 10);
			response.render('league', { franchises: franchises, currentSeason: currentSeason });
		} catch (err) {
			console.error(err);
			response.status(500).send('Error loading league data');
		}
	});

	app.get('/league/franchise/:id', async function(request, response) {
		try {
			var franchise = await league.getFranchise(request.params.id);
			if (!franchise) {
				return response.status(404).send('Franchise not found');
			}
			var currentSeason = parseInt(process.env.SEASON, 10);
			response.render('franchise', { franchise: franchise, currentSeason: currentSeason });
		} catch (err) {
			console.error(err);
			response.status(500).send('Error loading franchise data');
		}
	});

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
};
