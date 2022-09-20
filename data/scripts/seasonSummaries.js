const dotenv = require('dotenv').config({ path: '/app/.env' });

const mongoose = require('mongoose');
mongoose.Promise = global.Promise;
mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });

const Game = require('../models/Game');

Game.mapReduce({
	map: function() {
		['away', 'home'].forEach((ownerType) => {
			const seasonOwner = this.season + ' ' + this[ownerType].name;
			const data = {
				scores: [ this[ownerType].score ],
				records: [ this[ownerType].record.straight.cumulative.wins + '-' + this[ownerType].record.straight.cumulative.losses + '-' + this[ownerType].record.straight.cumulative.ties ],
				playoffs: this.type == 'semifinal',
				titleGame: this.type == 'championship',
				champion: this.type == 'championship' && this.winner.name == this[ownerType].name
			};

			emit(seasonOwner, data);
		});
	},

	reduce: function(key, results) {
		const sumReducer = (a, b) => parseInt(a) + parseInt(b);

		let seasonSummary = { scores: [], records: [], playoffs: false, titleGame: false, champion: false };

		results.forEach((result) => {
			result.scores.forEach((score) => {
				seasonSummary.scores.push(score);
			});

			result.records.forEach((record) => {
				seasonSummary.records.push(record);
			});

			if (result.playoffs) {
				seasonSummary.playoffs = true;
			}

			if (result.titleGame) {
				seasonSummary.titleGame = true;
			}

			if (result.champion) {
				seasonSummary.champion = true;
			}
		});

		seasonSummary.records.sort((a, b) => {
			const aGames = a.split('-').reduce(sumReducer);
			const bGames = b.split('-').reduce(sumReducer);

			return a - b;
		});

		return seasonSummary;
	},

	out: 'seasonSummaries',

	query: {
		'away.score': { '$exists': true },
		'home.score': { '$exists': true },
		'type': { '$ne': 'consolation' }
	},

	sort: {
		season: 1,
		week: 1
	}
}).then((data) => {
	mongoose.disconnect();
	process.exit();
});
