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

// Build a flexible regex pattern that matches names with or without punctuation
// e.g., "aj" matches "A.J.", "AJ", "Aj", etc.
function buildFlexibleNamePattern(query) {
	// Escape special regex characters, but we'll handle . specially
	var escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	
	// Split into characters and allow optional punctuation between each
	var chars = escaped.split('');
	var pattern = chars.map(function(char, i) {
		// After each character, allow optional periods, apostrophes, hyphens, spaces
		if (i < chars.length - 1) {
			return char + "[.\\s'-]*";
		}
		return char;
	}).join('');
	
	return pattern;
}

// Format pick round as ordinal
function formatPickRound(round) {
	switch (round) {
		case 1: return '1st';
		case 2: return '2nd';
		case 3: return '3rd';
		default: return round + 'th';
	}
}

// Build asset summary for a trade (all parties combined)
// Returns { assets: string, matchedPlayerName: string }
function buildTradeSummary(trade, searchedPlayerIds, allPlayerNames) {
	var matchedPlayerName = null;
	var matchedPlayerId = null;
	
	// Collect all assets across all parties
	var playerNames = [];
	var picks = []; // { season, round }
	var cashItems = []; // { amount, season }
	
	for (var i = 0; i < (trade.parties || []).length; i++) {
		var party = trade.parties[i];
		
		// Players
		for (var j = 0; j < (party.receives.players || []).length; j++) {
			var p = party.receives.players[j];
			var playerId = p.playerId.toString();
			var name = allPlayerNames[playerId] || 'Unknown';
			
			// Check if this is a searched player
			if (searchedPlayerIds[playerId] && !matchedPlayerName) {
				matchedPlayerName = name;
				matchedPlayerId = playerId;
			}
			
			playerNames.push({ id: playerId, name: name });
		}
		
		// RFA rights
		for (var j = 0; j < (party.receives.rfaRights || []).length; j++) {
			var r = party.receives.rfaRights[j];
			var playerId = r.playerId.toString();
			var name = allPlayerNames[playerId] || 'Unknown';
			
			if (searchedPlayerIds[playerId] && !matchedPlayerName) {
				matchedPlayerName = name;
				matchedPlayerId = playerId;
			}
			
			playerNames.push({ id: playerId, name: name + ' (RFA)' });
		}
		
		// Picks
		for (var j = 0; j < (party.receives.picks || []).length; j++) {
			var pick = party.receives.picks[j];
			picks.push({ season: pick.season, round: pick.round });
		}
		
		// Cash
		for (var j = 0; j < (party.receives.cash || []).length; j++) {
			var cash = party.receives.cash[j];
			cashItems.push({ amount: cash.amount, season: cash.season });
		}
	}
	
	// Sort picks: by round (1sts first), then by season (future first)
	picks.sort(function(a, b) {
		if (a.round !== b.round) return a.round - b.round;
		return b.season - a.season; // Future seasons first
	});
	
	// Sort cash: by season descending (future cash first)
	cashItems.sort(function(a, b) {
		return b.season - a.season;
	});
	
	// Build asset list with searched player first
	var otherAssets = [];
	
	// Add other players (not the searched player)
	var otherPlayers = playerNames.filter(function(p) { return p.id !== matchedPlayerId; });
	otherPlayers.forEach(function(p) {
		otherAssets.push(p.name);
	});
	
	// Add picks
	picks.forEach(function(pick) {
		otherAssets.push(pick.season + ' ' + formatPickRound(pick.round));
	});
	
	// Add cash
	cashItems.forEach(function(cash) {
		otherAssets.push('$' + cash.amount);
	});
	
	return {
		matchedPlayerName: matchedPlayerName,
		otherAssets: otherAssets.join(', ')
	};
}

// Format a trade for search results
function formatTradeResult(trade, tradeNumber, summary) {
	var date = new Date(trade.timestamp);
	var monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
	var dateStr = monthNames[date.getMonth()] + ' ' + date.getFullYear();
	
	return {
		type: 'trade',
		tradeNumber: tradeNumber,
		matchedPlayerName: summary.matchedPlayerName || null,
		otherAssets: summary.otherAssets || null,
		dateStr: dateStr,
		url: '/trades/' + tradeNumber
	};
}

// Find trades involving specific players, with asset summaries
async function findTradesForPlayers(players, limit) {
	if (!players || players.length === 0) return [];
	
	var playerIds = players.map(function(p) { return p._id; });
	
	// Find trades where any party received these players (or their RFA rights)
	var trades = await Transaction.find({
		type: 'trade',
		$or: [
			{ 'parties.receives.players.playerId': { $in: playerIds } },
			{ 'parties.receives.rfaRights.playerId': { $in: playerIds } }
		]
	})
		.sort({ timestamp: -1 })
		.limit(limit)
		.lean();
	
	if (trades.length === 0) return [];
	
	// Build a lookup of searched player IDs
	var searchedPlayerIds = {};
	players.forEach(function(p) {
		searchedPlayerIds[p._id.toString()] = true;
	});
	
	// Collect all player IDs from all trades for name lookup
	var allPlayerIds = new Set();
	trades.forEach(function(trade) {
		(trade.parties || []).forEach(function(party) {
			(party.receives.players || []).forEach(function(p) {
				allPlayerIds.add(p.playerId.toString());
			});
			(party.receives.rfaRights || []).forEach(function(r) {
				allPlayerIds.add(r.playerId.toString());
			});
		});
	});
	
	// Look up all player names
	var playerDocs = await Player.find({ 
		_id: { $in: Array.from(allPlayerIds) } 
	}).select('name').lean();
	
	var allPlayerNames = {};
	playerDocs.forEach(function(p) {
		allPlayerNames[p._id.toString()] = p.name;
	});
	
	// Build summaries for each trade
	var results = trades.map(function(trade) {
		var summary = buildTradeSummary(trade, searchedPlayerIds, allPlayerNames);
		return { trade: trade, summary: summary };
	});
	
	return results;
}

