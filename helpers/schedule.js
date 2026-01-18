// Schedule widget helper
// Shows current week's games (upcoming or results)

var Game = require('../models/Game');
var PSO = require('../config/pso');

// Get schedule data for the widget
async function getScheduleWidget(season, phase, cutDay) {
	var now = new Date();
	var currentWeek = PSO.getWeek(now, season);
	
	// In offseason, show previous season's playoff bracket until cut day
	if (phase === 'dead-period' || phase === 'early-offseason' || phase === 'pre-season') {
		if (cutDay && now >= new Date(cutDay)) {
			return null;
		}
		
		return await getPlayoffBracket(season - 1);
	}
	
	// Get all regular season games for record computation
	var allRegularGames = await Game.find({
		season: season,
		type: 'regular'
	}).lean();
	
	// Regular season - just show current week
	if (currentWeek <= 15) {
		var games = allRegularGames.filter(function(g) { return g.week === currentWeek; });
		
		if (games.length === 0) {
			return null;
		}
		
		return {
			title: 'Week ' + currentWeek,
			sections: [{
				games: formatGames(games, allRegularGames)
			}],
			hasScores: games.some(g => g.away.score != null)
		};
	}
	
	// Playoffs - show full bracket
	return await getPlayoffBracket(season, allRegularGames);
}

async function getPlayoffBracket(season, allRegularGames) {
	// Get all playoff games
	var semis = await Game.find({
		season: season,
		type: 'semifinal'
	}).lean();
	
	var championship = await Game.find({
		season: season,
		type: 'championship'
	}).lean();
	
	var thirdPlace = await Game.find({
		season: season,
		type: 'thirdPlace'
	}).lean();
	
	if (semis.length === 0) {
		return null;
	}
	
	// If we don't have allRegularGames, fetch them
	if (!allRegularGames) {
		allRegularGames = await Game.find({
			season: season,
			type: 'regular'
		}).lean();
	}
	
	// Compute final regular season records and points for seeding
	var records = {};
	allRegularGames.forEach(function(g) {
		if (!records[g.away.name]) records[g.away.name] = { wins: 0, losses: 0, pointsFor: 0 };
		if (!records[g.home.name]) records[g.home.name] = { wins: 0, losses: 0, pointsFor: 0 };
		
		if (g.away.score != null && g.home.score != null) {
			records[g.away.name].pointsFor += g.away.score;
			records[g.home.name].pointsFor += g.home.score;
			if (g.away.score > g.home.score) {
				records[g.away.name].wins++;
				records[g.home.name].losses++;
			} else if (g.home.score > g.away.score) {
				records[g.home.name].wins++;
				records[g.away.name].losses++;
			}
		}
	});
	
	// Compute seeds (top 4 by wins, then points for)
	var seeds = {};
	var sortedTeams = Object.keys(records).map(function(name) {
		return { name: name, wins: records[name].wins, pointsFor: records[name].pointsFor };
	}).sort(function(a, b) {
		if (b.wins !== a.wins) return b.wins - a.wins;
		return b.pointsFor - a.pointsFor;
	});
	for (var i = 0; i < Math.min(4, sortedTeams.length); i++) {
		seeds[sortedTeams[i].name] = i + 1;
	}
	
	function getRecord(name) {
		var r = records[name];
		return r ? r.wins + '-' + r.losses : null;
	}
	
	function getSeed(name) {
		return seeds[name] || null;
	}
	
	var sections = [];
	
	// Championship round section (shown first)
	var championshipRoundGames = [];
	
	if (championship.length > 0) {
		var champGame = championship[0];
		var champAwayWon = champGame.away.score != null && champGame.home.score != null && champGame.away.score > champGame.home.score;
		var champHomeWon = champGame.away.score != null && champGame.home.score != null && champGame.home.score > champGame.away.score;
		championshipRoundGames.push({
			label: 'Championship',
			type: 'championship',
			away: {
				name: champGame.away.name,
				score: champGame.away.score,
				won: champAwayWon,
				medal: champAwayWon ? 'gold' : (champHomeWon ? 'silver' : null),
				record: getRecord(champGame.away.name),
				seed: getSeed(champGame.away.name)
			},
			home: {
				name: champGame.home.name,
				score: champGame.home.score,
				won: champHomeWon,
				medal: champHomeWon ? 'gold' : (champAwayWon ? 'silver' : null),
				record: getRecord(champGame.home.name),
				seed: getSeed(champGame.home.name)
			}
		});
	}
	
	if (thirdPlace.length > 0) {
		var thirdGame = thirdPlace[0];
		var thirdAwayWon = thirdGame.away.score != null && thirdGame.home.score != null && thirdGame.away.score > thirdGame.home.score;
		var thirdHomeWon = thirdGame.away.score != null && thirdGame.home.score != null && thirdGame.home.score > thirdGame.away.score;
		championshipRoundGames.push({
			label: 'Third Place',
			type: 'thirdPlace',
			away: {
				name: thirdGame.away.name,
				score: thirdGame.away.score,
				won: thirdAwayWon,
				medal: thirdAwayWon ? 'bronze' : null,
				record: getRecord(thirdGame.away.name),
				seed: getSeed(thirdGame.away.name)
			},
			home: {
				name: thirdGame.home.name,
				score: thirdGame.home.score,
				won: thirdHomeWon,
				medal: thirdHomeWon ? 'bronze' : null,
				record: getRecord(thirdGame.home.name),
				seed: getSeed(thirdGame.home.name)
			}
		});
	}
	
	if (championshipRoundGames.length > 0) {
		sections.push({
			label: 'Championship Round',
			games: championshipRoundGames
		});
	} else {
		// Championship round matchups not yet determined
		sections.push({
			label: 'Championship Round',
			tbd: true
		});
	}
	
	// Semifinals section (shown second)
	var semisFormatted = semis.map(function(game) {
		return {
			away: {
				name: game.away.name,
				score: game.away.score,
				won: game.away.score != null && game.home.score != null && game.away.score > game.home.score,
				record: getRecord(game.away.name),
				seed: getSeed(game.away.name)
			},
			home: {
				name: game.home.name,
				score: game.home.score,
				won: game.away.score != null && game.home.score != null && game.home.score > game.away.score,
				record: getRecord(game.home.name),
				seed: getSeed(game.home.name)
			}
		};
	}).sort(function(a, b) {
		// Sort by 1-seed's game first (as default when no user)
		var aHas1Seed = a.away.seed === 1 || a.home.seed === 1;
		var bHas1Seed = b.away.seed === 1 || b.home.seed === 1;
		if (aHas1Seed && !bHas1Seed) return -1;
		if (!aHas1Seed && bHas1Seed) return 1;
		return 0;
	});
	
	sections.push({
		label: 'Semifinals',
		games: semisFormatted
	});
	
	var hasScores = semis.some(g => g.away.score != null) || 
	                championship.some(g => g.away.score != null);
	
	return {
		title: 'Playoffs',
		sections: sections,
		hasScores: hasScores
	};
}

