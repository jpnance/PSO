// Standings computation logic
// Computes final standings including playoff results

var Game = require('../models/Game');

// Sort by wins (desc), then ties (desc), then total points (desc)
function recordSort(a, b) {
	if (a.wins != b.wins) {
		return b.wins - a.wins;
	}
	if (a.ties != b.ties) {
		return b.ties - a.ties;
	}
	return b.tiebreaker - a.tiebreaker;
}

// Build standings from game data for a given season
async function getStandingsForSeason(season) {
	// Get ALL games for the season (regular + playoffs)
	var games = await Game.find({ season: season }).lean();

	if (!games || games.length === 0) {
		return null;
	}

	// Build owners object using franchiseId as key
	var owners = {};

	// First pass: identify all franchises and compute regular season records
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
				playoffFinish: null // 'champion', 'runner-up', 'third-place', 'fourth-place'
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
				playoffFinish: null
			};
		}
	});

	// Count regular season games with scores
	var gamesWithScores = 0;
	var totalRegularSeasonGames = 90; // 12 teams × 15 weeks / 2

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

		// Track playoff finishes
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

	// Build standings array
	var allTeams = [];
	for (var ownerId in owners) {
		// Set tiebreaker to pointsFor for sorting
		owners[ownerId].tiebreaker = owners[ownerId].pointsFor;
		allTeams.push(owners[ownerId]);
	}

	// Separate playoff teams from non-playoff teams
	var playoffTeams = allTeams.filter(function(t) { return t.playoffFinish !== null; });
	var nonPlayoffTeams = allTeams.filter(function(t) { return t.playoffFinish === null; });

	// Sort playoff teams by finish
	var finishOrder = { 'champion': 1, 'runner-up': 2, 'third-place': 3, 'fourth-place': 4 };
	playoffTeams.sort(function(a, b) {
		return finishOrder[a.playoffFinish] - finishOrder[b.playoffFinish];
	});

	// Sort non-playoff teams by record
	nonPlayoffTeams.sort(recordSort);

	// Combine: playoff teams first, then non-playoff teams
	var standings = playoffTeams.concat(nonPlayoffTeams);

	// Determine if standings are finalized (all regular season games played)
	var isFinal = gamesWithScores >= totalRegularSeasonGames;

	// Format standings for display
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
			isPlayoffTeam: owner.playoffFinish !== null,
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
