const dotenv = require('dotenv').config({ path: __dirname + '/../../.env' });

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

		if (winner.record.allPlay.week.losses == 0) {
			const key = regimes[winner.name] || winner.name;

			emit(key, 1);
		}
	},

	reduce: function(key, results) {
		let scoringTitles = 0;

		results.forEach(result => {
			scoringTitles += result;
		});

		return scoringTitles;
	},

	out: 'weeklyScoringTitles',

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
