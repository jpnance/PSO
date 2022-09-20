const dotenv = require('dotenv').config({ path: '/app/.env' });

const mongoose = require('mongoose');
mongoose.Promise = global.Promise;
mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });

const Game = require('../models/Game');
const regimes = require('./regimes');

Game.mapReduce({
	map: function() {
		let winner, loser;

		if (this.away.score > this.home.score) {
			winner = this.away;
			loser = this.home;
		}
		else if (this.home.score > this.away.score) {
			winner = this.home;
			loser = this.away;
		}

		const key = regimes[this.winner.name] || this.winner.name;

		emit(key, 1);
	},

	reduce: function(key, results) {
		var wins = 0;

		results.forEach(result => {
			wins += result;
		});

		return wins;
	},

	out: 'regularSeasonWins',

	query: {
		type: 'regular',
		'away.score': { '$exists': true },
		'home.score': { '$exists': true }
	},

	sort: {
		season: 1,
		week: 1
	},

	scope: {
		regimes: regimes
	}
}).then((data) => {
	mongoose.disconnect();
	process.exit();
});
