var LeagueConfig = require('../models/LeagueConfig');
var Game = require('../models/Game');
var Regime = require('../models/Regime');
var Season = require('../models/Season');
var PSO = require('../config/pso');
var tiebreaker = require('../helpers/tiebreaker');
var divisions = require('../helpers/divisions');

/**
 * Get schedule/results for a specific week
 */
async function getWeekSchedule(season, week) {
	// Get all games for this season
	var allGames = await Game.find({ season: season }).lean();
	
	if (!allGames || allGames.length === 0) {
		return null;
	}
	
	// Determine game type based on week
	var games;
	var weekLabel;
	var isPlayoffs = false;
	
	if (week <= 15) {
		// Regular season
		games = allGames.filter(function(g) {
			return g.type === 'regular' && g.week === week;
		});
		weekLabel = 'Week ' + week;
	} else if (week === 16) {
		// Combined playoffs view - all playoff games
		games = allGames.filter(function(g) {
			return g.type === 'semifinal' || g.type === 'championship' || g.type === 'thirdPlace';
		});
		weekLabel = 'Playoffs';
		isPlayoffs = true;
	}
	
	if (!games || games.length === 0) {
		return null;
	}
	
	// Build cumulative records up to this week
	var recordData = buildCumulativeRecords(allGames, week);
	var records = recordData.strings;
	
	// Get playoff seeds from Season document for playoff weeks
	var seeds = {};
	if (isPlayoffs) {
		var seasonDoc = await Season.findById(season).lean();
		if (seasonDoc && seasonDoc.standings) {
			seasonDoc.standings.forEach(function(team) {
				if (team.playoffSeed) {
					seeds[team.franchiseName] = team.playoffSeed;
				}
			});
		}
		// Fall back to computing seeds if Season document doesn't have them
		if (Object.keys(seeds).length === 0) {
			seeds = computePlayoffSeeds(allGames);
		}
	}
	
	// Format games for display
	var formattedGames = games.map(function(game) {
		var awayWon = game.away.score != null && game.home.score != null && game.away.score > game.home.score;
		var homeWon = game.away.score != null && game.home.score != null && game.home.score > game.away.score;
		var hasScores = game.away.score != null;
		
		var formatted = {
			type: game.type,
			away: {
				franchiseId: game.away.franchiseId,
				name: game.away.name,
				score: game.away.score,
				won: awayWon,
				record: records[game.away.name] || null,
				seed: seeds[game.away.name] || null
			},
			home: {
				franchiseId: game.home.franchiseId,
				name: game.home.name,
				score: game.home.score,
				won: homeWon,
				record: records[game.home.name] || null,
				seed: seeds[game.home.name] || null
			},
			hasScores: hasScores
		};
		
		// Add labels for playoff games
		if (game.type === 'championship') {
			formatted.label = 'Championship';
		} else if (game.type === 'thirdPlace') {
			formatted.label = 'Third Place';
		} else if (game.type === 'semifinal') {
			// Determine which semifinal based on seeds
			var highSeed = Math.min(formatted.away.seed || 99, formatted.home.seed || 99);
			formatted.label = highSeed === 1 ? 'Semifinal 1' : 'Semifinal 2';
		}
		
		return formatted;
	});
	
	// Sort games - for regular season, alphabetically by away team
	// For playoffs, semifinals first (by seed), then championship, then third place
	if (isPlayoffs) {
		formattedGames.sort(function(a, b) {
			var typeOrder = { semifinal: 1, championship: 2, thirdPlace: 3 };
			var typeA = typeOrder[a.type] || 99;
			var typeB = typeOrder[b.type] || 99;
			if (typeA !== typeB) return typeA - typeB;
			
			// For semifinals, sort by higher seed first
			var aHighSeed = Math.min(a.away.seed || 99, a.home.seed || 99);
			var bHighSeed = Math.min(b.away.seed || 99, b.home.seed || 99);
			return aHighSeed - bHighSeed;
		});
	} else {
		formattedGames.sort(function(a, b) {
			return a.away.name.localeCompare(b.away.name);
		});
	}
	
	// Compute weekly stats for regular season weeks with scores
	var weeklyStats = null;
	if (!isPlayoffs && formattedGames.some(function(g) { return g.hasScores; })) {
		weeklyStats = computeWeeklyStats(formattedGames);
	}
	
	return {
		season: season,
		week: week,
		weekLabel: weekLabel,
		isPlayoffs: isPlayoffs,
		games: formattedGames,
		hasScores: formattedGames.some(function(g) { return g.hasScores; }),
		stats: weeklyStats
	};
}

