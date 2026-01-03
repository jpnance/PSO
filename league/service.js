var Franchise = require('../models/Franchise');
var Person = require('../models/Person');
var Regime = require('../models/Regime');
var Contract = require('../models/Contract');
var Budget = require('../models/Budget');
var Pick = require('../models/Pick');
var Player = require('../models/Player');
var Transaction = require('../models/Transaction');

var currentSeason = parseInt(process.env.SEASON, 10);

// Compute budget breakdown for a franchise for a specific season
function computeBudgetForSeason(franchiseId, contracts, trades, cuts, season) {
	// Payroll = sum of salaries where contract extends through this season
	var payroll = contracts
		.filter(function(c) { 
			return c.franchiseId.equals(franchiseId) && c.endYear && c.endYear >= season; 
		})
		.reduce(function(sum, c) { return sum + (c.salary || 0); }, 0);
	
	// Cash in/out from trades for this season
	var cashIn = 0;
	var cashOut = 0;
	
	trades.forEach(function(trade) {
		if (!trade.parties) return;
		
		trade.parties.forEach(function(party) {
			if (!party.franchiseId.equals(franchiseId)) return;
			if (!party.receives || !party.receives.cash) return;
			
			party.receives.cash.forEach(function(c) {
				if (c.season === season) {
					cashIn += c.amount || 0;
				}
			});
		});
		
		// Cash sent TO others = cash out
		trade.parties.forEach(function(party) {
			if (party.franchiseId.equals(franchiseId)) return;
			if (!party.receives || !party.receives.cash) return;
			
			party.receives.cash.forEach(function(c) {
				if (c.season === season && c.fromFranchiseId && c.fromFranchiseId.equals(franchiseId)) {
					cashOut += c.amount || 0;
				}
			});
		});
	});
	
	// Base amount is always 1000
	var baseAmount = 1000;
	
	// Dead money from cuts for this season
	var deadMoney = 0;
	cuts.forEach(function(cut) {
		if (!cut.franchiseId.equals(franchiseId)) return;
		if (!cut.deadMoney) return;
		
		cut.deadMoney.forEach(function(dm) {
			if (dm.season === season) {
				deadMoney += dm.amount || 0;
			}
		});
	});
	
	var available = baseAmount - payroll - deadMoney + cashIn - cashOut;
	
	return {
		season: season,
		baseAmount: baseAmount,
		payroll: payroll,
		deadMoney: deadMoney,
		cashIn: cashIn,
		cashOut: cashOut,
		available: available
	};
}

// Compute budgets for current and next two seasons
function computeBudgets(franchiseId, contracts, trades, cuts) {
	return [
		computeBudgetForSeason(franchiseId, contracts, trades, cuts, currentSeason),
		computeBudgetForSeason(franchiseId, contracts, trades, cuts, currentSeason + 1),
		computeBudgetForSeason(franchiseId, contracts, trades, cuts, currentSeason + 2)
	];
}

// Position sort order
var positionOrder = ['QB', 'RB', 'WR', 'TE', 'DL', 'LB', 'DB', 'K'];

function getPositionIndex(positions) {
	if (!positions || positions.length === 0) return 999;
	return Math.min.apply(null, positions.map(function(p) {
		var idx = positionOrder.indexOf(p);
		return idx === -1 ? 999 : idx;
	}));
}

// Get all franchises with current regimes, rosters, budgets
async function getLeagueOverview() {
	var franchises = await Franchise.find({}).lean();
	var regimes = await Regime.find({ 
		$or: [
			{ endSeason: null },
			{ endSeason: { $gte: currentSeason } }
		]
	}).populate('ownerIds').lean();
	
	var contracts = await Contract.find({}).populate('playerId').lean();
	var trades = await Transaction.find({ type: 'trade' }).lean();
	var cuts = await Transaction.find({ type: 'fa-cut' }).lean();
	
	// Build franchise data
	var result = [];
	for (var i = 0; i < franchises.length; i++) {
		var franchise = franchises[i];
		
		// Find current regime
		var regime = regimes.find(function(r) {
			return r.franchiseId.equals(franchise._id) &&
				r.startSeason <= currentSeason &&
				(r.endSeason === null || r.endSeason >= currentSeason);
		});
		
		// Find roster (contracts for this franchise)
		var roster = contracts
			.filter(function(c) { return c.franchiseId.equals(franchise._id); })
			.map(function(c) {
				return {
					name: c.playerId ? c.playerId.name : 'Unknown',
					positions: c.playerId ? c.playerId.positions : [],
					salary: c.salary,
					startYear: c.startYear,
					endYear: c.endYear
				};
			})
			.sort(function(a, b) {
				var posA = getPositionIndex(a.positions);
				var posB = getPositionIndex(b.positions);
				if (posA !== posB) return posA - posB;
				return (b.salary || 0) - (a.salary || 0);
			});
		
		// Compute budget from contracts and trades (current season only for overview)
		var budget = computeBudgetForSeason(franchise._id, contracts, trades, cuts, currentSeason);
		
		result.push({
			_id: franchise._id,
			sleeperRosterId: franchise.sleeperRosterId,
			displayName: regime ? regime.displayName : 'Unknown',
			owners: regime ? regime.ownerIds.map(function(o) { return o.name; }) : [],
			roster: roster,
			rosterCount: roster.length,
			payroll: budget.payroll,
			available: budget.available,
			deadMoney: budget.deadMoney
		});
	}
	
	// Sort by display name
	result.sort(function(a, b) {
		return a.displayName.localeCompare(b.displayName);
	});
	
	return result;
}

