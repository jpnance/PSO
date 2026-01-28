/**
 * Division configuration for the division era (2008-2011)
 * 
 * Prior to 2012, the league had two divisions with 5 teams each.
 * The top team from each division received a playoff spot, plus two wild cards.
 * 
 * Division names:
 * - 2008, 2010, 2011: Montagues vs Capulets
 * - 2009: Beard vs Mustache (same teams, different names)
 */

// Division assignments by franchise ID
// These franchise IDs remained consistent through the division era
var divisions = {
	montagues: {
		name: 'Montagues',
		altName: 'Beard', // Used in 2009
		franchiseIds: [1, 4, 6, 8, 10] // Patrick, John, Keyon, Daniel, Schex
	},
	capulets: {
		name: 'Capulets',
		altName: 'Mustache', // Used in 2009
		franchiseIds: [2, 3, 5, 7, 9] // Koci, Syed, Trevor, Jeff/Jake/Luke, James
	}
};

// Years when divisions were used
var DIVISION_ERA_START = 2008;
var DIVISION_ERA_END = 2011;

/**
 * Check if a season used divisions
 * @param {number} season
 * @returns {boolean}
 */
function hasDivisions(season) {
	return season >= DIVISION_ERA_START && season <= DIVISION_ERA_END;
}

/**
 * Get division info for a season
 * @param {number} season
 * @returns {Object|null} Division configuration or null if no divisions
 */
function getDivisionsForSeason(season) {
	if (!hasDivisions(season)) {
		return null;
	}
	
	// 2009 used alternate names
	var useMontagues = season !== 2009;
	
	return {
		divisions: [
			{
				key: 'montagues',
				name: useMontagues ? divisions.montagues.name : divisions.montagues.altName,
				franchiseIds: divisions.montagues.franchiseIds
			},
			{
				key: 'capulets',
				name: useMontagues ? divisions.capulets.name : divisions.capulets.altName,
				franchiseIds: divisions.capulets.franchiseIds
			}
		]
	};
}

/**
 * Get division for a franchise in a given season
 * @param {number} franchiseId
 * @param {number} season
 * @returns {Object|null} { key, name } or null if no divisions
 */
function getDivisionForFranchise(franchiseId, season) {
	var config = getDivisionsForSeason(season);
	if (!config) return null;
	
	for (var i = 0; i < config.divisions.length; i++) {
		var div = config.divisions[i];
		if (div.franchiseIds.includes(franchiseId)) {
			return { key: div.key, name: div.name };
		}
	}
	
	return null;
}

/**
 * Sort teams within divisions, then apply playoff seeding rules
 * 
 * In division era:
 * - #1 seed: Best record in Montagues (or Beard in 2009)
 * - #2 seed: Best record in Capulets (or Mustache in 2009)
 * - #3 seed: Best remaining record (wild card 1)
 * - #4 seed: Next best remaining record (wild card 2)
 * 
 * @param {Array} teams - Array of team objects with { id, wins, losses, ties, pointsFor, ... }
 * @param {Object} h2h - H2H data for tiebreaker
 * @param {number} season
 * @param {Function} sortByRecord - The sortByRecord function from tiebreaker module
 * @returns {Object} { standings: Array, divisionWinners: Array }
 */
function sortWithDivisions(teams, h2h, season, sortByRecord) {
	var config = getDivisionsForSeason(season);
	
	if (!config) {
		// No divisions - just sort normally
		return {
			standings: sortByRecord(teams, h2h, season),
			divisionWinners: []
		};
	}
	
	// Separate teams by division
	var divisionTeams = {};
	config.divisions.forEach(function(div) {
		divisionTeams[div.key] = teams.filter(function(t) {
			return div.franchiseIds.includes(t.id);
		});
	});
	
	// Sort each division
	var divisionStandings = {};
	config.divisions.forEach(function(div) {
		divisionStandings[div.key] = sortByRecord(divisionTeams[div.key], h2h, season);
	});
	
	// Get division winners
	var divisionWinners = config.divisions.map(function(div) {
		var winner = divisionStandings[div.key][0];
		if (winner) {
			winner.divisionWinner = true;
			winner.division = div.name;
		}
		return {
			division: div.name,
			team: winner
		};
	});
	
	// Remove division winners from their divisions
	config.divisions.forEach(function(div) {
		divisionStandings[div.key] = divisionStandings[div.key].slice(1);
	});
	
	// Combine remaining teams and sort for wild cards
	var remainingTeams = [];
	config.divisions.forEach(function(div) {
		remainingTeams = remainingTeams.concat(divisionStandings[div.key]);
	});
	var sortedRemaining = sortByRecord(remainingTeams, h2h, season);
	
	// Mark wild card teams
	if (sortedRemaining.length >= 1) {
		sortedRemaining[0].wildCard = 1;
	}
	if (sortedRemaining.length >= 2) {
		sortedRemaining[1].wildCard = 2;
	}
	
	// Build full standings:
	// 1-2. Division winners (sorted against each other by record/tiebreaker)
	// 3-4. Wild cards
	// 5+. Everyone else
	var divisionWinnerTeams = divisionWinners
		.map(function(dw) { return dw.team; })
		.filter(Boolean);
	
	// Sort division winners against each other to determine true #1 and #2
	var sortedDivisionWinners = sortByRecord(divisionWinnerTeams, h2h, season);
	
	var standings = sortedDivisionWinners.concat(sortedRemaining);
	
	// Assign division to all teams
	standings.forEach(function(team) {
		if (!team.division) {
			var div = getDivisionForFranchise(team.id, season);
			if (div) team.division = div.name;
		}
	});
	
	return {
		standings: standings,
		divisionWinners: divisionWinners.map(function(dw) { return dw.team; }).filter(Boolean),
		divisions: config.divisions
	};
}

module.exports = {
	hasDivisions: hasDivisions,
	getDivisionsForSeason: getDivisionsForSeason,
	getDivisionForFranchise: getDivisionForFranchise,
	sortWithDivisions: sortWithDivisions,
	DIVISION_ERA_START: DIVISION_ERA_START,
	DIVISION_ERA_END: DIVISION_ERA_END
};
