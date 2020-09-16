var dotenv = require('dotenv').config({ path: '../.env' });

var mongoose = require('mongoose');
mongoose.Promise = global.Promise;
mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });

var Game = require('../models/Game');

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

var franchiseMappings = {
	'Brett/Luke': 'Luke',
	'Jake/Luke': 'Luke',
	'Keyon': 'Keyon',
	'Pat/Quinn': 'Patrick',
	'Patrick': 'Patrick',
	'Schex': 'Schex',
	'Schex/Jeff': 'Schex',
	'Schexes': 'Schex'
};

var seasons = {};

Game.find({
	season: { '$gte': 2012 },
	'home.name': { '$in': Object.keys(franchiseMappings) },
	'away.name': { '$in': Object.keys(franchiseMappings) },
	type: 'regular'
}).then(games => {
	games.forEach(game => {
		var season = game.season;
		var home = {
			name: franchiseMappings[game.home.name],
			score: game.home.score
		};
		var away = {
			name: franchiseMappings[game.away.name],
			score: game.away.score
		};
		var tie = game.tie ? true : false;
		var week = game.week;

		if (!seasons[season]) {
			seasons[season] = { owners: {} };
		}

		if (!seasons[season].owners[home.name]) {
			seasons[season].owners[home.name] = {
				total: {
					wins: 0,
					losses: 0,
					jagStatus: 0
				},
				opponents: {}
			};
		}

		if (!seasons[season].owners[home.name].opponents[away.name]) {
			seasons[season].owners[home.name].opponents[away.name] = { games: [] };
		}

		if (!seasons[season].owners[away.name]) {
			seasons[season].owners[away.name] = {
				total: {
					wins: 0,
					losses: 0,
					jagStatus: 0
				},
				opponents: {}
			};
		}

		if (!seasons[season].owners[away.name].opponents[home.name]) {
			seasons[season].owners[away.name].opponents[home.name] = { games: [] };
		}

		if (home.score && away.score) {
			seasons[season].owners[home.name].opponents[away.name].games.push({ week: week, result: ((home.score > away.score) ? 'win' : 'loss'), differential: home.score - away.score });
			seasons[season].owners[away.name].opponents[home.name].games.push({ week: week, result: ((away.score > home.score) ? 'win' : 'loss'), differential: away.score - home.score });
		}
		else {
			seasons[season].owners[home.name].opponents[away.name].games.push({ week: week, result: 'scheduled' });
			seasons[season].owners[away.name].opponents[home.name].games.push({ week: week, result: 'scheduled' });
		}
	});

	Object.keys(seasons).forEach(season => {
		var results = 0;
		var threeAndOh = false;

		Object.keys(seasons[season].owners).forEach(ownerId => {
			var owner = seasons[season].owners[ownerId];

			Object.keys(owner.opponents).forEach(opponentId => {
				var opponent = owner.opponents[opponentId];

				var jagStatus = '';
				var unresolvedMatchups = false;
				var differential = 0;

				opponent.games.forEach(game => {
					if (game.result == 'scheduled') {
						unresolvedMatchups = true;
					}
					else {
						differential += game.differential;
					}
				});

				if (unresolvedMatchups) {
					if (differential > 0) {
						jagStatus = 'winning';
					}
					else if (differential < 0) {
						jagStatus = 'losing';
					}
					else {
						jagStatus = 'scheduled';
					}
				}
				else {
					if (differential > 0) {
						jagStatus = 'won';
						owner.total.wins += 1;
						results += 1;
					}
					else if (differential < 0) {
						jagStatus = 'lost';
						owner.total.losses += 1;
						results += 1;
					}
				}

				opponent.summary = { jagStatus: jagStatus, differential: differential };
			});

			if (owner.total.losses >= 2) {
				owner.total.jagStatus = 'eliminated';
			}
			else if (owner.total.wins == 3) {
				threeAndOh = true;
			}
		});

		var tiedOwners = [];

		Object.keys(seasons[season].owners).forEach(ownerId => {
			var owner = seasons[season].owners[ownerId];

			if (threeAndOh && owner.total.wins < 3) {
				owner.total.jagStatus = 'eliminated';
			}
			else if (results == 12 && owner.total.wins == 2) {
				tiedOwners.push(ownerId);
			}
		});

		if (tiedOwners.length > 0) {
			var winner = { differential: 0, owner: null }
			var differentials = {};

			tiedOwners.forEach(tiedOwner => {
				var differential = 0;

				tiedOwners.forEach(tiedOpponent => {
					if (tiedOwner != tiedOpponent) {
						differential += seasons[season].owners[tiedOwner].opponents[tiedOpponent].summary.differential;
					}

					differentials[tiedOwner] = differential;
				});
			});

			tiedOwners.forEach(tiedOwner => {
				if (differentials[tiedOwner] > winner.differential) {
					winner.differential = differentials[tiedOwner];
					winner.owner = tiedOwner;
				}
			});

			Object.keys(seasons[season].owners).forEach(ownerId => {
				var owner = seasons[season].owners[ownerId];

				if (ownerId != winner.owner) {
					owner.total.jagStatus = 'eliminated';
				}
			});
		}
	});

	if (render) {
		var fs = require('fs');
		var pug = require('pug');
		var compiledPug = pug.compileFile('../views/jaguar.pug');
		fs.writeFileSync('../public/jaguar/index.html', compiledPug({ defaultSeason: process.env.SEASON, seasons: seasons }));
	}
	else {
		console.log(JSON.stringify(seasons, null, "\t"));
	}

	process.exit();
});
