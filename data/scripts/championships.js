const dotenv = require('dotenv').config({ path: '/app/.env' });

const mongoose = require('mongoose');
mongoose.Promise = global.Promise;
mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });

const Game = require('../models/Game');
const PSO = require('../../pso');

Game.mapReduce({
	map: function() {
		let winnerKey = regimes[this.winner.name] || this.winner.name;

		emit(winnerKey, 1);
	},

	reduce: function(key, results) {
		let championships = 0;

		results.forEach((result) => {
			championships += result;
		});

		return championships;
	},

	out: 'championships',

	query: {
		type: 'championship',
		'away.score': { '$exists': true },
		'home.score': { '$exists': true }
	},

	sort: {
		season: 1,
		week: 1
	},

	scope: {
		regimes: PSO.regimes
	}
}).then((data) => {
	mongoose.disconnect();
	process.exit();
});
