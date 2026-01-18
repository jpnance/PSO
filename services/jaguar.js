var Game = require('../models/Game');
var LeagueConfig = require('../models/LeagueConfig');

var franchiseMappings = {
	'Brett/Luke': 'Luke',
	'Jake/Luke': 'Luke',
	'Keyon': 'Keyon',
	'Luke': 'Luke',
	'Pat/Quinn': 'Patrick',
	'Patrick': 'Patrick',
	'Schex': 'Schex',
	'Schex/Jeff': 'Schex',
	'Schexes': 'Schex'
};

var jaguarOwners = ['Keyon', 'Luke', 'Patrick', 'Schex'];

async function buildJaguarData() {
	var seasons = {};

	var games = await Game.find({
		season: { '$gte': 2012 },
		'home.name': { '$in': Object.keys(franchiseMappings) },
		'away.name': { '$in': Object.keys(franchiseMappings) },
		type: 'regular'
	});

	games.forEach(function(game) {
		var season = game.season;
		var home = {
			name: franchiseMappings[game.home.name],
			score: game.home.score
		};
		var away = {
			name: franchiseMappings[game.away.name],
			score: game.away.score
		};
		var week = game.week;

		if (!seasons[season]) {
			seasons[season] = { owners: {} };
		}

		if (!seasons[season].owners[home.name]) {
			seasons[season].owners[home.name] = {
				total: { wins: 0, losses: 0, jagStatus: 0 },
				opponents: {}
			};
		}

		if (!seasons[season].owners[home.name].opponents[away.name]) {
			seasons[season].owners[home.name].opponents[away.name] = { games: [] };
		}

		if (!seasons[season].owners[away.name]) {
			seasons[season].owners[away.name] = {
				total: { wins: 0, losses: 0, jagStatus: 0 },
				opponents: {}
			};
		}

		if (!seasons[season].owners[away.name].opponents[home.name]) {
			seasons[season].owners[away.name].opponents[home.name] = { games: [] };
		}

		if (home.score && away.score) {
			seasons[season].owners[home.name].opponents[away.name].games.push({
				week: week,
				result: (home.score > away.score) ? 'win' : 'loss',
				differential: home.score - away.score
			});
			seasons[season].owners[away.name].opponents[home.name].games.push({
				week: week,
				result: (away.score > home.score) ? 'win' : 'loss',
				differential: away.score - home.score
			});
		} else {
			seasons[season].owners[home.name].opponents[away.name].games.push({ week: week, result: 'scheduled' });
			seasons[season].owners[away.name].opponents[home.name].games.push({ week: week, result: 'scheduled' });
		}
	});

	// Calculate standings and elimination status
	Object.keys(seasons).forEach(function(season) {
		var results = 0;
		var threeAndOh = false;

		Object.keys(seasons[season].owners).forEach(function(ownerId) {
			var owner = seasons[season].owners[ownerId];

			Object.keys(owner.opponents).forEach(function(opponentId) {
				var opponent = owner.opponents[opponentId];
				var jagStatus = '';
				var unresolvedMatchups = false;
				var differential = 0;

				opponent.games.forEach(function(game) {
					if (game.result === 'scheduled') {
						unresolvedMatchups = true;
					} else {
						differential += game.differential;
					}
				});

				if (unresolvedMatchups) {
					if (differential > 0) {
						jagStatus = 'winning';
					} else if (differential < 0) {
						jagStatus = 'losing';
					} else {
						jagStatus = 'scheduled';
					}
				} else {
					if (differential > 0) {
						jagStatus = 'won';
						owner.total.wins += 1;
						results += 1;
					} else if (differential < 0) {
						jagStatus = 'lost';
						owner.total.losses += 1;
						results += 1;
					}
				}

				opponent.summary = { jagStatus: jagStatus, differential: differential };
			});

			if (owner.total.losses >= 2) {
				owner.total.jagStatus = 'eliminated';
			} else if (owner.total.wins === 3) {
				threeAndOh = true;
			}
		});

		var tiedOwners = [];

		Object.keys(seasons[season].owners).forEach(function(ownerId) {
			var owner = seasons[season].owners[ownerId];

			if (threeAndOh && owner.total.wins < 3) {
				owner.total.jagStatus = 'eliminated';
			} else if (results === 12 && owner.total.wins === 2) {
				tiedOwners.push(ownerId);
			}
		});

		if (tiedOwners.length > 0) {
			var winner = { differential: 0, owner: null };
			var differentials = {};

			tiedOwners.forEach(function(tiedOwner) {
				var differential = 0;

				tiedOwners.forEach(function(tiedOpponent) {
					if (tiedOwner !== tiedOpponent) {
						differential += seasons[season].owners[tiedOwner].opponents[tiedOpponent].summary.differential;
					}

					differentials[tiedOwner] = differential;
				});
			});

			tiedOwners.forEach(function(tiedOwner) {
				if (differentials[tiedOwner] > winner.differential) {
					winner.differential = differentials[tiedOwner];
					winner.owner = tiedOwner;
				}
			});

			Object.keys(seasons[season].owners).forEach(function(ownerId) {
				var owner = seasons[season].owners[ownerId];

				if (ownerId !== winner.owner) {
					owner.total.jagStatus = 'eliminated';
				}
			});
		}
	});

	return seasons;
}

// Build standings array sorted by wins (desc), then losses (asc)
function buildStandings(seasonData, owners) {
	return owners.map(function(owner) {
		var data = seasonData.owners[owner];
		return {
			name: owner,
			wins: data.total.wins,
			losses: data.total.losses,
			status: data.total.jagStatus || 'contending'
		};
	}).sort(function(a, b) {
		if (b.wins !== a.wins) return b.wins - a.wins;
		return a.losses - b.losses;
	});
}

async function jaguarPage(req, res) {
	var seasons = await buildJaguarData();
	var allSeasons = Object.keys(seasons).map(Number).sort((a, b) => b - a);
	
	// Get league config to determine phase
	var config = await LeagueConfig.findById('pso');
	
	// Compute default season based on phase
	// Before contracts due (dead-period, early-offseason, pre-season): show last completed season
	// After contracts due (regular-season+): show current season
	var defaultSeason = allSeasons[0];
	if (config) {
		var phase = config.getPhase();
		var preContractPhases = ['dead-period', 'early-offseason', 'pre-season'];
		if (preContractPhases.includes(phase)) {
			// Before contracts due - show the previous completed season
			defaultSeason = config.season - 1;
		} else {
			// Regular season or later - show current season
			defaultSeason = config.season;
		}
		// Fallback to most recent if computed season doesn't exist in data
		if (!seasons[defaultSeason]) {
			defaultSeason = allSeasons[0];
		}
	}
	
	// Determine current season from query or use computed default
	var currentSeason = req.query.season ? parseInt(req.query.season) : defaultSeason;
	
	// Single quick pill for the default season, rest in "Older" dropdown (like Rookie Salaries)
	var quickSeasons = [defaultSeason];
	var olderSeasons = allSeasons.filter(s => s !== defaultSeason);
	
	var seasonData = seasons[currentSeason];
	var standings = buildStandings(seasonData, jaguarOwners);

	res.render('jaguar', {
		activePage: 'jaguar',
		seasons: seasons,
		currentSeason: currentSeason,
		quickSeasons: quickSeasons,
		olderSeasons: olderSeasons,
		jaguarOwners: jaguarOwners,
		standings: standings
	});
}

module.exports = {
	jaguarPage: jaguarPage
};
