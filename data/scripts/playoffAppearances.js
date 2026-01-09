const dotenv = require('dotenv').config({ path: '/app/.env' });

const mongoose = require('mongoose');
mongoose.Promise = global.Promise;
mongoose.connect(process.env.MONGODB_URI);

const Game = require('../models/Game');
const PSO = require('../../pso');

Game.mapReduce({
	map: function() {
		const awayKey = regimes[this.away.name] || this.away.name;
		const homeKey = regimes[this.home.name] || this.home.name;

		emit(awayKey, 1);
		emit(homeKey, 1);
	},

	reduce: function(key, results) {
		let appearances = 0;

		results.forEach(result => {
			appearances += result;
		});

		return appearances;
	},

	out: 'playoffAppearances',

	query: {
		type: 'semifinal'
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
