var LeagueConfig = require('../models/LeagueConfig');
var Game = require('../models/Game');
var Regime = require('../models/Regime');
var Franchise = require('../models/Franchise');
var tiebreaker = require('../helpers/tiebreaker');
var divisions = require('../helpers/divisions');

// Build standings from game data for a given season
async function getStandingsForSeason(season, options) {
	options = options || {};
	
	// Get ALL games for the season (regular + playoffs)
	var games = await Game.find({ season: season }).lean();

	if (!games || games.length === 0) {
		return null;
	}

	// Build H2H data for tiebreaker
	var h2h = tiebreaker.buildH2HData(games);
	
	// Get tiebreaker strategy for this season
	var strategy = tiebreaker.getTiebreakerStrategy(season);
	
	// Check if this season had divisions
	var divisionConfig = divisions.getDivisionsForSeason(season);
	var hasDivisions = divisionConfig !== null;

	// Build owners object using franchiseId as key
	var owners = {};

	// First pass: identify all franchises and initialize
	games.forEach(function(game) {
		var awayId = game.away.franchiseId;
		var homeId = game.home.franchiseId;
		var awayName = game.away.name;
		var homeName = game.home.name;

		if (!owners[awayId]) {
			owners[awayId] = {
				id: awayId,
				name: awayName,
				wins: 0,
				losses: 0,
				ties: 0,
				pointsFor: 0,
				pointsAgainst: 0,
				playoffWins: 0,
				playoffLosses: 0,
				playoffPointsFor: 0,
				playoffPointsAgainst: 0,
				playoffFinish: null,
				playoffSeed: null
			};
		}

		if (!owners[homeId]) {
			owners[homeId] = {
				id: homeId,
				name: homeName,
				wins: 0,
				losses: 0,
				ties: 0,
				pointsFor: 0,
				pointsAgainst: 0,
				playoffWins: 0,
				playoffLosses: 0,
				playoffPointsFor: 0,
				playoffPointsAgainst: 0,
				playoffFinish: null,
				playoffSeed: null
			};
		}
	});

	// Determine total regular season games and weeks based on era
	// Division era (2008-2011): 10 teams × 14 weeks / 2 = 70 games
	// Expansion era (2012-2020): 12 teams × 14 weeks / 2 = 84 games
	// Modern era (2021+): 12 teams × 15 weeks / 2 = 90 games
	var totalRegularSeasonGames;
	var lastRegularSeasonWeek;
	if (hasDivisions) {
		totalRegularSeasonGames = 70; // 10 teams, 14 weeks
		lastRegularSeasonWeek = 14;
	} else if (season < 2021) {
		totalRegularSeasonGames = 84; // 12 teams, 14 weeks
		lastRegularSeasonWeek = 14;
	} else {
		totalRegularSeasonGames = 90; // 12 teams, 15 weeks
		lastRegularSeasonWeek = 15;
	}
	
	// Extract all-play and stern records from the last regular season week
	var lastWeekGames = games.filter(function(g) {
		return g.type === 'regular' && g.week === lastRegularSeasonWeek;
	});
	
	lastWeekGames.forEach(function(game) {
		['away', 'home'].forEach(function(side) {
			var franchiseId = game[side].franchiseId;
			var record = game[side].record;
			
			if (owners[franchiseId] && record) {
				if (record.allPlay && record.allPlay.cumulative) {
					owners[franchiseId].allPlay = record.allPlay.cumulative;
				}
				if (record.stern && record.stern.cumulative) {
					owners[franchiseId].stern = record.stern.cumulative;
				}
			}
		});
	});

	// Count regular season games with scores
	var gamesWithScores = 0;

	// Second pass: process game results
	games.forEach(function(game) {
		var awayId = game.away.franchiseId;
		var homeId = game.home.franchiseId;
		var awayScore = game.away.score;
		var homeScore = game.home.score;

		// Regular season games
		if (game.type === 'regular') {
			if (awayScore != null && homeScore != null) {
				gamesWithScores++;

				// Track points for/against
				owners[awayId].pointsFor += awayScore;
				owners[awayId].pointsAgainst += homeScore;
				owners[homeId].pointsFor += homeScore;
				owners[homeId].pointsAgainst += awayScore;

				// Determine winner
				if (awayScore > homeScore) {
					owners[awayId].wins++;
					owners[homeId].losses++;
				} else if (homeScore > awayScore) {
					owners[homeId].wins++;
					owners[awayId].losses++;
				} else {
					owners[awayId].ties++;
					owners[homeId].ties++;
				}
			}
		}

		// Playoff games (semifinal, thirdPlace, championship)
		var isPlayoffGame = ['semifinal', 'thirdPlace', 'championship'].includes(game.type);
		if (isPlayoffGame && awayScore != null && homeScore != null) {
			// Track playoff points
			owners[awayId].playoffPointsFor += awayScore;
			owners[awayId].playoffPointsAgainst += homeScore;
			owners[homeId].playoffPointsFor += homeScore;
			owners[homeId].playoffPointsAgainst += awayScore;

			// Track playoff wins/losses
			if (awayScore > homeScore) {
				owners[awayId].playoffWins++;
				owners[homeId].playoffLosses++;
			} else if (homeScore > awayScore) {
				owners[homeId].playoffWins++;
				owners[awayId].playoffLosses++;
			}
		}

		// Track playoff finishes and seeds
		if (game.type === 'semifinal') {
			// Mark both as semifinalists (will be upgraded if they win further)
			if (owners[awayId].playoffFinish === null) {
				owners[awayId].playoffFinish = 'fourth-place';
			}
			if (owners[homeId].playoffFinish === null) {
				owners[homeId].playoffFinish = 'fourth-place';
			}
		}

		if (game.type === 'thirdPlace' && awayScore != null && homeScore != null) {
			if (awayScore > homeScore) {
				owners[awayId].playoffFinish = 'third-place';
				owners[homeId].playoffFinish = 'fourth-place';
			} else if (homeScore > awayScore) {
				owners[homeId].playoffFinish = 'third-place';
				owners[awayId].playoffFinish = 'fourth-place';
			}
		}

		if (game.type === 'championship' && awayScore != null && homeScore != null) {
			if (awayScore > homeScore) {
				owners[awayId].playoffFinish = 'champion';
				owners[homeId].playoffFinish = 'runner-up';
			} else if (homeScore > awayScore) {
				owners[homeId].playoffFinish = 'champion';
				owners[awayId].playoffFinish = 'runner-up';
			}
		}
	});

	// Build teams array
	var allTeams = Object.values(owners);

	// Separate playoff teams from non-playoff teams
	var playoffTeams = allTeams.filter(function(t) { return t.playoffFinish !== null; });
	var nonPlayoffTeams = allTeams.filter(function(t) { return t.playoffFinish === null; });

	// Sort playoff teams by finish
	var finishOrder = { 'champion': 1, 'runner-up': 2, 'third-place': 3, 'fourth-place': 4 };
	playoffTeams.sort(function(a, b) {
		return finishOrder[a.playoffFinish] - finishOrder[b.playoffFinish];
	});
	
	// For division era, determine who were division winners vs wild cards
	// Also build sorted division standings for display
	var divisionStandings = {};
	if (hasDivisions && divisionConfig) {
		// Find the division winner for each division (best record in that division)
		divisionConfig.divisions.forEach(function(div) {
			// Get all teams in this division
			var divTeams = allTeams.filter(function(t) {
				return div.franchiseIds.includes(t.id);
			});
			
			// Sort by record to find division winner
			var sortedDiv = tiebreaker.sortByRecord(divTeams, h2h, season);
			if (sortedDiv.length > 0) {
				var divWinner = sortedDiv[0];
				divWinner.divisionWinner = true;
			}
			
			// Store sorted order for this division (by franchise ID)
			divisionStandings[div.name] = sortedDiv.map(function(t) { return t.id; });
		});
		
		// Assign division names to all teams
		allTeams.forEach(function(team) {
			var div = divisions.getDivisionForFranchise(team.id, season);
			if (div) {
				team.division = div.name;
			}
		});
		
		// Mark wild cards: playoff teams that are NOT division winners
		var wildCardNum = 1;
		playoffTeams.forEach(function(team) {
			if (!team.divisionWinner) {
				team.wildCard = wildCardNum++;
			}
		});
		
		// Assign playoff seeds for division era
		// Division winners get seeds 1-2, tiebroken by H2H against each other
		var divWinners = allTeams.filter(function(t) { return t.divisionWinner; });
		var sortedDivWinners = tiebreaker.sortByRecord(divWinners, h2h, season);
		sortedDivWinners.forEach(function(t, i) { t.playoffSeed = i + 1; });
		
		// Wild cards get seeds 3-4 (already sorted by wildCard number)
		playoffTeams.forEach(function(t) {
			if (t.wildCard) {
				t.playoffSeed = t.wildCard + 2; // WC1 = seed 3, WC2 = seed 4
			}
		});
	} else {
		// Post-division era: Top 4 by record get seeds 1-4
		var sortedForSeeds = tiebreaker.sortByRecord(allTeams, h2h, season);
		sortedForSeeds.slice(0, 4).forEach(function(t, i) { t.playoffSeed = i + 1; });
	}

	// Sort non-playoff teams by record with proper tiebreaker
	var sortedNonPlayoff = tiebreaker.sortByRecord(nonPlayoffTeams, h2h, season);

	// Combine: playoff teams first, then non-playoff teams
	var standings = playoffTeams.concat(sortedNonPlayoff);

	// Determine if standings are finalized (all regular season games played)
	var isFinal = gamesWithScores >= totalRegularSeasonGames;

	// Format standings for display
	var result = standings.map(function(owner, index) {
		var team = {
			rank: index + 1,
			franchiseId: owner.id,
			name: owner.name,
			wins: owner.wins,
			losses: owner.losses,
			ties: owner.ties,
			pointsFor: owner.pointsFor,
			pointsAgainst: owner.pointsAgainst,
			pointDiff: owner.pointsFor - owner.pointsAgainst,
			playoffWins: owner.playoffWins,
			playoffLosses: owner.playoffLosses,
			playoffPointsFor: owner.playoffPointsFor,
			playoffPointsAgainst: owner.playoffPointsAgainst,
			isPlayoffTeam: owner.playoffFinish !== null,
			playoffFinish: owner.playoffFinish
		};
		
		// Add division info if applicable
		if (hasDivisions) {
			team.division = owner.division;
			if (owner.divisionWinner) {
				team.divisionWinner = true;
			}
			if (owner.wildCard) {
				team.wildCard = owner.wildCard;
			}
		}
		
		// Add playoff seed if assigned
		if (owner.playoffSeed) {
			team.playoffSeed = owner.playoffSeed;
		}
		
		// Add all-play and stern records if available
		if (owner.allPlay) {
			team.allPlay = owner.allPlay;
		}
		if (owner.stern) {
			team.stern = owner.stern;
		}
		
		return team;
	});

	var response = {
		season: season,
		standings: result,
		isFinal: isFinal,
		gamesPlayed: gamesWithScores,
		totalGames: totalRegularSeasonGames,
		tiebreakerStrategy: {
			name: strategy.name,
			description: strategy.description
		}
	};
	
	// Add division info if applicable
	if (hasDivisions) {
		response.hasDivisions = true;
		response.divisions = divisionConfig.divisions.map(function(d) {
			return { key: d.key, name: d.name };
		});
		response.divisionStandings = divisionStandings;
	}
	
	// Add playoff games for display
	var playoffGames = games
		.filter(function(g) {
			return ['semifinal', 'thirdPlace', 'championship'].includes(g.type);
		})
		.filter(function(g) {
			// Only include games that have scores
			return g.away.score != null && g.home.score != null;
		})
		.sort(function(a, b) {
			// Sort by week ascending (semifinals first), then by type
			if (a.week !== b.week) return a.week - b.week;
			var typeOrder = { semifinal: 1, championship: 2, thirdPlace: 3 };
			return typeOrder[a.type] - typeOrder[b.type];
		})
		.map(function(g) {
			// Look up seeds for each team
			var awaySeed = null;
			var homeSeed = null;
			result.forEach(function(t) {
				if (t.franchiseId === g.away.franchiseId) awaySeed = t.playoffSeed;
				if (t.franchiseId === g.home.franchiseId) homeSeed = t.playoffSeed;
			});
			
			return {
				type: g.type,
				week: g.week,
				label: g.type === 'semifinal' ? 'Semifinal' : (g.type === 'championship' ? 'Championship' : '3rd Place'),
				away: {
					franchiseId: g.away.franchiseId,
					name: g.away.name,
					score: g.away.score,
					seed: awaySeed,
					won: g.away.score != null && g.home.score != null && g.away.score > g.home.score
				},
				home: {
					franchiseId: g.home.franchiseId,
					name: g.home.name,
					score: g.home.score,
					seed: homeSeed,
					won: g.away.score != null && g.home.score != null && g.home.score > g.away.score
				}
			};
		});
	
	if (playoffGames.length > 0) {
		response.playoffGames = playoffGames;
	}

	return response;
}

