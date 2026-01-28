var LeagueConfig = require('../models/LeagueConfig');
var Game = require('../models/Game');
var Regime = require('../models/Regime');
var Season = require('../models/Season');
var tiebreaker = require('../helpers/tiebreaker');

/**
 * Get standings for a season, reading from the Season model
 * Falls back to computing from games if no Season document exists
 */
async function getStandingsForSeason(season) {
	// Try to load pre-computed season data
	var seasonDoc = await Season.findById(season).lean();
	
	if (seasonDoc && seasonDoc.standings && seasonDoc.standings.length > 0) {
		return formatSeasonDocForDisplay(seasonDoc);
	}
	
	// Fall back to computing from games (for seasons not yet processed)
	return computeStandingsFromGames(season);
}

/**
 * Format Season document for display
 */
function formatSeasonDocForDisplay(seasonDoc) {
	var strategy = tiebreaker.getTiebreakerStrategy(seasonDoc._id);
	
	// Format standings with computed fields
	var standings = seasonDoc.standings.map(function(team) {
		return {
			rank: team.rank,
			franchiseId: team.franchiseId,
			name: team.franchiseName,
			wins: team.wins,
			losses: team.losses,
			ties: team.ties,
			pointsFor: team.pointsFor,
			pointsAgainst: team.pointsAgainst,
			pointDiff: team.pointsFor - team.pointsAgainst,
			allPlay: team.allPlay,
			stern: team.stern,
			division: team.division,
			divisionWinner: team.divisionWinner,
			wildCard: team.wildCard,
			playoffSeed: team.playoffSeed,
			isPlayoffTeam: team.playoffFinish != null,
			playoffFinish: team.playoffFinish,
			playoffWins: team.playoffWins,
			playoffLosses: team.playoffLosses,
			playoffPointsFor: team.playoffPointsFor,
			playoffPointsAgainst: team.playoffPointsAgainst
		};
	});
	
	var response = {
		season: seasonDoc._id,
		standings: standings,
		isFinal: seasonDoc.status.regularSeasonComplete,
		gamesPlayed: seasonDoc.status.gamesPlayed,
		totalGames: seasonDoc.status.totalRegularSeasonGames,
		tiebreakerStrategy: {
			name: strategy.name,
			description: strategy.description
		}
	};
	
	// Add division info if applicable
	if (seasonDoc.config.hasDivisions) {
		response.hasDivisions = true;
		response.divisions = seasonDoc.config.divisions.map(function(d) {
			return { name: d.name };
		});
		
		// Convert divisionStandings array to object keyed by name
		response.divisionStandings = {};
		seasonDoc.divisionStandings.forEach(function(ds) {
			response.divisionStandings[ds.name] = ds.franchiseIds;
		});
	}
	
	// Format playoff games for display
	if (seasonDoc.playoffGames && seasonDoc.playoffGames.length > 0) {
		// Build record lookup from standings (use string keys for consistent lookup)
		var recordLookup = {};
		response.standings.forEach(function(t) {
			recordLookup[String(t.franchiseId)] = t.wins + '-' + t.losses + (t.ties ? '-' + t.ties : '');
		});
		
		response.playoffGames = seasonDoc.playoffGames.map(function(g) {
			return {
				type: g.type,
				label: g.type === 'semifinal' ? 'Semifinal' : (g.type === 'championship' ? 'Championship' : 'Third Place'),
				away: {
					franchiseId: g.away.franchiseId,
					name: g.away.name,
					score: g.away.score,
					seed: g.away.seed,
					won: g.winner === 'away',
					record: recordLookup[String(g.away.franchiseId)] || null
				},
				home: {
					franchiseId: g.home.franchiseId,
					name: g.home.name,
					score: g.home.score,
					seed: g.home.seed,
					won: g.winner === 'home',
					record: recordLookup[String(g.home.franchiseId)] || null
				}
			};
		});
	}
	
	return response;
}

/**
 * Compute standings from games (fallback for seasons without Season document)
 */
