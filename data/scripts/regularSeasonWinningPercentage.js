const dotenv = require('dotenv').config({ path: '/app/.env' });

const mongoose = require('mongoose');
mongoose.Promise = global.Promise;
mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });

const Game = require('../models/Game');
const PSO = require('../../pso');

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

		const winnerKey = regimes[this.winner.name] || this.winner.name;
		const loserKey = regimes[this.loser.name] || this.loser.name;

		emit(winnerKey, { wins: 1, losses: 0 });
		emit(loserKey, { wins: 0, losses: 1 });
	},

	reduce: function(key, results) {
		const record = { wins: 0, losses: 0 };

		results.forEach(result => {
			record.wins += result.wins;
			record.losses += result.losses;
		});

		return record;
	},

	finalize: function(key, reduction) {
		return (reduction.wins / (reduction.wins + reduction.losses)).toFixed(3);
	},

	out: 'regularSeasonWinningPercentage',

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
		regimes: PSO.regimes
	}
}).then((data) => {
	mongoose.disconnect();
	process.exit();
});