/**
 * Build cumulative records up to (and including if scored) target week
 * Returns both string format and raw data
 */
function buildCumulativeRecords(allGames, targetWeek) {
	var records = {};
	
	// Initialize records from all teams in the season
	allGames.forEach(function(g) {
		if (!records[g.away.name]) {
			records[g.away.name] = { wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0, franchiseId: g.away.franchiseId };
		}
		if (!records[g.home.name]) {
			records[g.home.name] = { wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0, franchiseId: g.home.franchiseId };
		}
	});
	
	// Get regular season games up to and including target week
	var regularGames = allGames.filter(function(g) {
		return g.type === 'regular' && g.week <= targetWeek;
	});
	
	// Check if target week games have scores (meaning results are final)
	var targetWeekGames = regularGames.filter(function(g) { return g.week === targetWeek; });
	var targetWeekHasScores = targetWeekGames.some(function(g) {
		return g.away.score != null && g.home.score != null;
	});
	
	// Compute records
	regularGames.forEach(function(g) {
		// Only include games that:
		// - Are before target week, OR
		// - Are target week AND have scores
		var includeGame = (g.week < targetWeek) || (g.week === targetWeek && targetWeekHasScores);
		
		if (includeGame && g.away.score != null && g.home.score != null) {
			records[g.away.name].pointsFor += g.away.score;
			records[g.away.name].pointsAgainst += g.home.score;
			records[g.home.name].pointsFor += g.home.score;
			records[g.home.name].pointsAgainst += g.away.score;
			
			if (g.away.score > g.home.score) {
				records[g.away.name].wins++;
				records[g.home.name].losses++;
			} else if (g.home.score > g.away.score) {
				records[g.home.name].wins++;
				records[g.away.name].losses++;
			}
		}
	});
	
	// Format as strings
	var result = {};
	Object.keys(records).forEach(function(name) {
		result[name] = records[name].wins + '-' + records[name].losses;
	});
	
	return { strings: result, data: records };
}

/**
 * Compute weekly stats summary
 */
function computeWeeklyStats(games) {
	if (!games || games.length === 0) return null;
	
	// Collect all scores
	var scores = [];
	var margins = [];
	
	games.forEach(function(g) {
		if (g.away.score != null && g.home.score != null) {
			scores.push({ score: g.away.score, name: g.away.name });
			scores.push({ score: g.home.score, name: g.home.name });
			
			var margin = Math.abs(g.away.score - g.home.score);
			var winner = g.away.score > g.home.score ? g.away.name : g.home.name;
			var loser = g.away.score > g.home.score ? g.home.name : g.away.name;
			margins.push({ margin: margin, winner: winner, loser: loser });
		}
	});
	
	if (scores.length === 0) return null;
	
	// Sort scores
	scores.sort(function(a, b) { return b.score - a.score; });
	margins.sort(function(a, b) { return b.margin - a.margin; });
	
	// Calculate stats
	var sum = scores.reduce(function(acc, s) { return acc + s.score; }, 0);
	var avg = sum / scores.length;
	
	var variance = scores.reduce(function(acc, s) {
		return acc + Math.pow(s.score - avg, 2);
	}, 0) / scores.length;
	var stdDev = Math.sqrt(variance);
	
	return {
		highScore: scores[0],
		lowScore: scores[scores.length - 1],
		average: avg,
		stdDev: stdDev,
		biggestVictory: margins[0],
		smallestVictory: margins[margins.length - 1]
	};
}

