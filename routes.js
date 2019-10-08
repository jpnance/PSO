module.exports = function(app) {
	app.get('/', function(request, response) {
		response.redirect('https://thedynastyleague.wordpress.com/');
	});

	app.get('/lol', function(request, response) {
		var Game = require('./models/Game');

		Game.find({}).then(games => {
			var history = {};
			var owners = {};

			games.forEach(game => {
				if (!history[game.season]) {
					history[game.season] = {};
				}

				if (!history[game.season][game.week]) {
					history[game.season][game.week] = {};
				}

				if (!history[game.season][game.week][game.away.franchiseId]) {
					history[game.season][game.week][game.away.franchiseId] = {
						franchise: game.away,
						opponent: game.home
					};
				}

				if (!history[game.season][game.week][game.home.franchiseId]) {
					history[game.season][game.week][game.home.franchiseId] = {
						franchise: game.home,
						opponent: game.away
					};
				}

				if (!owners[game.season]) {
					owners[game.season] = {};
				}

				if (!owners[game.season][game.away.franchiseId]) {
					owners[game.season][game.away.franchiseId] = game.away.name;
				}

				if (!owners[game.season][game.home.franchiseId]) {
					owners[game.season][game.home.franchiseId] = game.home.name;
				}
			});

			response.render('history', { owners: owners, history: history });
		});
	});
};
