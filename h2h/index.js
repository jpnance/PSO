var dotenv = require('dotenv').config({ path: '../.env' });

var Game = require('../models/Game');

var mongoose = require('mongoose');
mongoose.promise = global.Promise;
mongoose.connect('mongodb://localhost:27017/pso_dev');

var franchises = {
	1: 'Patrick',
	2: 'Koci/Mueller',
	3: 'Syed/Kuan',
	4: 'John/Zach',
	5: 'Trevor',
	6: 'Keyon',
	7: 'Brett/Luke',
	8: 'Terence',
	9: 'James/Charles',
	10: 'Schex',
	11: 'Quinn',
	12: 'Mitch'
};

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

Game.find({ type: 'regular' }).then(games => {
	games.forEach(game => {
		if (game.away.score && game.home.score) {
			if (!headToHead[franchises[game.away.franchiseId]]) {
				headToHead[franchises[game.away.franchiseId]] = {};
			}

			if (!headToHead[franchises[game.away.franchiseId]][franchises[game.home.franchiseId]]) {
				headToHead[franchises[game.away.franchiseId]][franchises[game.home.franchiseId]] = { wins: 0, losses: 0, ties: 0 };
			}

			if (!headToHead[franchises[game.home.franchiseId]]) {
				headToHead[franchises[game.home.franchiseId]] = {};
			}

			if (!headToHead[franchises[game.home.franchiseId]][franchises[game.away.franchiseId]]) {
				headToHead[franchises[game.home.franchiseId]][franchises[game.away.franchiseId]] = { wins: 0, losses: 0, ties: 0 };
			}

			if (game.away.score > game.home.score) {
				headToHead[franchises[game.away.franchiseId]][franchises[game.home.franchiseId]].wins++;
				headToHead[franchises[game.home.franchiseId]][franchises[game.away.franchiseId]].losses++;
			}
			else if (game.home.score > game.away.score) {
				headToHead[franchises[game.home.franchiseId]][franchises[game.away.franchiseId]].wins++;
				headToHead[franchises[game.away.franchiseId]][franchises[game.home.franchiseId]].losses++;
			}
			else {
				headToHead[franchises[game.away.franchiseId]][franchises[game.home.franchiseId]].ties++;
				headToHead[franchises[game.home.franchiseId]][franchises[game.away.franchiseId]].ties++;
			}
		}
	});

	console.log(headToHead);

	if (render) {
		var fs = require('fs');
		var pug = require('pug');
		var compiledPug = pug.compileFile('../views/h2h.pug');
		fs.writeFileSync('../public/h2h/index.html', compiledPug({ franchises: franchises, headToHead: headToHead }));
	}

	mongoose.disconnect();
	process.exit();
});
