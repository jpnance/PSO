/**
 * Compute and store season-level data (standings, playoff seeds, results)
 * 
 * Run via: node data/analysis/seasons.js [season]
 * If no season specified, processes all seasons with game data
 * 
 * Options:
 *   --clear   Clear all existing Season documents before processing
 * 
 * Added to results.sh to run after games.js
 */

var dotenv = require('dotenv').config({ path: '/app/.env' });

var mongoose = require('mongoose');
mongoose.connect(process.env.MONGODB_URI);

var Game = require('../models/Game');
var Season = require('../../models/Season');
var tiebreaker = require('../../helpers/tiebreaker');
var divisions = require('../../helpers/divisions');

// Parse command line arguments
var clearExisting = process.argv.includes('--clear');
var requestedSeason = null;
process.argv.slice(2).forEach(function(arg) {
	if (!arg.startsWith('--')) {
		requestedSeason = parseInt(arg, 10);
	}
});

async function processSeasons() {
	try {
		// Clear existing if requested
		if (clearExisting) {
			console.log('Clearing existing Season documents...');
			await Season.deleteMany({});
		}
		
		// Get all seasons with game data
		var allSeasons = await Game.distinct('season');
		var seasonsToProcess = requestedSeason ? [requestedSeason] : allSeasons.sort();
		
		console.log('Processing seasons:', seasonsToProcess.join(', '));
		
		for (var season of seasonsToProcess) {
			await processSeason(season);
		}
		
		console.log('Done');
		mongoose.disconnect();
	} catch (err) {
		console.error('Error:', err);
		mongoose.disconnect();
		process.exit(1);
	}
}