// Player search for navbar typeahead
async function search(request, response) {
	try {
		var query = (request.query.q || '').trim();
		
		// Require at least 2 characters
		if (query.length < 2) {
			return response.render('search-results', { players: [], trades: [] });
		}
		
		var config = await LeagueConfig.findById('pso');
		var currentSeason = config ? config.season : new Date().getFullYear();
		
		// Check for direct trade number patterns: "trade 456", "trade #456", "#456", or just "456"
		var tradeNumberMatch = query.match(/^(?:trade\s*)?#?(\d+)$/i);
		if (tradeNumberMatch) {
			var tradeNumber = parseInt(tradeNumberMatch[1], 10);
			var trade = await Transaction.findOne({ type: 'trade', tradeId: tradeNumber }).lean();
			
			if (trade) {
				return response.render('search-results', {
					players: [],
					trades: [formatTradeResult(trade, tradeNumber)]
				});
			}
			// If no trade found with that number, fall through to regular search
		}
		
		// Check if query is just "trade" (show recent trades)
		if (query.toLowerCase() === 'trade' || query.toLowerCase() === 'trades') {
			var recentTrades = await Transaction.find({ type: 'trade' })
				.sort({ timestamp: -1 })
				.limit(5)
				.lean();
			
			// Get all trades to compute trade numbers
			var allTrades = await Transaction.find({ type: 'trade' })
				.sort({ timestamp: 1 })
				.select('_id tradeId')
				.lean();
			
			var tradeResults = recentTrades.map(function(trade) {
				return formatTradeResult(trade, trade.tradeId);
			});
			
			return response.render('search-results', {
				players: [],
				trades: tradeResults
			});
		}
		
		// Build flexible regex pattern to handle punctuation variations (A.J. vs AJ)
		var namePattern = buildFlexibleNamePattern(query);
		
		// Find all players matching the query
		// Sort by: searchRank ascending (lower = more relevant), nulls last, then name
		var players = await Player.aggregate([
			{ $match: { name: { $regex: namePattern, $options: 'i' } } },
			{ $addFields: { 
				searchRankSort: { $ifNull: ['$searchRank', 999999999] }
			}},
			{ $sort: { searchRankSort: 1, name: 1 } },
			{ $limit: 20 }
		]);
		
		if (players.length === 0) {
			return response.render('search-results', { players: [], trades: [] });
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
		
		// Build player results
		var { formatContractDisplay } = require('../helpers/view');
		
		var playerResults = players.map(function(player) {
			var contract = contractByPlayer[player._id.toString()];
			
			if (contract && contract.salary !== null) {
				// Player is rostered (has contract with salary)
				var regime = regimeByFranchise[contract.franchiseId.toString()];
				var franchise = franchiseById[contract.franchiseId.toString()];
				
				return {
					type: 'player',
					name: player.name,
					positions: player.positions || [],
					franchiseId: franchise ? franchise.rosterId : null,
					franchiseName: regime ? regime.displayName : 'Unknown',
					contractDisplay: formatContractDisplay(contract.salary, contract.startYear, contract.endYear),
					status: 'rostered'
				};
			} else if (contract && contract.salary === null) {
				// Player is an RFA (contract exists but salary is null)
				var regime = regimeByFranchise[contract.franchiseId.toString()];
				var franchise = franchiseById[contract.franchiseId.toString()];
				
				return {
					type: 'player',
					name: player.name,
					positions: player.positions || [],
					franchiseId: franchise ? franchise.rosterId : null,
					franchiseName: regime ? regime.displayName : 'Unknown',
					contractDisplay: null,
					status: 'rfa'
				};
			} else {
				// Player is an unrestricted free agent (no contract)
				return {
					type: 'player',
					name: player.name,
					positions: player.positions || [],
					franchiseId: null,
					franchiseName: null,
					contractDisplay: null,
					status: 'ufa'
				};
			}
		});
		
		// Sort: rostered first, then RFA, then UFA - preserve searchRank order within each group
		var statusOrder = { rostered: 0, rfa: 1, ufa: 2 };
		playerResults.sort(function(a, b) {
			return statusOrder[a.status] - statusOrder[b.status];
		});
		
		playerResults = playerResults.slice(0, 8);
		
		// Find trades involving the top matching players (use top 3 by searchRank)
		var topPlayers = players.slice(0, 3);
		var playerTradeResults = await findTradesForPlayers(topPlayers, 3);
		
		var tradeResults = playerTradeResults.map(function(result) {
			return formatTradeResult(result.trade, result.trade.tradeId, result.summary);
		});
		
		response.render('search-results', { 
			players: playerResults, 
			trades: tradeResults 
		});
	} catch (err) {
		console.error('Search error:', err);
		response.render('search-results', { players: [], trades: [] });
	}
}

module.exports = {
	getLeagueOverview: getLeagueOverview,
	getFranchise: getFranchise,
	overview: overview,
	franchise: franchise,
	search: search
};
