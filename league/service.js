var LeagueConfig = require('../models/LeagueConfig');
var Franchise = require('../models/Franchise');
var Person = require('../models/Person');
var Regime = require('../models/Regime');
var Contract = require('../models/Contract');
var Budget = require('../models/Budget');
var Pick = require('../models/Pick');
var Player = require('../models/Player');
var Transaction = require('../models/Transaction');
var standingsHelper = require('../helpers/standings');
var scheduleHelper = require('../helpers/schedule');
var { getPositionIndex } = require('../helpers/view');

// Calendar helpers
function formatShortDate(date) {
	if (!date) return null;
	var options = { month: 'short', day: 'numeric' };
	return new Date(date).toLocaleDateString('en-US', options);
}

function isPast(date) {
	if (!date) return false;
	var today = new Date();
	today.setHours(0, 0, 0, 0);
	return new Date(date) < today;
}

function getUpcomingEvents(config) {
	var events = [
		{ key: 'tradeWindow', name: 'Trade Window Opens', date: config.tradeWindow },
		{ key: 'nflDraft', name: 'NFL Draft', date: config.nflDraft },
		{ key: 'cutDay', name: 'Cut Day', date: config.cutDay, tentative: config.cutDayTentative },
		{ key: 'draftDay', name: 'Draft Day', date: config.draftDay, tentative: config.draftDayTentative },
		{ key: 'contractsDue', name: 'Contracts Due', date: config.contractsDue, tentative: config.contractsDueTentative },
		{ key: 'faab', name: 'FAAB Begins', date: config.faab },
		{ key: 'nflSeason', name: 'NFL Season Kicks Off', date: config.nflSeason },
		{ key: 'tradeDeadline', name: 'Trade Deadline', date: config.tradeDeadline },
		{ key: 'playoffs', name: 'Playoffs Begin', date: config.playoffs },
		{ key: 'deadPeriod', name: 'Dead Period', date: config.deadPeriod }
	];

	// Filter to future events and format
	var upcoming = events
		.filter(function(e) { return e.date && !isPast(e.date); })
		.map(function(e) {
			return {
				name: e.name,
				date: e.date,
				shortDate: formatShortDate(e.date),
				tentative: e.tentative || false
			};
		})
		.sort(function(a, b) { return new Date(a.date) - new Date(b.date); });

	return upcoming;
}

function getPhaseName(phase) {
	var names = {
		'dead-period': 'Dead Period',
		'early-offseason': 'Offseason',
		'pre-season': 'Pre-Season',
		'regular-season': 'Regular Season',
		'post-deadline': 'Post-Deadline',
		'playoff-fa': 'Playoff FA Period',
		'unknown': 'Unknown'
	};
	return names[phase] || phase;
}

// Get budgets for a franchise from Budget documents
async function getBudgetsForFranchise(franchiseId, currentSeason) {
	var seasons = [currentSeason, currentSeason + 1, currentSeason + 2];
	var budgets = await Budget.find({ 
		franchiseId: franchiseId, 
		season: { $in: seasons } 
	}).lean();
	
	// Build lookup by season
	var budgetBySeason = {};
	budgets.forEach(function(b) {
		budgetBySeason[b.season] = b;
	});
	
	// Return array
	return seasons.map(function(season) {
		var budget = budgetBySeason[season] || {
			season: season,
			baseAmount: 1000,
			payroll: 0,
			buyOuts: 0,
			cashIn: 0,
			cashOut: 0,
			available: 1000,
			recoverable: 0
		};
		
		return {
			season: budget.season,
			baseAmount: budget.baseAmount,
			payroll: budget.payroll,
			buyOuts: budget.buyOuts,
			cashIn: budget.cashIn,
			cashOut: budget.cashOut,
			available: budget.available,
			recoverable: budget.recoverable
		};
	});
}

// Get all franchises with current regimes, rosters, budgets
async function getLeagueOverview(currentSeason) {
	var franchises = await Franchise.find({}).lean();
	var regimes = await Regime.find({ 
		$or: [
			{ endSeason: null },
			{ endSeason: { $gte: currentSeason } }
		]
	}).populate('ownerIds').lean();
	
	var contracts = await Contract.find({}).populate('playerId').lean();
	
	// Load budgets for current season
	var budgets = await Budget.find({ season: currentSeason }).lean();
	var budgetByFranchise = {};
	budgets.forEach(function(b) {
		budgetByFranchise[b.franchiseId.toString()] = b;
	});
	
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
		
		// Get budget from Budget document
		var budget = budgetByFranchise[franchise._id.toString()] || {
			payroll: 0,
			available: 1000,
			buyOuts: 0
		};
		
		result.push({
			_id: franchise._id,
			rosterId: franchise.rosterId,
			displayName: regime ? regime.displayName : 'Unknown',
			owners: regime ? Regime.sortOwnerNames(regime.ownerIds) : [],
			roster: roster,
			payroll: budget.payroll,
			available: budget.available,
			buyOuts: budget.buyOuts
		});
	}
	
	// Sort by display name
	result.sort(function(a, b) {
		return a.displayName.localeCompare(b.displayName);
	});
	
	return result;
}