/**
 * Compute all-play records up to a specific week
 * All-play: each week, you get a W/L against every other team based on your score
 */
function computeAllPlayRecords(allGames, targetWeek) {
	var regularGames = allGames.filter(function(g) {
		return g.type === 'regular' && g.week <= targetWeek && g.away.score != null;
	});
	
	// Group scores by week
	var weeklyScores = {};
	regularGames.forEach(function(g) {
		if (!weeklyScores[g.week]) weeklyScores[g.week] = {};
		weeklyScores[g.week][g.away.name] = g.away.score;
		weeklyScores[g.week][g.home.name] = g.home.score;
	});
	
	// Compute all-play record for each team
	var allPlay = {};
	
	Object.keys(weeklyScores).forEach(function(week) {
		var scores = weeklyScores[week];
		var teams = Object.keys(scores);
		
		teams.forEach(function(team) {
			if (!allPlay[team]) allPlay[team] = { wins: 0, losses: 0, ties: 0 };
			
			var myScore = scores[team];
			teams.forEach(function(opponent) {
				if (opponent === team) return;
				var oppScore = scores[opponent];
				
				if (myScore > oppScore) {
					allPlay[team].wins++;
				} else if (myScore < oppScore) {
					allPlay[team].losses++;
				} else {
					allPlay[team].ties++;
				}
			});
		});
	});
	
	return allPlay;
}

/**
 * Build standings as of a specific week with proper tiebreakers
 */
function buildStandingsForWeek(allGames, targetWeek, season) {
	var recordData = buildCumulativeRecords(allGames, targetWeek);
	var records = recordData.data;
	
	// Compute all-play records
	var allPlayRecords = computeAllPlayRecords(allGames, targetWeek);
	
	// Convert to array format expected by tiebreaker
	var teams = Object.keys(records).map(function(name) {
		return {
			id: records[name].franchiseId,
			name: name,
			wins: records[name].wins,
			losses: records[name].losses,
			ties: 0,
			pointsFor: records[name].pointsFor,
			pointsAgainst: records[name].pointsAgainst,
			allPlay: allPlayRecords[name] || null
		};
	});
	
	// Build H2H data from games up to this week
	var gamesUpToWeek = allGames.filter(function(g) {
		return g.type === 'regular' && g.week <= targetWeek && g.away.score != null;
	});
	var h2h = tiebreaker.buildH2HData(gamesUpToWeek);
	
	// Use proper tiebreaker for this season
	var sorted;
	var divisionData = null;
	var hasDivisions = divisions.hasDivisions(season);
	
	if (hasDivisions) {
		var result = divisions.sortWithDivisions(teams, h2h, season, tiebreaker.sortByRecord);
		sorted = result.standings;
		divisionData = result.divisions;
	} else {
		sorted = tiebreaker.sortByRecord(teams, h2h, season);
	}
	
	var standings = sorted.map(function(team) {
		return {
			franchiseId: team.id,
			name: team.name,
			wins: team.wins,
			losses: team.losses,
			pointsFor: team.pointsFor,
			pointsAgainst: team.pointsAgainst,
			allPlay: team.allPlay,
			division: team.division || null
		};
	});
	
	// Build division standings if applicable
	var divisionStandings = null;
	if (hasDivisions && divisionData) {
		divisionStandings = divisionData.map(function(div) {
			var divTeams = standings.filter(function(t) {
				return t.division === div.name;
			});
			return {
				name: div.name,
				teams: divTeams
			};
		});
	}
	
	return {
		standings: standings,
		hasDivisions: hasDivisions,
		divisionStandings: divisionStandings
	};
}

/**
 * Compute playoff seeds based on regular season records
 */
