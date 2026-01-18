const dotenv = require('dotenv').config({ path: '/app/.env' });

const mongoose = require('mongoose');
mongoose.Promise = global.Promise;
mongoose.connect(process.env.MONGODB_URI);

const Game = require('../models/Game');

Game.mapReduce({
	map: function() {
		var finalWeek = 15;

		if (this.season <= 2021) {
			finalWeek = 14;
		}

		if (this.week != finalWeek) {
			return;
		}

		var awayAllPlayPct = this.away.record.allPlay.cumulative.wins / (this.away.record.allPlay.cumulative.wins + this.away.record.allPlay.cumulative.losses);
		var homeAllPlayPct = this.home.record.allPlay.cumulative.wins / (this.home.record.allPlay.cumulative.wins + this.home.record.allPlay.cumulative.losses);

		emit(`${this.season} ${this.home.name}`, { wins: this.home.record.allPlay.cumulative.wins, losses: this.home.record.allPlay.cumulative.losses, ties: this.home.record.allPlay.cumulative.ties, winPct: homeAllPlayPct });
		emit(`${this.season} ${this.away.name}`, { wins: this.away.record.allPlay.cumulative.wins, losses: this.away.record.allPlay.cumulative.losses, ties: this.away.record.allPlay.cumulative.ties, winPct: awayAllPlayPct });
	},

	reduce: function(key, results) {
		return results[0];
	},

	out: 'regularSeasonAllPlay',

	query: {
		type: 'regular',
		'away.score': { '$exists': true },
		'home.score': { '$exists': true }
	},

	sort: {
		season: 1,
		week: 1
	},
}).then((data) => {
	mongoose.disconnect();
	process.exit();
});