async function computeStandingsFromGames(season) {
	var Game = require('../models/Game');
	var divisions = require('../helpers/divisions');
	
	var games = await Game.find({ season: season }).lean();
	
	if (!games || games.length === 0) {
		return null;
	}
	
	var h2h = tiebreaker.buildH2HData(games);
	var strategy = tiebreaker.getTiebreakerStrategy(season);
	var divisionConfig = divisions.getDivisionsForSeason(season);
	var hasDivisions = divisionConfig !== null;
	
	// Determine era-specific config
	var totalRegularSeasonGames, lastRegularSeasonWeek;
	if (hasDivisions) {
		totalRegularSeasonGames = 70;
		lastRegularSeasonWeek = 14;
	} else if (season < 2021) {
		totalRegularSeasonGames = 84;
		lastRegularSeasonWeek = 14;
	} else {
		totalRegularSeasonGames = 90;
		lastRegularSeasonWeek = 15;
	}
	
	// Build franchise data
	var owners = {};
	var gamesWithScores = 0;
	
	games.forEach(function(game) {
		['away', 'home'].forEach(function(side) {
			var id = game[side].franchiseId;
			if (!owners[id]) {
				owners[id] = {
					id: id,
					name: game[side].name,
					wins: 0, losses: 0, ties: 0,
					pointsFor: 0, pointsAgainst: 0,
					playoffWins: 0, playoffLosses: 0,
					playoffPointsFor: 0, playoffPointsAgainst: 0,
					playoffFinish: null, playoffSeed: null
				};
			}
		});
		
		var awayId = game.away.franchiseId;
		var homeId = game.home.franchiseId;
		
		if (game.type === 'regular' && game.away.score != null && game.home.score != null) {
			gamesWithScores++;
			owners[awayId].pointsFor += game.away.score;
			owners[awayId].pointsAgainst += game.home.score;
			owners[homeId].pointsFor += game.home.score;
			owners[homeId].pointsAgainst += game.away.score;
			
			if (game.away.score > game.home.score) {
				owners[awayId].wins++;
				owners[homeId].losses++;
			} else if (game.home.score > game.away.score) {
				owners[homeId].wins++;
				owners[awayId].losses++;
			} else {
				owners[awayId].ties++;
				owners[homeId].ties++;
			}
			
			// Capture all-play/stern from last week
			if (game.week === lastRegularSeasonWeek) {
				['away', 'home'].forEach(function(side) {
					var fid = game[side].franchiseId;
					var record = game[side].record;
					if (record) {
						if (record.allPlay && record.allPlay.cumulative) {
							owners[fid].allPlay = record.allPlay.cumulative;
						}
						if (record.stern && record.stern.cumulative) {
							owners[fid].stern = record.stern.cumulative;
						}
					}
				});
			}
		}
		
		// Playoff games
		if (['semifinal', 'thirdPlace', 'championship'].includes(game.type) && 
			game.away.score != null && game.home.score != null) {
			owners[awayId].playoffPointsFor += game.away.score;
			owners[awayId].playoffPointsAgainst += game.home.score;
			owners[homeId].playoffPointsFor += game.home.score;
			owners[homeId].playoffPointsAgainst += game.away.score;
			
			if (game.away.score > game.home.score) {
				owners[awayId].playoffWins++;
				owners[homeId].playoffLosses++;
			} else {
				owners[homeId].playoffWins++;
				owners[awayId].playoffLosses++;
			}
		}
		
		// Track finishes
		if (game.type === 'semifinal') {
			if (!owners[awayId].playoffFinish) owners[awayId].playoffFinish = 'fourth-place';
			if (!owners[homeId].playoffFinish) owners[homeId].playoffFinish = 'fourth-place';
		}
		if (game.type === 'thirdPlace' && game.away.score != null) {
			if (game.away.score > game.home.score) {
				owners[awayId].playoffFinish = 'third-place';
			} else {
				owners[homeId].playoffFinish = 'third-place';
			}
		}
		if (game.type === 'championship' && game.away.score != null) {
			if (game.away.score > game.home.score) {
				owners[awayId].playoffFinish = 'champion';
				owners[homeId].playoffFinish = 'runner-up';
			} else {
				owners[homeId].playoffFinish = 'champion';
				owners[awayId].playoffFinish = 'runner-up';
			}
		}
	});
	
	var allTeams = Object.values(owners);
	var playoffTeams = allTeams.filter(function(t) { return t.playoffFinish; });
	var nonPlayoffTeams = allTeams.filter(function(t) { return !t.playoffFinish; });
	
	var finishOrder = { 'champion': 1, 'runner-up': 2, 'third-place': 3, 'fourth-place': 4 };
	playoffTeams.sort(function(a, b) { return finishOrder[a.playoffFinish] - finishOrder[b.playoffFinish]; });
	
	var sortedNonPlayoff = tiebreaker.sortByRecord(nonPlayoffTeams, h2h, season);
	var standings = playoffTeams.concat(sortedNonPlayoff);
	
	var isFinal = gamesWithScores >= totalRegularSeasonGames;
	
	// Handle divisions
	var divisionStandings = {};
	if (hasDivisions && divisionConfig) {
		divisionConfig.divisions.forEach(function(div) {
			var divTeams = allTeams.filter(function(t) { return div.franchiseIds.includes(t.id); });
			var sortedDiv = tiebreaker.sortByRecord(divTeams, h2h, season);
			if (sortedDiv.length > 0) sortedDiv[0].divisionWinner = true;
			divisionStandings[div.name] = sortedDiv.map(function(t) { return t.id; });
		});
		
		allTeams.forEach(function(t) {
			var div = divisions.getDivisionForFranchise(t.id, season);
			if (div) t.division = div.name;
		});
		
		var wcNum = 1;
		playoffTeams.forEach(function(t) { if (!t.divisionWinner) t.wildCard = wcNum++; });
		
		if (isFinal) {
			var divWinners = allTeams.filter(function(t) { return t.divisionWinner; });
			var sortedDW = tiebreaker.sortByRecord(divWinners, h2h, season);
			sortedDW.forEach(function(t, i) { t.playoffSeed = i + 1; });
			playoffTeams.forEach(function(t) { if (t.wildCard) t.playoffSeed = t.wildCard + 2; });
		}
	} else if (isFinal) {
		var sorted = tiebreaker.sortByRecord(allTeams, h2h, season);
		sorted.slice(0, 4).forEach(function(t, i) { t.playoffSeed = i + 1; });
	}
	
	var result = standings.map(function(o, i) {
		var team = {
			rank: i + 1,
			franchiseId: o.id,
			name: o.name,
			wins: o.wins, losses: o.losses, ties: o.ties,
			pointsFor: o.pointsFor, pointsAgainst: o.pointsAgainst,
			pointDiff: o.pointsFor - o.pointsAgainst,
			isPlayoffTeam: o.playoffFinish != null,
			playoffFinish: o.playoffFinish,
			playoffWins: o.playoffWins, playoffLosses: o.playoffLosses,
			playoffPointsFor: o.playoffPointsFor, playoffPointsAgainst: o.playoffPointsAgainst
		};
		if (o.division) team.division = o.division;
		if (o.divisionWinner) team.divisionWinner = true;
		if (o.wildCard) team.wildCard = o.wildCard;
		if (o.playoffSeed) team.playoffSeed = o.playoffSeed;
		if (o.allPlay) team.allPlay = o.allPlay;
		if (o.stern) team.stern = o.stern;
		return team;
	});
	
	var response = {
		season: season,
		standings: result,
		isFinal: isFinal,
		gamesPlayed: gamesWithScores,
		totalGames: totalRegularSeasonGames,
		tiebreakerStrategy: { name: strategy.name, description: strategy.description }
	};
	
	if (hasDivisions) {
		response.hasDivisions = true;
		response.divisions = divisionConfig.divisions.map(function(d) { return { name: d.name }; });
		response.divisionStandings = divisionStandings;
	}
	
	// Playoff games
	var playoffGames = games
		.filter(function(g) { return ['semifinal', 'thirdPlace', 'championship'].includes(g.type) && g.away.score != null; })
		.sort(function(a, b) {
			var order = { semifinal: 1, championship: 2, thirdPlace: 3 };
			return order[a.type] - order[b.type];
		})
		.map(function(g) {
			var awayTeam = result.find(function(t) { return t.franchiseId === g.away.franchiseId; });
			var homeTeam = result.find(function(t) { return t.franchiseId === g.home.franchiseId; });
			var awayRecord = awayTeam ? awayTeam.wins + '-' + awayTeam.losses + (awayTeam.ties ? '-' + awayTeam.ties : '') : null;
			var homeRecord = homeTeam ? homeTeam.wins + '-' + homeTeam.losses + (homeTeam.ties ? '-' + homeTeam.ties : '') : null;
			return {
				type: g.type,
				label: g.type === 'semifinal' ? 'Semifinal' : (g.type === 'championship' ? 'Championship' : '3rd Place'),
				away: { franchiseId: g.away.franchiseId, name: g.away.name, score: g.away.score, seed: awayTeam ? awayTeam.playoffSeed : null, won: g.away.score > g.home.score, record: awayRecord },
				home: { franchiseId: g.home.franchiseId, name: g.home.name, score: g.home.score, seed: homeTeam ? homeTeam.playoffSeed : null, won: g.home.score > g.away.score, record: homeRecord }
			};
		});
	
	if (playoffGames.length > 0) response.playoffGames = playoffGames;
	
	return response;
}

// Get available seasons for navigation
async function getAvailableSeasons() {
	var seasons = await Season.distinct('_id');
	if (seasons.length === 0) {
		// Fall back to games if no Season documents
		seasons = await Game.distinct('season');
	}
	return seasons.sort(function(a, b) { return b - a; });
}

// Route handler
async function standingsPage(request, response) {
	try {
		var config = await LeagueConfig.findById('pso');
		var currentSeason = config ? config.season : new Date().getFullYear();
		
		var allSeasons = await getAvailableSeasons();
		var requestedSeason = parseInt(request.params.season, 10) || parseInt(request.query.season, 10);
		var season = requestedSeason || (allSeasons.length > 0 ? allSeasons[0] : currentSeason);
		
		var standingsData = await getStandingsForSeason(season);
		
		var quickSeasons = allSeasons.slice(0, 2).reverse();
		var olderSeasons = allSeasons.slice(2);
		
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