// Get available seasons for navigation
async function getAvailableSeasons() {
	var seasons = await Game.distinct('season');
	return seasons.sort(function(a, b) { return b - a; }); // Most recent first
}

// Route handler
async function standingsPage(request, response) {
	try {
		var config = await LeagueConfig.findById('pso');
		var currentSeason = config ? config.season : new Date().getFullYear();
		
		// Get all available seasons for navigation (needed for default logic too)
		var allSeasons = await getAvailableSeasons();
		
		// Allow viewing any season via path param or query param
		var requestedSeason = parseInt(request.params.season, 10) || parseInt(request.query.season, 10);
		
		// Default to most recent season with data
		var season = requestedSeason || (allSeasons.length > 0 ? allSeasons[0] : currentSeason);
		
		// Get standings for requested season
		var standingsData = await getStandingsForSeason(season);
		
		// Quick seasons: two most recent seasons with data, ordered [last, current]
		// This handles the case where currentSeason has no games yet
		var quickSeasons = allSeasons.slice(0, 2).reverse();
		
		// Older seasons: everything except the quick seasons (for dropdown)
		var olderSeasons = allSeasons.slice(2);
		
		// Find user's franchise IDs for the viewed season (if logged in)
		var userFranchiseIds = [];
		if (request.user) {
			// Find all regimes the user is/was part of
			var userRegimes = await Regime.find({
				ownerIds: request.user._id
			}).populate('tenures.franchiseId');
			
			// Get franchise rosterIds for tenures active during the viewed season
			userRegimes.forEach(function(regime) {
				regime.tenures.forEach(function(tenure) {
					var wasActive = tenure.startSeason <= season && 
						(tenure.endSeason === null || tenure.endSeason >= season);
					if (wasActive && tenure.franchiseId && tenure.franchiseId.rosterId) {
						userFranchiseIds.push(tenure.franchiseId.rosterId);
					}
				});
			});
		}
		
		response.render('standings', {
			season: season,
			currentSeason: currentSeason,
			standings: standingsData,
			quickSeasons: quickSeasons,
			olderSeasons: olderSeasons,
			userFranchiseIds: userFranchiseIds,
			activePage: 'standings'
		});
	} catch (err) {
		console.error('Standings error:', err);
		response.status(500).send('Error loading standings');
	}
}

module.exports = {
	getStandingsForSeason: getStandingsForSeason,
	getAvailableSeasons: getAvailableSeasons,
	standingsPage: standingsPage
};
