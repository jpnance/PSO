/**
 * Tiebreaker algorithms for fantasy standings
 * 
 * Two different algorithms based on era:
 * - Pre-2020 (2008-2019): Complex H2H with graduation
 * - 2020+: Simple H2H winning percentage
 */

/**
 * Build H2H record data from games
 * Returns an object keyed by franchiseId containing H2H records against all opponents
 * 
 * @param {Array} games - Array of game documents for the season
 * @returns {Object} H2H data keyed by franchiseId
 */
function buildH2HData(games) {
	var h2h = {};
	
	games.forEach(function(game) {
		if (game.type !== 'regular') return;
		if (game.away.score == null || game.home.score == null) return;
		
		var awayId = game.away.franchiseId;
		var homeId = game.home.franchiseId;
		
		// Initialize if needed
		if (!h2h[awayId]) h2h[awayId] = {};
		if (!h2h[homeId]) h2h[homeId] = {};
		if (!h2h[awayId][homeId]) h2h[awayId][homeId] = { wins: 0, losses: 0, ties: 0 };
		if (!h2h[homeId][awayId]) h2h[homeId][awayId] = { wins: 0, losses: 0, ties: 0 };
		
		if (game.away.score > game.home.score) {
			h2h[awayId][homeId].wins++;
			h2h[homeId][awayId].losses++;
		} else if (game.home.score > game.away.score) {
			h2h[homeId][awayId].wins++;
			h2h[awayId][homeId].losses++;
		} else {
			h2h[awayId][homeId].ties++;
			h2h[homeId][awayId].ties++;
		}
	});
	
	return h2h;
}

/**
 * Calculate H2H record for a team against a set of opponents
 * 
 * @param {Object} h2h - H2H data from buildH2HData
 * @param {number|string} teamId - Franchise ID
 * @param {Array} opponentIds - Array of opponent franchise IDs
 * @returns {Object} { wins, losses, ties, games }
 */
function getH2HRecord(h2h, teamId, opponentIds) {
	var record = { wins: 0, losses: 0, ties: 0 };
	
	opponentIds.forEach(function(oppId) {
		if (oppId === teamId) return;
		if (h2h[teamId] && h2h[teamId][oppId]) {
			record.wins += h2h[teamId][oppId].wins;
			record.losses += h2h[teamId][oppId].losses;
			record.ties += h2h[teamId][oppId].ties;
		}
	});
	
	record.games = record.wins + record.losses + record.ties;
	return record;
}

/**
 * Modern tiebreaker (2020+)
 * 
 * All tied teams are ranked by H2H winning percentage.
 * If still tied (same percentage), use Points For.
 * 
 * @param {Array} tiedTeams - Array of team objects with { id, name, wins, losses, ties, pointsFor, ... }
 * @param {Object} h2h - H2H data from buildH2HData
 * @returns {Array} Sorted array of teams
 */
function modernTiebreaker(tiedTeams, h2h) {
	if (tiedTeams.length <= 1) {
		return tiedTeams;
	}
	
	var teamIds = tiedTeams.map(function(t) { return t.id; });
	
	// Calculate H2H record for each team against other tied teams
	var teamsWithH2H = tiedTeams.map(function(team) {
		var h2hRecord = getH2HRecord(h2h, team.id, teamIds);
		var h2hWinPct = h2hRecord.games > 0 
			? (h2hRecord.wins + (h2hRecord.ties * 0.5)) / h2hRecord.games 
			: 0;
		
		return {
			team: team,
			h2hWins: h2hRecord.wins,
			h2hLosses: h2hRecord.losses,
			h2hTies: h2hRecord.ties,
			h2hGames: h2hRecord.games,
			h2hWinPct: h2hWinPct
		};
	});
	
	// Group by H2H winning percentage
	var groups = {};
	teamsWithH2H.forEach(function(t) {
		var key = t.h2hWinPct.toFixed(6);
		if (!groups[key]) groups[key] = [];
		groups[key].push(t);
	});
	
	var sortedKeys = Object.keys(groups).sort(function(a, b) {
		return parseFloat(b) - parseFloat(a); // Descending by win percentage
	});
	
	// If only one group (all still tied on H2H %), use Points For
	if (sortedKeys.length === 1) {
		return teamsWithH2H
			.sort(function(a, b) { return b.team.pointsFor - a.team.pointsFor; })
			.map(function(t) { return t.team; });
	}
	
	// Otherwise, recursively break ties within each sub-group
	var result = [];
	sortedKeys.forEach(function(key) {
		var group = groups[key];
		if (group.length === 1) {
			result.push(group[0].team);
		} else {
			// Recursively break ties for this sub-group
			var subTeams = group.map(function(t) { return t.team; });
			result = result.concat(modernTiebreaker(subTeams, h2h));
		}
	});
	
	return result;
}

