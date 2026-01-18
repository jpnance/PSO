/**
 * Test suite to verify the new standings logic matches the legacy logic
 * Run with: docker compose exec web node jaguar/test-standings.js
 */

var dotenv = require('dotenv').config({ path: '/app/.env' });
var mongoose = require('mongoose');
mongoose.connect(process.env.MONGODB_URI);

var Game = require('../models/Game');

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

// ============================================
// LEGACY LOGIC (copied from original index.js)
// ============================================

async function buildJaguarDataLegacy() {
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

	// Calculate standings and elimination status (LEGACY LOGIC)
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

// ============================================
// NEW LOGIC (from service.js)
// ============================================

function buildStandingsNew(seasonData, owners) {
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

// ============================================
// TEST RUNNER
// ============================================

async function runTests() {
	console.log('='.repeat(60));
	console.log('JAGUAR STANDINGS TEST SUITE');
	console.log('='.repeat(60));
	console.log('');

	var seasons = await buildJaguarDataLegacy();
	var allSeasons = Object.keys(seasons).map(Number).sort((a, b) => a - b);
	
	console.log('Testing', allSeasons.length, 'seasons:', allSeasons.join(', '));
	console.log('');

	var passed = 0;
	var failed = 0;
	var failures = [];

	for (var season of allSeasons) {
		var seasonData = seasons[season];
		var standings = buildStandingsNew(seasonData, jaguarOwners);
		
		// Compare each owner's data
		var seasonPassed = true;
		var seasonErrors = [];

		for (var owner of jaguarOwners) {
			var legacyData = seasonData.owners[owner];
			var newData = standings.find(s => s.name === owner);

			// Check wins
			if (legacyData.total.wins !== newData.wins) {
				seasonPassed = false;
				seasonErrors.push(`  ${owner}: wins mismatch - legacy=${legacyData.total.wins}, new=${newData.wins}`);
			}

			// Check losses
			if (legacyData.total.losses !== newData.losses) {
				seasonPassed = false;
				seasonErrors.push(`  ${owner}: losses mismatch - legacy=${legacyData.total.losses}, new=${newData.losses}`);
			}

			// Check status (normalize empty string and 0 to 'contending')
			var legacyStatus = legacyData.total.jagStatus || 'contending';
			if (legacyStatus === 0) legacyStatus = 'contending';
			var newStatus = newData.status;

			if (legacyStatus !== newStatus) {
				seasonPassed = false;
				seasonErrors.push(`  ${owner}: status mismatch - legacy="${legacyStatus}", new="${newStatus}"`);
			}
		}

		if (seasonPassed) {
			// Find the winner (the only non-eliminated owner, if there is exactly one)
			var nonEliminated = standings.filter(s => s.status !== 'eliminated');
			var winnerStr = nonEliminated.length === 1 
				? `${nonEliminated[0].name} (${nonEliminated[0].wins}-${nonEliminated[0].losses})`
				: `${nonEliminated.length} contending`;
			console.log(`✓ ${season}: ${winnerStr}`);
			passed++;
		} else {
			console.log(`✗ ${season}: FAILED`);
			seasonErrors.forEach(e => console.log(e));
			failed++;
			failures.push({ season, errors: seasonErrors });
		}

		// Also verify matchup consistency
		for (var owner of jaguarOwners) {
			for (var opponent of jaguarOwners) {
				if (owner === opponent) continue;
				
				var matchup = seasonData.owners[owner].opponents[opponent];
				var reverseMatchup = seasonData.owners[opponent].opponents[owner];
				
				// Differentials should be opposite
				if (matchup.summary && reverseMatchup.summary) {
					var diff = matchup.summary.differential;
					var reverseDiff = reverseMatchup.summary.differential;
					if (Math.abs(diff + reverseDiff) > 0.001) {
						console.log(`  WARNING ${season}: ${owner} vs ${opponent} differential mismatch: ${diff} vs ${reverseDiff}`);
					}
				}
			}
		}
	}

	console.log('');
	console.log('='.repeat(60));
	console.log(`RESULTS: ${passed} passed, ${failed} failed`);
	console.log('='.repeat(60));

	if (failed > 0) {
		console.log('\nFailed seasons:');
		failures.forEach(f => {
			console.log(`\n${f.season}:`);
			f.errors.forEach(e => console.log(e));
		});
	}

	// Additional detail: show final standings for each season
	console.log('\n');
	console.log('='.repeat(60));
	console.log('DETAILED STANDINGS BY SEASON');
	console.log('='.repeat(60));

	for (var season of allSeasons) {
		var seasonData = seasons[season];
		var standings = buildStandingsNew(seasonData, jaguarOwners);
		
		// Find the winner (the only non-eliminated owner, if there is exactly one)
		var nonEliminated = standings.filter(s => s.status !== 'eliminated');
		var winnerName = nonEliminated.length === 1 ? nonEliminated[0].name : null;
		
		console.log(`\n${season}:`);
		standings.forEach((s, i) => {
			var statusStr = s.status === 'eliminated' ? ' (eliminated)' : '';
			var marker = (s.name === winnerName) ? ' ← WINNER' : '';
			console.log(`  ${i + 1}. ${s.name}: ${s.wins}-${s.losses}${statusStr}${marker}`);
		});
	}

	process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
	console.error('Test error:', err);
	process.exit(1);
});
