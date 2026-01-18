var dotenv = require('dotenv').config({ path: '/app/.env' });

var Game = require('../models/Game');

var mongoose = require('mongoose');
mongoose.promise = global.Promise;
mongoose.connect(process.env.MONGODB_URI);

var PSO = require('../config/pso.js');

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

Object.values(PSO.regimes).forEach(firstFranchise => {
	headToHead[firstFranchise] = {};

	Object.values(PSO.regimes).forEach(secondFranchise => {
		if (firstFranchise != secondFranchise) {
			headToHead[firstFranchise][secondFranchise] = { wins: 0, losses: 0, ties: 0, games: [] };
		}
	});
});

//Game.find({ type: { '$in': ['semifinal', 'thirdPlace', 'championship' ] } }).sort({ season: 1, week: 1 }).then(games => {
Game.find({ type: 'regular' }).sort({ season: 1, week: 1 }).then(games => {
	games.forEach(game => {
		if (game.away.score != 0 || game.home.score != 0) {
			if (game.away.score > game.home.score) {
				headToHead[PSO.regimes[game.away.name]][PSO.regimes[game.home.name]].wins++;
				headToHead[PSO.regimes[game.home.name]][PSO.regimes[game.away.name]].losses++;

				headToHead[PSO.regimes[game.away.name]][PSO.regimes[game.home.name]].games.push(game.season + '-' + game.week + ': W');
				headToHead[PSO.regimes[game.home.name]][PSO.regimes[game.away.name]].games.push(game.season + '-' + game.week + ': L');
			}
			else if (game.home.score > game.away.score) {
				headToHead[PSO.regimes[game.home.name]][PSO.regimes[game.away.name]].wins++;
				headToHead[PSO.regimes[game.away.name]][PSO.regimes[game.home.name]].losses++;

				headToHead[PSO.regimes[game.home.name]][PSO.regimes[game.away.name]].games.push(game.season + '-' + game.week + ': W');
				headToHead[PSO.regimes[game.away.name]][PSO.regimes[game.home.name]].games.push(game.season + '-' + game.week + ': L');
			}
			else if (game.away.score > 0 || game.home.score > 0) {
				headToHead[PSO.regimes[game.away.name]][PSO.regimes[game.home.name]].ties++;
				headToHead[PSO.regimes[game.home.name]][PSO.regimes[game.away.name]].ties++;

				headToHead[PSO.regimes[game.away.name]][PSO.regimes[game.home.name]].games.push(game.season + '-' + game.week + ': T');
				headToHead[PSO.regimes[game.home.name]][PSO.regimes[game.away.name]].games.push(game.season + '-' + game.week + ': T');
			}
		}
	});

	if (render) {
		var fs = require('fs');
		var path = require('path');
		var pug = require('pug');
		var compiledPug = pug.compileFile(path.join(__dirname, '../views/h2h.pug'));
		fs.writeFileSync(path.join(__dirname, '../public/h2h/index.html'), compiledPug({ franchises: PSO.franchises, headToHead: headToHead }));
	}

	mongoose.disconnect();
	process.exit();
});
