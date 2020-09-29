var dotenv = require('dotenv').config({ path: '../.env' });

var Game = require('../models/Game');

var mongoose = require('mongoose');
mongoose.promise = global.Promise;
mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });

var PSO = require('../pso.js');

var headToHead = {};

var render = false;

process.argv.forEach(function(value, index, array) {
	if (index > 1) {
		var pair = value.split(/=/);

		switch (pair[0]) {
			case 'render':
				render = true;
				break;
		}
	}
});

Game.find({ type: 'regular' }).sort({ season: 1, week: 1 }).then(games => {
	games.forEach(game => {
		if (game.away.score != 0 || game.home.score != 0) {
			if (!headToHead[PSO.franchises[game.away.franchiseId]]) {
				headToHead[PSO.franchises[game.away.franchiseId]] = {};
			}

			if (!headToHead[PSO.franchises[game.away.franchiseId]][PSO.franchises[game.home.franchiseId]]) {
				headToHead[PSO.franchises[game.away.franchiseId]][PSO.franchises[game.home.franchiseId]] = { wins: 0, losses: 0, ties: 0, games: [] };
			}

			if (!headToHead[PSO.franchises[game.home.franchiseId]]) {
				headToHead[PSO.franchises[game.home.franchiseId]] = {};
			}

			if (!headToHead[PSO.franchises[game.home.franchiseId]][PSO.franchises[game.away.franchiseId]]) {
				headToHead[PSO.franchises[game.home.franchiseId]][PSO.franchises[game.away.franchiseId]] = { wins: 0, losses: 0, ties: 0, games: [] };
			}

			if (game.away.score > game.home.score) {
				headToHead[PSO.franchises[game.away.franchiseId]][PSO.franchises[game.home.franchiseId]].wins++;
				headToHead[PSO.franchises[game.home.franchiseId]][PSO.franchises[game.away.franchiseId]].losses++;

				headToHead[PSO.franchises[game.away.franchiseId]][PSO.franchises[game.home.franchiseId]].games.push(game.season + '-' + game.week + ': W');
				headToHead[PSO.franchises[game.home.franchiseId]][PSO.franchises[game.away.franchiseId]].games.push(game.season + '-' + game.week + ': L');
			}
			else if (game.home.score > game.away.score) {
				headToHead[PSO.franchises[game.home.franchiseId]][PSO.franchises[game.away.franchiseId]].wins++;
				headToHead[PSO.franchises[game.away.franchiseId]][PSO.franchises[game.home.franchiseId]].losses++;

				headToHead[PSO.franchises[game.home.franchiseId]][PSO.franchises[game.away.franchiseId]].games.push(game.season + '-' + game.week + ': W');
				headToHead[PSO.franchises[game.away.franchiseId]][PSO.franchises[game.home.franchiseId]].games.push(game.season + '-' + game.week + ': L');
			}
			else if (game.away.score > 0 || game.home.score > 0) {
				headToHead[PSO.franchises[game.away.franchiseId]][PSO.franchises[game.home.franchiseId]].ties++;
				headToHead[PSO.franchises[game.home.franchiseId]][PSO.franchises[game.away.franchiseId]].ties++;

				headToHead[PSO.franchises[game.away.franchiseId]][PSO.franchises[game.home.franchiseId]].games.push(game.season + '-' + game.week + ': T');
				headToHead[PSO.franchises[game.home.franchiseId]][PSO.franchises[game.away.franchiseId]].games.push(game.season + '-' + game.week + ': T');
			}
		}
	});

	if (render) {
		var fs = require('fs');
		var pug = require('pug');
		var compiledPug = pug.compileFile('../views/h2h.pug');
		fs.writeFileSync('../public/h2h/index.html', compiledPug({ franchises: PSO.franchises, headToHead: headToHead }));
	}

	mongoose.disconnect();
	process.exit();
});