// Get single franchise detail
async function getFranchise(franchiseId, currentSeason) {
	var franchise = await Franchise.findById(franchiseId).lean();
	if (!franchise) return null;
	
	var regimes = await Regime.find({ franchiseId: franchiseId })
		.populate('ownerIds')
		.sort({ startSeason: -1 })
		.lean();
	
	var contracts = await Contract.find({ franchiseId: franchiseId })
		.populate('playerId')
		.lean();
	
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
	
	// Separate actual contracts from RFA rights (salary is null for RFA rights)
	var actualContracts = contracts.filter(function(c) { return c.salary !== null; });
	var rfaContracts = contracts.filter(function(c) { return c.salary === null; });
	
	var roster = actualContracts
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
	
	var rfaRights = rfaContracts
		.map(function(c) {
			return {
				name: c.playerId ? c.playerId.name : 'Unknown',
				positions: c.playerId ? c.playerId.positions : []
			};
		})
		.sort(function(a, b) {
			var posA = getPositionIndex(a.positions);
			var posB = getPositionIndex(b.positions);
			if (posA !== posB) return posA - posB;
			return a.name.localeCompare(b.name);
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
	
	// Get budgets from Budget documents
	var budgets = await getBudgetsForFranchise(franchise._id, currentSeason);
	
	// Add sorted owner names to each regime
	var regimesWithSortedOwners = regimes.map(function(r) {
		return Object.assign({}, r, {
			sortedOwnerNames: Regime.sortOwnerNames(r.ownerIds)
		});
	});
	
	return {
		_id: franchise._id,
		rosterId: franchise.rosterId,
		displayName: currentRegime ? currentRegime.displayName : 'Unknown',
		owners: currentRegime ? Regime.sortOwnerNames(currentRegime.ownerIds) : [],
		regimes: regimesWithSortedOwners,
		roster: roster,
		rosterCount: roster.length,
		rfaRights: rfaRights,
		budgets: budgets,
		picks: pickData
	};
}

// Route handlers
async function overview(request, response) {
	try {
		var config = await LeagueConfig.findById('pso');
		var currentSeason = config ? config.season : new Date().getFullYear();
		
		var franchises = await getLeagueOverview(currentSeason);
		
		// Get standings - try current season first, fall back to previous season
		var standingsData = await standingsHelper.getStandingsForSeason(currentSeason);
		if (!standingsData || standingsData.gamesPlayed === 0) {
			// No games this season yet, show last season's final standings
			standingsData = await standingsHelper.getStandingsForSeason(currentSeason - 1);
			if (standingsData) {
				standingsData.isPreviousSeason = true;
			}
		}
		
		// Get calendar data
		var phase = config ? config.getPhase() : 'unknown';
		var phaseName = getPhaseName(phase);
		var upcomingEvents = config ? getUpcomingEvents(config) : [];
		
		// Get schedule widget data
		var cutDay = config ? config.cutDay : null;
		var scheduleData = await scheduleHelper.getScheduleWidget(currentSeason, phase, cutDay);
		
		// Find current user's franchise name (if logged in)
		var userFranchiseName = null;
		if (request.user) {
			var userRegime = await Regime.findOne({
				ownerIds: request.user._id,
				$or: [{ endSeason: null }, { endSeason: { $gte: currentSeason } }]
			});
			if (userRegime) {
				userFranchiseName = userRegime.displayName;
			}
		}
		
		response.render('league', { 
			franchises: franchises, 
			currentSeason: currentSeason,
			standings: standingsData,
			schedule: scheduleData,
			userFranchiseName: userFranchiseName,
			phase: phase,
			phaseName: phaseName,
			upcomingEvents: upcomingEvents,
			pageTitle: 'League Overview - PSO',
			activePage: 'league'
		});
	} catch (err) {
		console.error(err);
		response.status(500).send('Error loading league data');
	}
}

async function franchise(request, response) {
	try {
		var config = await LeagueConfig.findById('pso');
		var currentSeason = config ? config.season : new Date().getFullYear();
		var phase = config ? config.getPhase() : 'unknown';
		
		var rosterId = parseInt(request.params.rosterId, 10);
		if (isNaN(rosterId)) {
			return response.status(404).send('Franchise not found');
		}
		
		var franchiseDoc = await Franchise.findOne({ rosterId: rosterId }).lean();
		if (!franchiseDoc) {
			return response.status(404).send('Franchise not found');
		}
		
		var data = await getFranchise(franchiseDoc._id, currentSeason);
		if (!data) {
			return response.status(404).send('Franchise not found');
		}
		response.render('franchise', { 
			franchise: data, 
			currentSeason: currentSeason, 
			phase: phase,
			rosterLimit: LeagueConfig.ROSTER_LIMIT,
			pageTitle: data.displayName + ' - PSO',
			activePage: 'franchise',
			currentRosterId: data.rosterId
		});
	} catch (err) {
		console.error(err);
		response.status(500).send('Error loading franchise data');
	}
}

// Player search for navbar typeahead
async function search(request, response) {
	try {
		var query = (request.query.q || '').trim();
		
		// Require at least 2 characters
		if (query.length < 2) {
			return response.render('search-results', { results: [] });
		}
		
		var config = await LeagueConfig.findById('pso');
		var currentSeason = config ? config.season : new Date().getFullYear();
		
		// Find all players matching the query
		// Sort by: searchRank ascending (lower = more relevant), nulls last, then name
		var players = await Player.aggregate([
			{ $match: { name: { $regex: query, $options: 'i' } } },
			{ $addFields: { 
				searchRankSort: { $ifNull: ['$searchRank', 999999999] }
			}},
			{ $sort: { searchRankSort: 1, name: 1 } },
			{ $limit: 20 }
		]);
		
		if (players.length === 0) {
			return response.render('search-results', { results: [] });
		}
		
		var playerIds = players.map(function(p) { return p._id; });
		
		// Find all contracts for those players (both active contracts and RFA rights)
		// Active contracts have salary != null, RFA rights have salary = null
		var contracts = await Contract.find({
			playerId: { $in: playerIds }
		}).lean();
		
		// Build contract lookup by player ID
		var contractByPlayer = {};
		contracts.forEach(function(c) {
			contractByPlayer[c.playerId.toString()] = c;
		});
		
		// Get current regimes for franchise display names
		var regimes = await Regime.find({
			$or: [
				{ endSeason: null },
				{ endSeason: { $gte: currentSeason } }
			]
		}).lean();
		
		var regimeByFranchise = {};
		regimes.forEach(function(r) {
			if (r.startSeason <= currentSeason) {
				regimeByFranchise[r.franchiseId.toString()] = r;
			}
		});
		
		// Get all franchises to get rosterId
		var franchises = await Franchise.find({}).lean();
		var franchiseById = {};
		franchises.forEach(function(f) {
			franchiseById[f._id.toString()] = f;
		});
		
		// Build results
		var { formatContractYears } = require('../helpers/view');
		
		var results = players.map(function(player) {
			var contract = contractByPlayer[player._id.toString()];
			
			if (contract && contract.salary !== null) {
				// Player is rostered (has contract with salary)
				var regime = regimeByFranchise[contract.franchiseId.toString()];
				var franchise = franchiseById[contract.franchiseId.toString()];
				
				return {
					name: player.name,
					positions: player.positions || [],
					franchiseId: franchise ? franchise.rosterId : null,
					franchiseName: regime ? regime.displayName : 'Unknown',
					salary: contract.salary,
					contract: formatContractYears(contract.startYear, contract.endYear),
					status: 'rostered'
				};
			} else if (contract && contract.salary === null) {
				// Player is an RFA (contract exists but salary is null)
				var regime = regimeByFranchise[contract.franchiseId.toString()];
				var franchise = franchiseById[contract.franchiseId.toString()];
				
				return {
					name: player.name,
					positions: player.positions || [],
					franchiseId: franchise ? franchise.rosterId : null,
					franchiseName: regime ? regime.displayName : 'Unknown',
					salary: null,
					contract: null,
					status: 'rfa'
				};
			} else {
				// Player is an unrestricted free agent (no contract)
				return {
					name: player.name,
					positions: player.positions || [],
					franchiseId: null,
					franchiseName: null,
					salary: null,
					contract: null,
					status: 'ufa'
				};
			}
		});
		
		// Sort: rostered first, then RFA, then UFA - preserve searchRank order within each group
		var statusOrder = { rostered: 0, rfa: 1, ufa: 2 };
		results.sort(function(a, b) {
			return statusOrder[a.status] - statusOrder[b.status];
		});
		
		results = results.slice(0, 10);
		
		response.render('search-results', { results: results });
	} catch (err) {
		console.error('Search error:', err);
		response.render('search-results', { results: [] });
	}
}

module.exports = {
	getLeagueOverview: getLeagueOverview,
	getFranchise: getFranchise,
	overview: overview,
	franchise: franchise,
	search: search
};
