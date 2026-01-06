var LeagueConfig = require('../models/LeagueConfig');
var Franchise = require('../models/Franchise');
var Regime = require('../models/Regime');
var Pick = require('../models/Pick');
var Player = require('../models/Player');
var Transaction = require('../models/Transaction');

var positionOrder = ['QB', 'RB', 'WR', 'TE', 'DL', 'LB', 'DB', 'K'];

// First-round rookie salaries by year and position
var rookieSalaries = {
	'2026': { 'DB': 2, 'DL': 2, 'K': 1, 'LB': 1, 'QB': 40, 'RB': 20, 'TE': 11, 'WR': 17 },
	'2025': { 'DB': 2, 'DL': 2, 'K': 1, 'LB': 1, 'QB': 44, 'RB': 21, 'TE': 9, 'WR': 16 },
	'2024': { 'DB': 2, 'DL': 2, 'K': 1, 'LB': 1, 'QB': 40, 'RB': 23, 'TE': 9, 'WR': 16 },
	'2023': { 'DB': 2, 'DL': 2, 'K': 2, 'LB': 1, 'QB': 30, 'RB': 25, 'TE': 14, 'WR': 16 },
	'2022': { 'DB': 1, 'DL': 2, 'K': 2, 'LB': 1, 'QB': 37, 'RB': 25, 'TE': 8, 'WR': 16 },
	'2021': { 'DB': 1, 'DL': 2, 'K': 1, 'LB': 1, 'QB': 29, 'RB': 25, 'TE': 5, 'WR': 16 },
	'2020': { 'DB': 2, 'DL': 1, 'K': 1, 'LB': 1, 'QB': 32, 'RB': 25, 'TE': 7, 'WR': 16 },
	'2019': { 'DB': 1, 'DL': 2, 'K': 1, 'LB': 1, 'QB': 38, 'RB': 25, 'TE': 10, 'WR': 16 },
	'2018': { 'DB': 2, 'DL': 3, 'K': 2, 'LB': 2, 'QB': 28, 'RB': 25, 'TE': 14, 'WR': 18 },
	'2017': { 'DB': 2, 'DL': 2, 'K': 2, 'LB': 1, 'QB': 31, 'RB': 24, 'TE': 17, 'WR': 18 },
	'2016': { 'DB': 2, 'DL': 3, 'K': 1, 'LB': 2, 'QB': 32, 'RB': 25, 'TE': 15, 'WR': 17 },
	'2015': { 'DB': 2, 'DL': 3, 'K': 1, 'LB': 1, 'QB': 24, 'RB': 27, 'TE': 15, 'WR': 17 },
	'2014': { 'DB': 2, 'DL': 2, 'K': 2, 'LB': 1, 'QB': 19, 'RB': 24, 'TE': 28, 'WR': 19 },
	'2013': { 'DB': 2, 'DL': 3, 'K': 1, 'LB': 2, 'QB': 17, 'RB': 26, 'TE': 18, 'WR': 18 },
	'2012': { 'DB': 1, 'DL': 1, 'K': 1, 'LB': 1, 'QB': 25, 'RB': 25, 'TE': 7, 'WR': 16 },
	'2011': { 'DB': 1, 'DL': 1, 'K': 1, 'LB': 2, 'QB': 25, 'RB': 25, 'TE': 3, 'WR': 26 },
	'2010': { 'DB': 1, 'DL': 2, 'K': 1, 'LB': 2, 'QB': 24, 'RB': 28, 'TE': 4, 'WR': 15 }
};

// Calculate rookie salary for a given season, round, and positions
// Takes the max salary across all eligible positions
function getRookieSalary(season, round, positions) {
	var yearSalaries = rookieSalaries[String(season)];
	if (!yearSalaries || !positions || positions.length === 0) return null;
	
	var maxBase = 0;
	for (var i = 0; i < positions.length; i++) {
		var pos = positions[i];
		var base = yearSalaries[pos] || 0;
		if (base > maxBase) maxBase = base;
	}
	
	if (maxBase === 0) return null;
	return Math.ceil(maxBase / Math.pow(2, round - 1));
}

// Sort positions according to standard order
function sortPositions(positions) {
	if (!positions || positions.length === 0) return [];
	return positions.slice().sort(function(a, b) {
		var idxA = positionOrder.indexOf(a);
		var idxB = positionOrder.indexOf(b);
		return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB);
	});
}

// Map positions to groups for color coding (uses primary position)
function getPositionGroup(positions) {
	if (!positions || positions.length === 0) return null;
	var sorted = sortPositions(positions);
	var primary = sorted[0];
	if (primary === 'QB') return 'QB';
	if (primary === 'RB' || primary === 'FB') return 'RB';
	if (primary === 'WR') return 'WR';
	if (primary === 'TE') return 'TE';
	if (primary === 'K') return 'K';
	// All defensive positions (IDP)
	if (['DL', 'DE', 'DT', 'NT', 'LB', 'ILB', 'OLB', 'MLB', 'DB', 'CB', 'S', 'SS', 'FS'].includes(primary)) return 'IDP';
	return null;
}