function computePlayoffSeeds(allGames) {
	var regularGames = allGames.filter(function(g) { return g.type === 'regular'; });
	
	var teams = {};
	regularGames.forEach(function(g) {
		if (!teams[g.away.name]) teams[g.away.name] = { wins: 0, pointsFor: 0 };
		if (!teams[g.home.name]) teams[g.home.name] = { wins: 0, pointsFor: 0 };
		
		if (g.away.score != null && g.home.score != null) {
			teams[g.away.name].pointsFor += g.away.score;
			teams[g.home.name].pointsFor += g.home.score;
			
			if (g.away.score > g.home.score) {
				teams[g.away.name].wins++;
			} else if (g.home.score > g.away.score) {
				teams[g.home.name].wins++;
			}
		}
	});
	
	// Sort by wins, then points for
	var sorted = Object.keys(teams).map(function(name) {
		return { name: name, wins: teams[name].wins, pointsFor: teams[name].pointsFor };
	}).sort(function(a, b) {
		if (b.wins !== a.wins) return b.wins - a.wins;
		return b.pointsFor - a.pointsFor;
	});
	
	// Assign seeds to top 4
	var seeds = {};
	for (var i = 0; i < Math.min(4, sorted.length); i++) {
		seeds[sorted[i].name] = i + 1;
	}
	
	return seeds;
}

/**
 * Get available weeks for a season
 */
async function getWeeksForSeason(season) {
	var games = await Game.find({ season: season }).lean();
	
	if (!games || games.length === 0) {
		return [];
	}
	
	// Collect unique weeks from regular season
	var regularWeeks = [];
	var maxRegularWeek = 0;
	
	games.forEach(function(g) {
		if (g.type === 'regular' && regularWeeks.indexOf(g.week) === -1) {
			regularWeeks.push(g.week);
			if (g.week > maxRegularWeek) maxRegularWeek = g.week;
		}
	});
	
	regularWeeks.sort(function(a, b) { return a - b; });
	
	// Check for any playoff games
	var hasPlayoffs = games.some(function(g) {
		return g.type === 'semifinal' || g.type === 'championship' || g.type === 'thirdPlace';
	});
	
	// Build weeks array with labels
	var weeks = regularWeeks.map(function(w) {
		return { week: w, label: 'Week ' + w };
	});
	
	if (hasPlayoffs) {
		weeks.push({ week: 16, label: 'Playoffs' });
	}
	
	return weeks;
}

/**
 * Get available seasons that have game data
 */
async function getAvailableSeasons() {
	var seasons = await Game.distinct('season');
	return seasons.sort(function(a, b) { return b - a; });
}

/**
 * Route handler for schedule page
 */
