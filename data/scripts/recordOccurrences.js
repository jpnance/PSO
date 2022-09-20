const dotenv = require('dotenv').config({ path: '/app/.env' });

const mongoose = require('mongoose');
mongoose.Promise = global.Promise;
mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });

const Game = require('../models/Game');

Game.mapReduce({
	map: function() {
		const homeRecord = this.home.record.straight.cumulative.wins + '-' + this.home.record.straight.cumulative.losses + '-' + this.home.record.straight.cumulative.ties;
		const awayRecord = this.away.record.straight.cumulative.wins + '-' + this.away.record.straight.cumulative.losses + '-' + this.away.record.straight.cumulative.ties;

		emit(homeRecord, { owners: [ this.season + ' ' + this.home.name ] });
		emit(awayRecord, { owners: [ this.season + ' ' + this.away.name ] });
	},

	reduce: function(key, results) {
		let owners = [];

		results.forEach(owner => {
			owners = owners.concat(owner.owners);
		});

		return { owners: owners };
	},

	out: 'recordOccurrences',

	query: {
		type: 'regular',
		'away.score': { '$exists': true },
		'home.score': { '$exists': true }
	},

	sort: {
		season: 1,
		week: 1
	}
}).then((data) => {
	mongoose.disconnect();
	process.exit();
});
