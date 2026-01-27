// Standings helper for homepage widget
// Reads from Season model when available

var Season = require('../models/Season');
var Game = require('../models/Game');
var tiebreaker = require('./tiebreaker');

/**
 * Get standings for a season (for homepage widget)
 * Reads from Season model, falls back to computing from games
 */
async function getStandingsForSeason(season) {
	// Try to load pre-computed season data
	var seasonDoc = await Season.findById(season).lean();
	
	if (seasonDoc && seasonDoc.standings && seasonDoc.standings.length > 0) {
		return formatSeasonDoc(seasonDoc);
	}
	
	// Fall back to computing from games
	return computeFromGames(season);
}

/**
 * Format Season document for homepage widget
 */
function formatSeasonDoc(seasonDoc) {
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
			playoffWins: team.playoffWins || 0,
			playoffLosses: team.playoffLosses || 0,
			playoffPointsFor: team.playoffPointsFor || 0,
			playoffPointsAgainst: team.playoffPointsAgainst || 0,
			isPlayoffTeam: team.playoffFinish != null,
			playoffFinish: team.playoffFinish,
			playoffSeed: team.playoffSeed
		};
	});
	
	return {
		season: seasonDoc._id,
		standings: standings,
		isFinal: seasonDoc.status.regularSeasonComplete,
		gamesPlayed: seasonDoc.status.gamesPlayed
	};
}

/**
 * Compute standings from games (fallback)
 */
async function computeFromGames(season) {
	var games = await Game.find({ season: season }).lean();
	
	if (!games || games.length === 0) {
		return null;
	}
	
	var h2h = tiebreaker.buildH2HData(games);
	var owners = {};
	
	// Determine total games for this era
	var totalRegularSeasonGames;
	if (season <= 2011) {
		totalRegularSeasonGames = 70;
	} else if (season < 2021) {
		totalRegularSeasonGames = 84;
	} else {
		totalRegularSeasonGames = 90;
	}
	
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
					playoffFinish: null
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
			owners[game.away.score > game.home.score ? awayId : homeId].playoffFinish = 'third-place';
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
	
	var result = standings.map(function(owner, index) {
		return {
			rank: index + 1,
			franchiseId: owner.id,
			name: owner.name,
			wins: owner.wins,
			losses: owner.losses,
			ties: owner.ties,
			pointsFor: owner.pointsFor,
			pointsAgainst: owner.pointsAgainst,
			playoffWins: owner.playoffWins,
			playoffLosses: owner.playoffLosses,
			playoffPointsFor: owner.playoffPointsFor,
			playoffPointsAgainst: owner.playoffPointsAgainst,
			isPlayoffTeam: owner.playoffFinish != null,
			playoffFinish: owner.playoffFinish
		};
	});
	
	return {
		season: season,
		standings: result,
		isFinal: isFinal,
		gamesPlayed: gamesWithScores
	};
}

module.exports = {
	getStandingsForSeason: getStandingsForSeason
};