// Get single franchise detail
async function getFranchise(franchiseId) {
	var franchise = await Franchise.findById(franchiseId).lean();
	if (!franchise) return null;
	
	var regimes = await Regime.find({ franchiseId: franchiseId })
		.populate('ownerIds')
		.sort({ startSeason: -1 })
		.lean();
	
	var allContracts = await Contract.find({}).lean();
	var contracts = await Contract.find({ franchiseId: franchiseId })
		.populate('playerId')
		.lean();
	
	var trades = await Transaction.find({ type: 'trade' }).lean();
	var cuts = await Transaction.find({ type: 'fa-cut' }).lean();
	
	var picks = await Pick.find({ currentFranchiseId: franchiseId })
		.sort({ season: 1, round: 1 })
		.lean();
	
	// Get original franchise names for picks
	var allFranchises = await Franchise.find({}).lean();
	var allRegimes = await Regime.find({}).lean();
	
	function getOwnerName(fId, season) {
		var regime = allRegimes.find(function(r) {
			return r.franchiseId.equals(fId) &&
				r.startSeason <= season &&
				(r.endSeason === null || r.endSeason >= season);
		});
		return regime ? regime.displayName : 'Unknown';
	}
	
	var roster = contracts
		.map(function(c) {
			return {
				name: c.playerId ? c.playerId.name : 'Unknown',
				positions: c.playerId ? c.playerId.positions : [],
				salary: c.salary,
				startYear: c.startYear,
				endYear: c.endYear
			};
		})
		.sort(function(a, b) {
			var posA = getPositionIndex(a.positions);
			var posB = getPositionIndex(b.positions);
			if (posA !== posB) return posA - posB;
			return (b.salary || 0) - (a.salary || 0);
		});
	
	var pickData = picks.map(function(p) {
		var originalOwner = getOwnerName(p.originalFranchiseId, p.season);
		var isOwn = p.originalFranchiseId.equals(p.currentFranchiseId);
		return {
			season: p.season,
			round: p.round,
			pickNumber: p.pickNumber,
			status: p.status,
			originalOwner: isOwn ? null : originalOwner
		};
	});
	
	var currentRegime = regimes.find(function(r) {
		return r.startSeason <= currentSeason &&
			(r.endSeason === null || r.endSeason >= currentSeason);
	});
	
	// Compute budgets for current and next two seasons
	var budgets = computeBudgets(franchise._id, allContracts, trades, cuts);
	
	return {
		_id: franchise._id,
		sleeperRosterId: franchise.sleeperRosterId,
		displayName: currentRegime ? currentRegime.displayName : 'Unknown',
		owners: currentRegime ? currentRegime.ownerIds.map(function(o) { return o.name; }) : [],
		regimes: regimes,
		roster: roster,
		rosterCount: roster.length,
		budgets: budgets,
		picks: pickData
	};
}

// Route handlers
async function overview(request, response) {
	try {
		var franchises = await getLeagueOverview();
		response.render('league', { franchises: franchises, currentSeason: currentSeason });
	} catch (err) {
		console.error(err);
		response.status(500).send('Error loading league data');
	}
}

async function franchise(request, response) {
	try {
		var data = await getFranchise(request.params.id);
		if (!data) {
			return response.status(404).send('Franchise not found');
		}
		response.render('franchise', { franchise: data, currentSeason: currentSeason });
	} catch (err) {
		console.error(err);
		response.status(500).send('Error loading franchise data');
	}
}

module.exports = {
	getLeagueOverview: getLeagueOverview,
	getFranchise: getFranchise,
	overview: overview,
	franchise: franchise
};
