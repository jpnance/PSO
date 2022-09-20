/*
	This shows how many sweeps and splits there have been per season. It was a quick way to investigate how rematch games tend to go.
*/

var dotenv = require('dotenv').config({ path: '/app/.env' });

var mongoose = require('mongoose');
mongoose.Promise = global.Promise;
mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });

var Game = require('../models/Game');

var data = {};
var totals = {
	total: {
		sweeps: 0,
		splits: 0
	}
};

Game.find({ type: 'regular', winner: { '$exists': true } }).sort({ data: 1, week: 1 }).then(games => {
	games.forEach(game => {
		if (!data[game.season]) {
			data[game.season] = {};
		}

		if (!data[game.season][game.away.franchiseId]) {
			data[game.season][game.away.franchiseId] = {};
		}

		if (!data[game.season][game.away.franchiseId][game.home.franchiseId]) {
			data[game.season][game.away.franchiseId][game.home.franchiseId] = { wins: 0, losses: 0 };
		}

		if (!data[game.season][game.home.franchiseId]) {
			data[game.season][game.home.franchiseId] = {};
		}

		if (!data[game.season][game.home.franchiseId][game.away.franchiseId]) {
			data[game.season][game.home.franchiseId][game.away.franchiseId] = { wins: 0, losses: 0 };
		}

		data[game.season][game.winner.franchiseId][game.loser.franchiseId].wins++;
		data[game.season][game.loser.franchiseId][game.winner.franchiseId].losses++;
	});

	Object.keys(data).forEach(seasonId => {
		var season = data[seasonId];

		if (!totals[seasonId]) {
			totals[seasonId] = { sweeps: 0, splits: 0 };
		}

		Object.keys(season).forEach(franchiseId => {
			var matchups = season[franchiseId];

			Object.keys(matchups).forEach(opponentId => {
				var results = matchups[opponentId];

				if (results.wins == 2 || results.losses == 2) {
					totals[seasonId].sweeps++;
					totals['total'].sweeps++;
				}
				else if (results.wins == 1 && results.losses == 1) {
					totals[seasonId].splits++;
					totals['total'].splits++;
				}
			});
		});

		totals[seasonId].sweeps /= 2;
		totals[seasonId].splits /= 2;
	});

	totals['total'].sweeps /= 2;
	totals['total'].splits /= 2;

	//console.log(JSON.stringify(data, null, '    '));
	console.log(totals);
	mongoose.disconnect();
});