async function schedulePage(request, response) {
	try {
		var config = await LeagueConfig.findById('pso');
		var currentSeason = config ? config.season : new Date().getFullYear();
		
		// Get all available seasons
		var allSeasons = await getAvailableSeasons();
		
		if (allSeasons.length === 0) {
			return response.render('schedule', {
				schedule: null,
				season: currentSeason,
				week: 1,
				weeks: [],
				quickSeasons: [],
				olderSeasons: [],
				userFranchiseIds: [],
				activePage: 'schedule'
			});
		}
		
		// Parse requested season and week
		var requestedSeason = parseInt(request.params.season, 10);
		var requestedWeek = parseInt(request.params.week, 10);
		
		// Default to current/most recent season
		var season = requestedSeason || allSeasons[0];
		
		// Get weeks for this season
		var weeks = await getWeeksForSeason(season);
		
		// If no week specified, default to current week or last available
		var week;
		if (requestedWeek) {
			week = requestedWeek;
		} else if (season === currentSeason && config) {
			// Use PSO.getWeek to get current week during in-season
			var now = new Date();
			week = PSO.getWeek(now, season);
			// Clamp to available weeks
			var availableWeekNumbers = weeks.map(function(w) { return w.week; });
			if (availableWeekNumbers.indexOf(week) === -1) {
				// Default to last available week
				week = availableWeekNumbers.length > 0 ? availableWeekNumbers[availableWeekNumbers.length - 1] : 1;
			}
		} else {
			// Default to last week of season (playoffs if available)
			week = weeks.length > 0 ? weeks[weeks.length - 1].week : 1;
		}
		
		// Get schedule data
		var scheduleData = await getWeekSchedule(season, week);
		
		// Compute standings as of this week
		var standingsData = null;
		var finalStandingsData = null;
		
		if (week <= 15) {
			// Regular season - compute standings dynamically
			var allGames = await Game.find({ season: season }).lean();
			standingsData = buildStandingsForWeek(allGames, week, season);
		} else {
			// Playoffs - fetch final standings from Season document
			var seasonDoc = await Season.findById(season).lean();
			if (seasonDoc && seasonDoc.standings && seasonDoc.standings.length > 0) {
				// Mark playoff teams for display
				var standings = seasonDoc.standings.map(function(team) {
					return {
						franchiseId: team.franchiseId,
						name: team.franchiseName,
						wins: team.wins,
						losses: team.losses,
						ties: team.ties || 0,
						pointsFor: team.pointsFor,
						pointsAgainst: team.pointsAgainst,
						allPlay: team.allPlay,
						stern: team.stern,
						playoffSeed: team.playoffSeed,
						playoffWins: team.playoffWins,
						playoffLosses: team.playoffLosses,
						playoffPointsFor: team.playoffPointsFor,
						playoffPointsAgainst: team.playoffPointsAgainst,
						playoffFinish: team.playoffFinish,
						isPlayoffTeam: team.playoffSeed != null,
						division: team.division
					};
				});
				
				finalStandingsData = {
					standings: standings,
					isFinal: seasonDoc.status && seasonDoc.status.playoffsComplete,
					hasDivisions: seasonDoc.config && seasonDoc.config.hasDivisions,
					divisionStandings: null
				};
				
				// Build division standings if applicable
				if (finalStandingsData.hasDivisions && seasonDoc.config.divisions) {
					finalStandingsData.divisionStandings = seasonDoc.config.divisions.map(function(div) {
						var divTeams = standings.filter(function(t) {
							return t.division === div.name;
						});
						return {
							name: div.name,
							teams: divTeams
						};
					});
				}
			}
		}
		
		// Build season navigation - only most recent season as quick pill
		var quickSeasons = allSeasons.slice(0, 1);
		var olderSeasons = allSeasons.slice(1);
		
		// Find user's franchise IDs for the viewed season
		var userFranchiseIds = [];
		if (request.user) {
			var userRegimes = await Regime.find({ ownerIds: request.user._id }).populate('tenures.franchiseId');
			userRegimes.forEach(function(regime) {
				regime.tenures.forEach(function(tenure) {
					var wasActive = tenure.startSeason <= season && (tenure.endSeason === null || tenure.endSeason >= season);
					if (wasActive && tenure.franchiseId && tenure.franchiseId.rosterId) {
						userFranchiseIds.push(tenure.franchiseId.rosterId);
					}
				});
			});
		}
		
		response.render('schedule', {
			schedule: scheduleData,
			standingsData: standingsData,
			finalStandingsData: finalStandingsData,
			season: season,
			week: week,
			weeks: weeks,
			currentSeason: currentSeason,
			quickSeasons: quickSeasons,
			olderSeasons: olderSeasons,
			userFranchiseIds: userFranchiseIds,
			activePage: 'schedule'
		});
	} catch (err) {
		console.error('Schedule page error:', err);
		response.status(500).send('Error loading schedule');
	}
}

module.exports = {
	getWeekSchedule: getWeekSchedule,
	getWeeksForSeason: getWeeksForSeason,
	getAvailableSeasons: getAvailableSeasons,
	schedulePage: schedulePage
};