function formatGames(games, allSeasonGames) {
	// Build cumulative records if we have all season games
	var records = {};
	if (allSeasonGames && allSeasonGames.length > 0) {
		// Sort by week to compute cumulative records
		var sortedGames = allSeasonGames.slice().sort(function(a, b) {
			return a.week - b.week;
		});
		
		// Initialize records
		sortedGames.forEach(function(g) {
			if (!records[g.away.name]) records[g.away.name] = { wins: 0, losses: 0 };
			if (!records[g.home.name]) records[g.home.name] = { wins: 0, losses: 0 };
		});
		
		// Find the max week in our target games
		var targetWeek = Math.max.apply(null, games.map(function(g) { return g.week; }));
		
		// Check if target week games have scores (meaning they're final)
		var targetWeekHasScores = games.some(function(g) {
			return g.away.score != null && g.home.score != null;
		});
		
		// Compute records up to target week
		// If scores are present, include target week; otherwise exclude it
		sortedGames.forEach(function(g) {
			var includeGame = targetWeekHasScores ? (g.week <= targetWeek) : (g.week < targetWeek);
			if (includeGame && g.away.score != null && g.home.score != null) {
				if (g.away.score > g.home.score) {
					records[g.away.name].wins++;
					records[g.home.name].losses++;
				} else if (g.home.score > g.away.score) {
					records[g.home.name].wins++;
					records[g.away.name].losses++;
				}
			}
		});
	}
	
	return games.map(function(game) {
		var awayScore = game.away.score;
		var homeScore = game.home.score;
		var awayRecord = records[game.away.name];
		var homeRecord = records[game.home.name];
		
		return {
			away: {
				name: game.away.name,
				score: awayScore,
				won: awayScore != null && homeScore != null && awayScore > homeScore,
				record: awayRecord ? awayRecord.wins + '-' + awayRecord.losses : null
			},
			home: {
				name: game.home.name,
				score: homeScore,
				won: awayScore != null && homeScore != null && homeScore > awayScore,
				record: homeRecord ? homeRecord.wins + '-' + homeRecord.losses : null
			}
		};
	}).sort(function(a, b) {
		return a.away.name.localeCompare(b.away.name);
	});
}

// Get schedule for a specific week (for testing)
async function getScheduleForWeek(season, week, options) {
	options = options || {};
	var stripScores = options.stripScores || false;
	var noUserHighlight = options.noUserHighlight || false;
	
	// Get all regular season games for record computation
	var allRegularGames = await Game.find({
		season: season,
		type: 'regular'
	}).lean();
	
	if (week <= 15) {
		var games = allRegularGames.filter(function(g) { return g.week === week; });
		
		if (games.length === 0) {
			return null;
		}
		
		var formatted = formatGames(games, allRegularGames);
		if (stripScores) {
			formatted = formatted.map(function(g) {
				return {
					away: { name: g.away.name, score: null, won: false, record: g.away.record },
					home: { name: g.home.name, score: null, won: false, record: g.home.record }
				};
			});
		}
		
		return {
			title: 'Week ' + week,
			sections: [{ games: formatted }],
			hasScores: !stripScores && games.some(g => g.away.score != null),
			noUserHighlight: noUserHighlight
		};
	} else if (week === 16) {
		var semis = await Game.find({
			season: season,
			type: 'semifinal'
		}).lean();
		
		if (semis.length === 0) {
			return null;
		}
		
		var formatted = formatGames(semis, allRegularGames);
		if (stripScores) {
			formatted = formatted.map(function(g) {
				return {
					away: { name: g.away.name, score: null, won: false, record: g.away.record },
					home: { name: g.home.name, score: null, won: false, record: g.home.record }
				};
			});
		}
		
		return {
			title: 'Playoffs',
			sections: [{ label: 'Semifinals', games: formatted }],
			hasScores: !stripScores,
			noUserHighlight: noUserHighlight
		};
	} else {
		// Week 17 - full playoff bracket
		return await getPlayoffBracket(season);
	}
}

module.exports = {
	getScheduleWidget: getScheduleWidget,
	getScheduleForWeek: getScheduleForWeek
};