/**
 * Legacy tiebreaker (Pre-2020)
 * 
 * Algorithm:
 * 1. All tied teams are evaluated on H2H record against each other
 * 2. If they played the SAME number of games against each other:
 *    - The winningest team (most H2H wins) graduates out of the tie
 * 3. If they played DIFFERENT numbers of games against each other:
 *    - The team with the most Points For (PF) graduates out of the tie
 * 4. Repeat from step 1 with remaining tied teams
 * 
 * @param {Array} tiedTeams - Array of team objects
 * @param {Object} h2h - H2H data from buildH2HData
 * @returns {Array} Sorted array of teams
 */
function legacyTiebreaker(tiedTeams, h2h) {
	if (tiedTeams.length <= 1) {
		return tiedTeams;
	}
	
	var result = [];
	var remaining = tiedTeams.slice();
	
	while (remaining.length > 1) {
		var teamIds = remaining.map(function(t) { return t.id; });
		
		// Calculate H2H record for each team against remaining tied teams
		var teamsWithH2H = remaining.map(function(team) {
			var h2hRecord = getH2HRecord(h2h, team.id, teamIds);
			return {
				team: team,
				h2hWins: h2hRecord.wins,
				h2hLosses: h2hRecord.losses,
				h2hGames: h2hRecord.games
			};
		});
		
		// Check if all teams played the same number of H2H games
		var gameCounts = teamsWithH2H.map(function(t) { return t.h2hGames; });
		var allSameGameCount = gameCounts.every(function(g) { return g === gameCounts[0]; });
		
		var graduate;
		
		if (allSameGameCount) {
			// Same number of games - graduate the team with most H2H wins
			teamsWithH2H.sort(function(a, b) { return b.h2hWins - a.h2hWins; });
			
			// Check if there's a clear winner or if multiple teams tied for most wins
			var topWins = teamsWithH2H[0].h2hWins;
			var tiedForTop = teamsWithH2H.filter(function(t) { return t.h2hWins === topWins; });
			
			if (tiedForTop.length === 1) {
				// Clear H2H winner
				graduate = tiedForTop[0].team;
			} else {
				// Multiple teams tied for most H2H wins - use PF to break
				tiedForTop.sort(function(a, b) { return b.team.pointsFor - a.team.pointsFor; });
				graduate = tiedForTop[0].team;
			}
		} else {
			// Different number of games - graduate the team with most PF
			teamsWithH2H.sort(function(a, b) { return b.team.pointsFor - a.team.pointsFor; });
			graduate = teamsWithH2H[0].team;
		}
		
		// Graduate this team out
		result.push(graduate);
		remaining = remaining.filter(function(t) { return t.id !== graduate.id; });
	}
	
	// Add the last remaining team
	if (remaining.length === 1) {
		result.push(remaining[0]);
	}
	
	return result;
}

/**
 * Get the appropriate tiebreaker function for a season
 * 
 * @param {number} season - The season year
 * @returns {Object} { name, description, breakTies: function }
 */
function getTiebreakerStrategy(season) {
	if (season >= 2020) {
		return {
			name: 'H2H Winning Percentage',
			description: 'Teams are ranked by head-to-head winning percentage. If still tied, Points For is used.',
			breakTies: modernTiebreaker
		};
	} else {
		return {
			name: 'H2H with Graduation',
			description: 'Teams are graduated one at a time based on H2H record (if equal games played) or Points For (if different games played).',
			breakTies: legacyTiebreaker
		};
	}
}

/**
 * Sort teams by record (wins desc, ties desc, then apply tiebreaker)
 * 
 * @param {Array} teams - Array of team objects
 * @param {Object} h2h - H2H data
 * @param {number} season - Season year (determines tiebreaker algorithm)
 * @returns {Array} Sorted array of teams
 */
function sortByRecord(teams, h2h, season) {
	var strategy = getTiebreakerStrategy(season);
	
	// Group teams by record (wins, losses, ties)
	var recordGroups = {};
	teams.forEach(function(team) {
		var key = team.wins + '-' + team.losses + '-' + team.ties;
		if (!recordGroups[key]) {
			recordGroups[key] = {
				wins: team.wins,
				losses: team.losses,
				ties: team.ties,
				teams: []
			};
		}
		recordGroups[key].teams.push(team);
	});
	
	// Sort record groups by wins desc, then ties desc
	var sortedGroups = Object.values(recordGroups).sort(function(a, b) {
		if (a.wins !== b.wins) return b.wins - a.wins;
		return b.ties - a.ties;
	});
	
	// Apply tiebreaker within each group
	var result = [];
	sortedGroups.forEach(function(group) {
		if (group.teams.length === 1) {
			result.push(group.teams[0]);
		} else {
			// Apply tiebreaker
			var sorted = strategy.breakTies(group.teams, h2h);
			result = result.concat(sorted);
		}
	});
	
	return result;
}

module.exports = {
	buildH2HData: buildH2HData,
	getH2HRecord: getH2HRecord,
	modernTiebreaker: modernTiebreaker,
	legacyTiebreaker: legacyTiebreaker,
	getTiebreakerStrategy: getTiebreakerStrategy,
	sortByRecord: sortByRecord
};