async function processSeason(season) {
	console.log('Processing season', season);
	
	// Get all games for this season
	var games = await Game.find({ season: season }).lean();
	
	if (!games || games.length === 0) {
		console.log('  No games found, skipping');
		return;
	}
	
	// Build H2H data for tiebreaker
	var h2h = tiebreaker.buildH2HData(games);
	
	// Check if this season had divisions
	var divisionConfig = divisions.getDivisionsForSeason(season);
	var hasDivisions = divisionConfig !== null;
	
	// Determine season config
	var regularSeasonWeeks, teamCount, totalRegularSeasonGames;
	if (hasDivisions) {
		regularSeasonWeeks = 14;
		teamCount = 10;
		totalRegularSeasonGames = 70;
	} else if (season < 2021) {
		regularSeasonWeeks = 14;
		teamCount = 12;
		totalRegularSeasonGames = 84;
	} else {
		regularSeasonWeeks = 15;
		teamCount = 12;
		totalRegularSeasonGames = 90;
	}
	
	// Build franchise data from games
	var franchises = {};
	var regularSeasonGamesPlayed = 0;
	
	games.forEach(function(game) {
		// Initialize franchises
		['away', 'home'].forEach(function(side) {
			var id = game[side].franchiseId;
			var name = game[side].name;
			
			if (!franchises[id]) {
				franchises[id] = {
					id: id,
					name: name,
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
					allPlay: null,
					stern: null
				};
			}
		});
		
		var awayId = game.away.franchiseId;
		var homeId = game.home.franchiseId;
		var awayScore = game.away.score;
		var homeScore = game.home.score;
		
		// Regular season games
		if (game.type === 'regular' && awayScore != null && homeScore != null) {
			regularSeasonGamesPlayed++;
			
			franchises[awayId].pointsFor += awayScore;
			franchises[awayId].pointsAgainst += homeScore;
			franchises[homeId].pointsFor += homeScore;
			franchises[homeId].pointsAgainst += awayScore;
			
			if (awayScore > homeScore) {
				franchises[awayId].wins++;
				franchises[homeId].losses++;
			} else if (homeScore > awayScore) {
				franchises[homeId].wins++;
				franchises[awayId].losses++;
			} else {
				franchises[awayId].ties++;
				franchises[homeId].ties++;
			}
			
			// Capture all-play and stern from last regular season week
			if (game.week === regularSeasonWeeks) {
				if (game.away.record && game.away.record.allPlay && game.away.record.allPlay.cumulative) {
					franchises[awayId].allPlay = game.away.record.allPlay.cumulative;
				}
				if (game.away.record && game.away.record.stern && game.away.record.stern.cumulative) {
					franchises[awayId].stern = game.away.record.stern.cumulative;
				}
				if (game.home.record && game.home.record.allPlay && game.home.record.allPlay.cumulative) {
					franchises[homeId].allPlay = game.home.record.allPlay.cumulative;
				}
				if (game.home.record && game.home.record.stern && game.home.record.stern.cumulative) {
					franchises[homeId].stern = game.home.record.stern.cumulative;
				}
			}
		}
		
		// Playoff games
		var isPlayoffGame = ['semifinal', 'thirdPlace', 'championship'].includes(game.type);
		if (isPlayoffGame && awayScore != null && homeScore != null) {
			franchises[awayId].playoffPointsFor += awayScore;
			franchises[awayId].playoffPointsAgainst += homeScore;
			franchises[homeId].playoffPointsFor += homeScore;
			franchises[homeId].playoffPointsAgainst += awayScore;
			
			if (awayScore > homeScore) {
				franchises[awayId].playoffWins++;
				franchises[homeId].playoffLosses++;
			} else if (homeScore > awayScore) {
				franchises[homeId].playoffWins++;
				franchises[awayId].playoffLosses++;
			}
		}
		
		// Track playoff finishes
		if (game.type === 'semifinal') {
			if (franchises[awayId].playoffFinish === null) {
				franchises[awayId].playoffFinish = 'fourth-place';
			}
			if (franchises[homeId].playoffFinish === null) {
				franchises[homeId].playoffFinish = 'fourth-place';
			}
		}
		
		if (game.type === 'thirdPlace' && awayScore != null && homeScore != null) {
			if (awayScore > homeScore) {
				franchises[awayId].playoffFinish = 'third-place';
				franchises[homeId].playoffFinish = 'fourth-place';
			} else if (homeScore > awayScore) {
				franchises[homeId].playoffFinish = 'third-place';
				franchises[awayId].playoffFinish = 'fourth-place';
			}
		}
		
		if (game.type === 'championship' && awayScore != null && homeScore != null) {
			if (awayScore > homeScore) {
				franchises[awayId].playoffFinish = 'champion';
				franchises[homeId].playoffFinish = 'runner-up';
			} else if (homeScore > awayScore) {
				franchises[homeId].playoffFinish = 'champion';
				franchises[awayId].playoffFinish = 'runner-up';
			}
		}
	});
	
	var allTeams = Object.values(franchises);
	var regularSeasonComplete = regularSeasonGamesPlayed >= totalRegularSeasonGames;
	
	// Separate playoff and non-playoff teams
	var playoffTeams = allTeams.filter(function(t) { return t.playoffFinish !== null; });
	var nonPlayoffTeams = allTeams.filter(function(t) { return t.playoffFinish === null; });
	
	// Sort playoff teams by finish, with record as tiebreaker for same finish
	playoffTeams = tiebreaker.sortByPlayoffFinish(playoffTeams, h2h, season);
	
	// Sort non-playoff teams by record with tiebreaker
	var sortedNonPlayoff = tiebreaker.sortByRecord(nonPlayoffTeams, h2h, season);
	
	// Combine standings
	var rankedTeams = playoffTeams.concat(sortedNonPlayoff);
	
	// Handle division-specific logic
	var divisionStandings = [];
	
	if (hasDivisions && divisionConfig) {
		// Assign division names
		allTeams.forEach(function(team) {
			var div = divisions.getDivisionForFranchise(team.id, season);
			if (div) {
				team.division = div.name;
			}
		});
		
		// Find division winners and build division standings
		divisionConfig.divisions.forEach(function(div) {
			var divTeams = allTeams.filter(function(t) {
				return div.franchiseIds.includes(t.id);
			});
			
			var sortedDiv = tiebreaker.sortByRecord(divTeams, h2h, season);
			if (sortedDiv.length > 0) {
				sortedDiv[0].divisionWinner = true;
			}
			
			divisionStandings.push({
				name: div.name,
				franchiseIds: sortedDiv.map(function(t) { return t.id; })
			});
		});
		
		// Assign wild cards (playoff teams that aren't division winners, sorted by record)
		var wildCardTeams = playoffTeams.filter(function(t) { return !t.divisionWinner; });
		var sortedWildCards = tiebreaker.sortByRecord(wildCardTeams, h2h, season);
		sortedWildCards.forEach(function(team, i) {
			team.wildCard = i + 1;
		});
	}
	
	// Assign playoff seeds (only when regular season complete)
	if (regularSeasonComplete) {
		if (hasDivisions) {
			// Division winners get seeds 1-2, tiebroken by H2H
			var divWinners = allTeams.filter(function(t) { return t.divisionWinner; });
			var sortedDivWinners = tiebreaker.sortByRecord(divWinners, h2h, season);
			sortedDivWinners.forEach(function(t, i) { t.playoffSeed = i + 1; });
			
			// Wild cards get seeds 3-4
			playoffTeams.forEach(function(t) {
				if (t.wildCard) {
					t.playoffSeed = t.wildCard + 2;
				}
			});
		} else {
			// Top 4 by record get seeds 1-4
			var sortedForSeeds = tiebreaker.sortByRecord(allTeams, h2h, season);
			sortedForSeeds.slice(0, 4).forEach(function(t, i) { t.playoffSeed = i + 1; });
		}
	}
	
	// Build playoff games array
	var playoffGames = [];
	var seedLookup = {};
	allTeams.forEach(function(t) { if (t.playoffSeed) seedLookup[t.id] = t.playoffSeed; });
	
	// Order: semifinals first, then championship/third-place
	var gameOrder = { 'semifinal': 1, 'championship': 2, 'thirdPlace': 3 };
	var playoffGameData = games
		.filter(function(g) { return ['semifinal', 'thirdPlace', 'championship'].includes(g.type); })
		.filter(function(g) { return g.away.score != null && g.home.score != null; })
		.sort(function(a, b) { return gameOrder[a.type] - gameOrder[b.type]; });
	
	playoffGameData.forEach(function(game) {
		var awayWins = game.away.score > game.home.score;
		playoffGames.push({
			type: game.type,
			away: {
				franchiseId: game.away.franchiseId,
				name: game.away.name,
				seed: seedLookup[game.away.franchiseId],
				score: game.away.score
			},
			home: {
				franchiseId: game.home.franchiseId,
				name: game.home.name,
				seed: seedLookup[game.home.franchiseId],
				score: game.home.score
			},
			winner: awayWins ? 'away' : 'home'
		});
	});
	
	var playoffsComplete = playoffGameData.some(function(g) { return g.type === 'championship'; });
	
	// Build standings array
	var standings = rankedTeams.map(function(team, index) {
		var standing = {
			rank: index + 1,
			franchiseId: team.id,
			franchiseName: team.name,
			wins: team.wins,
			losses: team.losses,
			ties: team.ties,
			pointsFor: team.pointsFor,
			pointsAgainst: team.pointsAgainst
		};
		
		if (team.division) standing.division = team.division;
		if (team.allPlay) standing.allPlay = team.allPlay;
		if (team.stern) standing.stern = team.stern;
		
		// Playoff qualification (only when regular season complete)
		if (regularSeasonComplete && team.playoffSeed) {
			standing.playoffSeed = team.playoffSeed;
		}
		if (team.divisionWinner) standing.divisionWinner = true;
		if (team.wildCard) standing.wildCard = team.wildCard;
		
		// Playoff performance
		if (team.playoffFinish) {
			standing.playoffFinish = team.playoffFinish;
			standing.playoffWins = team.playoffWins;
			standing.playoffLosses = team.playoffLosses;
			standing.playoffPointsFor = team.playoffPointsFor;
			standing.playoffPointsAgainst = team.playoffPointsAgainst;
		}
		
		return standing;
	});
	
	// Build season document
	var seasonDoc = {
		_id: season,
		standings: standings,
		divisionStandings: divisionStandings,
		playoffGames: playoffGames,
		status: {
			regularSeasonComplete: regularSeasonComplete,
			playoffsComplete: playoffsComplete,
			gamesPlayed: regularSeasonGamesPlayed,
			totalRegularSeasonGames: totalRegularSeasonGames
		},
		config: {
			hasDivisions: hasDivisions,
			divisions: hasDivisions ? divisionConfig.divisions.map(function(d) {
				return { name: d.name, franchiseIds: d.franchiseIds };
			}) : [],
			tiebreakerAlgorithm: season >= 2020 ? 'h2h-percentage' : 'h2h-graduation',
			regularSeasonWeeks: regularSeasonWeeks,
			teamCount: teamCount
		}
	};
	
	// Upsert the season document
	await Season.findByIdAndUpdate(season, seasonDoc, { upsert: true });
	
	console.log('  Saved:', standings.length, 'teams,', playoffGames.length, 'playoff games');
}

processSeasons();
