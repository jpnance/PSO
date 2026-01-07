var LeagueConfig = require('../models/LeagueConfig');
var Franchise = require('../models/Franchise');
var Regime = require('../models/Regime');
var Contract = require('../models/Contract');
var Pick = require('../models/Pick');
var Transaction = require('../models/Transaction');

// Buy-out calculation based on contract year
function computeBuyOutIfCut(salary, startYear, endYear, season) {
	var percentages = [0.60, 0.30, 0.15];
	if (startYear === null) startYear = endYear;
	var contractYearIndex = season - startYear;
	if (contractYearIndex >= percentages.length) return 0;
	return Math.ceil(salary * percentages[contractYearIndex]);
}

// Position sort order for roster display
var positionOrder = ['QB', 'RB', 'WR', 'TE', 'DL', 'LB', 'DB', 'K'];

function getPositionIndex(positions) {
	if (!positions || positions.length === 0) return 999;
	return Math.min.apply(null, positions.map(function(p) {
		var idx = positionOrder.indexOf(p);
		return idx === -1 ? 999 : idx;
	}));
}

// Get all data needed for the trade machine
async function getTradeData(currentSeason) {
	// Get all franchises and their current regimes
	var franchises = await Franchise.find({}).lean();
	var regimes = await Regime.find({
		$or: [
			{ endSeason: null },
			{ endSeason: { $gte: currentSeason } }
		]
	}).lean();
	
	// Get all contracts with player data
	var contracts = await Contract.find({})
		.populate('playerId')
		.lean();
	
	// Get all available picks for upcoming seasons
	var picks = await Pick.find({
		status: 'available',
		season: { $gte: currentSeason }
	})
		.populate('originalFranchiseId')
		.populate('currentFranchiseId')
		.sort({ season: 1, round: 1 })
		.lean();
	
	// Get trades and cuts for budget calculations
	var trades = await Transaction.find({ type: 'trade' }).lean();
	var cuts = await Transaction.find({ type: 'fa-cut' }).lean();
	
	// Build franchise list with display names and budget info
	var franchiseList = franchises.map(function(f) {
		var regime = regimes.find(function(r) {
			return r.franchiseId.equals(f._id) &&
				r.startSeason <= currentSeason &&
				(r.endSeason === null || r.endSeason >= currentSeason);
		});
		
		// Get active contracts (with salary, for current season)
		var activeContracts = contracts.filter(function(c) {
			return c.franchiseId.equals(f._id) && 
				c.salary !== null &&
				c.endYear && c.endYear >= currentSeason;
		});
		
		// Calculate payroll
		var payroll = activeContracts.reduce(function(sum, c) {
			return sum + (c.salary || 0);
		}, 0);
		
		// Calculate recoverable (salary - buyout for each contract)
		var recoverable = activeContracts.reduce(function(sum, c) {
			var salary = c.salary || 0;
			var buyOut = computeBuyOutIfCut(salary, c.startYear, c.endYear, currentSeason);
			return sum + (salary - buyOut);
		}, 0);
		
		// Calculate cash in/out for current season
		var cashIn = 0;
		var cashOut = 0;
		trades.forEach(function(trade) {
			if (!trade.parties) return;
			trade.parties.forEach(function(party) {
				if (!party.receives || !party.receives.cash) return;
				party.receives.cash.forEach(function(c) {
					if (c.season !== currentSeason) return;
					if (party.franchiseId.equals(f._id)) {
						cashIn += c.amount || 0;
					} else if (c.fromFranchiseId && c.fromFranchiseId.equals(f._id)) {
						cashOut += c.amount || 0;
					}
				});
			});
		});
		
		// Calculate buyouts from cuts
		var buyOuts = 0;
		cuts.forEach(function(cut) {
			if (!cut.franchiseId || !cut.franchiseId.equals(f._id)) return;
			if (!cut.buyOuts) return;
			cut.buyOuts.forEach(function(bo) {
				if (bo.season === currentSeason) {
					buyOuts += bo.amount || 0;
				}
			});
		});
		
		var baseAmount = 1000;
		var available = baseAmount - payroll - buyOuts + cashIn - cashOut;
		
		return {
			_id: f._id,
			displayName: regime ? regime.displayName : 'Unknown',
			rosterCount: activeContracts.length,
			available: available,
			recoverable: recoverable
		};
	}).sort(function(a, b) {
		return a.displayName.localeCompare(b.displayName);
	});
	
	// Helper to get franchise name by ID
	function getFranchiseName(franchiseId, season) {
		var regime = regimes.find(function(r) {
			return r.franchiseId.equals(franchiseId) &&
				r.startSeason <= (season || currentSeason) &&
				(r.endSeason === null || r.endSeason >= (season || currentSeason));
		});
		return regime ? regime.displayName : 'Unknown';
	}
	
	// Build teams object: { franchiseId: [players] }
	var teams = {};
	franchiseList.forEach(function(f) {
		teams[f._id.toString()] = [];
	});
	
	contracts.forEach(function(c) {
		if (!c.playerId) return;
		
		var franchiseId = c.franchiseId.toString();
		if (!teams[franchiseId]) return;
		
		var terms, contract;
		
		if (c.salary === null) {
			// RFA rights
			terms = 'rfa-rights';
			contract = null;
		} else if (!c.endYear) {
			// Unsigned (shouldn't really happen in normal flow)
			terms = 'unsigned';
			contract = null;
		} else {
			terms = 'signed';
			var startStr = c.startYear ? String(c.startYear % 100).padStart(2, '0') : 'FA';
			var endStr = String(c.endYear % 100).padStart(2, '0');
			contract = startStr + '/' + endStr;
		}
		
		// Calculate this player's recoverable (salary - buyout)
		var playerRecoverable = 0;
		if (c.salary !== null && c.endYear && c.endYear >= currentSeason) {
			var buyOut = computeBuyOutIfCut(c.salary, c.startYear, c.endYear, currentSeason);
			playerRecoverable = c.salary - buyOut;
		}
		
		teams[franchiseId].push({
			id: c.playerId._id.toString(),
			name: c.playerId.name,
			positions: c.playerId.positions || [],
			salary: c.salary,
			terms: terms,
			contract: contract,
			recoverable: playerRecoverable
		});
	});
	
	// Sort each team's roster
	Object.keys(teams).forEach(function(franchiseId) {
		teams[franchiseId].sort(function(a, b) {
			return a.name.localeCompare(b.name);
		});
	});
	
	// Build picks list with origin info
	var pickList = picks.map(function(p) {
		var owner = getFranchiseName(p.currentFranchiseId._id || p.currentFranchiseId, p.season);
		var origin = getFranchiseName(p.originalFranchiseId._id || p.originalFranchiseId, p.season);
		
		return {
			id: p._id.toString(),
			season: p.season,
			round: p.round,
			pickNumber: p.pickNumber || null,
			owner: owner,
			ownerId: (p.currentFranchiseId._id || p.currentFranchiseId).toString(),
			origin: origin
		};
	});
	
	// Sort picks by season, then by pick number (or round + origin if no pick number)
	pickList.sort(function(a, b) {
		// First by season
		if (a.season !== b.season) return a.season - b.season;
		// Then by pick number if both have one
		if (a.pickNumber && b.pickNumber) return a.pickNumber - b.pickNumber;
		// If only one has a pick number, numbered picks first
		if (a.pickNumber && !b.pickNumber) return -1;
		if (!a.pickNumber && b.pickNumber) return 1;
		// Neither has pick number: sort by round, then origin
		if (a.round !== b.round) return a.round - b.round;
		return a.origin.localeCompare(b.origin);
	});
	
	return {
		franchises: franchiseList,
		teams: teams,
		picks: pickList,
		currentSeason: currentSeason
	};
}

// Determine if a franchise name is plural (for grammar)
function isPlural(name) {
	return name === 'Schexes' || name.includes('/');
}

// Route handler for the propose page (trade machine)
async function proposePage(request, response) {
	try {
		var config = await LeagueConfig.findById('pso');
		var currentSeason = config ? config.season : new Date().getFullYear();
		
		var data = await getTradeData(currentSeason);
		
		// Determine if we're before cut day
		var today = new Date();
		var cutDay = config && config.cutDay ? new Date(config.cutDay) : null;
		var isBeforeCutDay = !cutDay || today < cutDay;
		
		response.render('trade', {
			franchises: data.franchises,
			teams: data.teams,
			picks: data.picks,
			season: currentSeason,
			isPlural: isPlural,
			isBeforeCutDay: isBeforeCutDay,
			rosterLimit: LeagueConfig.ROSTER_LIMIT,
			pageTitle: 'Trade Machine - PSO',
			activePage: 'propose'
		});
	} catch (err) {
		console.error(err);
		response.status(500).send('Error loading trade data');
	}
}

module.exports = {
	getTradeData: getTradeData,
	proposePage: proposePage
};
