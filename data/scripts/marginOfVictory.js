const dotenv = require('dotenv').config({ path: __dirname + '/../../.env' });

const mongoose = require('mongoose');
mongoose.Promise = global.Promise;
mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });

const Game = require('../models/Game');
const regimes = require('./regimes');

Game.mapReduce({
	map: function() {
		const key = [this.season, this.week, this.winner.name, this.loser.name].join('-');

		emit(key, Math.abs(this.home.score - this.away.score) * (this.season < 2012 ? 0.1 : 1));
	},

	reduce: function(key, results) {
		return results;
	},

	out: 'marginOfVictory',

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