// Format pick number as round.slot (e.g., "2.05")
// picksPerRound varies by season (10 for 2010-2011, 12 for 2012+)
function formatPickNumber(pickNumber, round, picksPerRound) {
	if (!pickNumber) return null;
	var slot = pickNumber - (round - 1) * picksPerRound;
	return round + '.' + String(slot).padStart(2, '0');
}

async function draftBoard(request, response) {
	var config = await LeagueConfig.findById('pso');
	var currentSeason = config ? config.season : new Date().getFullYear();
	
	// Allow viewing any season via query param, default to current season's draft
	var season = parseInt(request.query.season, 10) || currentSeason;
	
	// Get all picks for this season
	var picks = await Pick.find({ season: season }).sort({ pickNumber: 1, round: 1 }).lean();
	
	// Determine picks per round (10 for 2010-2011, 12 for 2012+)
	var picksPerRound = (season <= 2011) ? 10 : 12;
	
	// Get franchises and regimes for display names
	var franchises = await Franchise.find({}).lean();
	var regimes = await Regime.find({
		startSeason: { $lte: season },
		$or: [{ endSeason: null }, { endSeason: { $gte: season } }]
	}).lean();
	
	function getDisplayName(franchiseId) {
		if (!franchiseId) return 'Unknown';
		var regime = regimes.find(function(r) {
			return r.franchiseId.equals(franchiseId);
		});
		return regime ? regime.displayName : 'Unknown';
	}
	
	// Get draft selections to see who was picked
	var selections = await Transaction.find({
		type: 'draft-select',
		pickId: { $in: picks.map(function(p) { return p._id; }) }
	}).lean();
	
	var selectionMap = {};
	selections.forEach(function(s) {
		selectionMap[s.pickId.toString()] = s.playerId;
	});
	
	// Get player info (name and positions)
	var playerIds = selections.map(function(s) { return s.playerId; });
	var players = await Player.find({ _id: { $in: playerIds } }).lean();
	var playerMap = {};
	players.forEach(function(p) {
		var positions = p.positions || [];
		var sortedPositions = sortPositions(positions);
		playerMap[p._id.toString()] = {
			name: p.name,
			positions: positions,
			positionDisplay: sortedPositions.join('/'),
			positionGroup: getPositionGroup(positions)
		};
	});
	
	// Organize by round
	var rounds = {};
	picks.forEach(function(pick) {
		if (!rounds[pick.round]) rounds[pick.round] = [];
		
		var playerId = selectionMap[pick._id.toString()];
		var playerInfo = playerId ? playerMap[playerId.toString()] : null;
		
		var fromOwner = null;
		if (!pick.originalFranchiseId.equals(pick.currentFranchiseId)) {
			fromOwner = getDisplayName(pick.originalFranchiseId);
		}
		
		// Calculate salary based on player positions and round
		var salary = null;
		if (playerInfo && playerInfo.positions) {
			salary = getRookieSalary(season, pick.round, playerInfo.positions);
		}
		
		rounds[pick.round].push({
			pickNumber: pick.pickNumber,
			pickDisplay: formatPickNumber(pick.pickNumber, pick.round, picksPerRound),
			round: pick.round,
			currentOwner: getDisplayName(pick.currentFranchiseId),
			fromOwner: fromOwner,
			status: pick.status,
			playerName: playerInfo ? playerInfo.name : null,
			positionDisplay: playerInfo ? playerInfo.positionDisplay : null,
			positionGroup: playerInfo ? playerInfo.positionGroup : null,
			salary: salary
		});
	});
	
	// Sort each round by pick number
	Object.keys(rounds).forEach(function(round) {
		rounds[round].sort(function(a, b) {
			if (a.pickNumber && b.pickNumber) return a.pickNumber - b.pickNumber;
			return 0;
		});
	});
	
	// Quick access pills: last season, current, and next 2
	var quickSeasons = [currentSeason - 1, currentSeason, currentSeason + 1, currentSeason + 2];
	
	// Archive dropdown: all past drafts from 2010 to currentSeason - 2
	var archiveSeasons = [];
	for (var y = currentSeason - 2; y >= 2010; y--) {
		archiveSeasons.push(y);
	}
	
	response.render('draft-board', {
		season: season,
		currentSeason: currentSeason,
		rounds: rounds,
		totalPicks: picks.length,
		quickSeasons: quickSeasons,
		archiveSeasons: archiveSeasons
	});
}

module.exports = {
	draftBoard: draftBoard
};
