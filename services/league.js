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
var { getPositionIndex, shortenPlayerName } = require('../helpers/view');

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

function formatRelativeDate(date) {
	if (!date) return null;
	
	var today = new Date();
	today.setHours(0, 0, 0, 0);
	var target = new Date(date);
	target.setHours(0, 0, 0, 0);
	
	var diffMs = target - today;
	var diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
	
	if (diffDays < 0) return null;
	if (diffDays === 0) return 'Today';
	if (diffDays === 1) return 'Tomorrow';
	if (diffDays < 7) return 'In ' + diffDays + ' days';
	
	var diffWeeks = Math.round(diffDays / 7);
	if (diffWeeks === 1) return 'In 1 week';
	if (diffWeeks < 5) return 'In ' + diffWeeks + ' weeks';
	
	var diffMonths = Math.round(diffDays / 30);
	if (diffMonths === 1) return 'In 1 month';
	return 'In ' + diffMonths + ' months';
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
				relativeDate: formatRelativeDate(e.date),
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
	
	// Load budgets for current season and next season
	var budgets = await Budget.find({ season: { $in: [currentSeason, currentSeason + 1] } }).lean();
	var budgetByFranchiseSeason = {};
	budgets.forEach(function(b) {
		var key = b.franchiseId.toString() + ':' + b.season;
		budgetByFranchiseSeason[key] = b;
	});
	
	// Load picks for upcoming draft (next available draft season)
	var picks = await Pick.find({ 
		season: { $gte: currentSeason },
		status: 'available'
	}).lean();
	
	// Build pick counts by franchise and season
	var pickCountsByFranchise = {};
	picks.forEach(function(p) {
		var fid = p.currentFranchiseId.toString();
		if (!pickCountsByFranchise[fid]) {
			pickCountsByFranchise[fid] = {};
		}
		if (!pickCountsByFranchise[fid][p.season]) {
			pickCountsByFranchise[fid][p.season] = 0;
		}
		pickCountsByFranchise[fid][p.season]++;
	});
	
	// Build franchise data
	var result = [];
	for (var i = 0; i < franchises.length; i++) {
		var franchise = franchises[i];
		var fid = franchise._id.toString();
		
		// Find current regime
		var regime = regimes.find(function(r) {
			return r.franchiseId.equals(franchise._id) &&
				r.startSeason <= currentSeason &&
				(r.endSeason === null || r.endSeason >= currentSeason);
		});
		
		// Find roster (contracts for this franchise) - separate actual contracts from RFA rights
		var franchiseContracts = contracts.filter(function(c) { 
			return c.franchiseId.equals(franchise._id); 
		});
		
		var actualContracts = franchiseContracts.filter(function(c) { return c.salary !== null; });
		var rfaContracts = franchiseContracts.filter(function(c) { return c.salary === null; });
		
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
		
		// Count positions and salary for distribution bars
		var positionCounts = { QB: 0, RB: 0, WR: 0, TE: 0, IDP: 0, K: 0 };
		var salaryCounts = { QB: 0, RB: 0, WR: 0, TE: 0, IDP: 0, K: 0 };
		roster.forEach(function(player) {
			var pos = player.positions[0];
			var salary = player.salary || 0;
			if (pos === 'QB') { positionCounts.QB++; salaryCounts.QB += salary; }
			else if (pos === 'RB') { positionCounts.RB++; salaryCounts.RB += salary; }
			else if (pos === 'WR') { positionCounts.WR++; salaryCounts.WR += salary; }
			else if (pos === 'TE') { positionCounts.TE++; salaryCounts.TE += salary; }
			else if (['DL', 'LB', 'DB'].includes(pos)) { positionCounts.IDP++; salaryCounts.IDP += salary; }
			else if (pos === 'K') { positionCounts.K++; salaryCounts.K += salary; }
		});
		
		// Get budget from Budget documents
		var budget = budgetByFranchiseSeason[fid + ':' + currentSeason] || {
			payroll: 0,
			available: 1000,
			buyOuts: 0
		};
		var nextBudget = budgetByFranchiseSeason[fid + ':' + (currentSeason + 1)] || {
			payroll: 0,
			available: 1000
		};
		
		// Find next draft season with picks
		var franchisePicks = pickCountsByFranchise[fid] || {};
		var nextDraftSeason = null;
		var nextDraftPickCount = 0;
		var draftSeasons = Object.keys(franchisePicks).map(Number).sort();
		if (draftSeasons.length > 0) {
			nextDraftSeason = draftSeasons[0];
			nextDraftPickCount = franchisePicks[nextDraftSeason];
		}
		
		result.push({
			_id: franchise._id,
			rosterId: franchise.rosterId,
			displayName: regime ? regime.displayName : 'Unknown',
			owners: regime ? Regime.sortOwnerNames(regime.ownerIds) : [],
			roster: roster,
			rosterCount: roster.length,
			rfaCount: rfaContracts.length,
			positionCounts: positionCounts,
			salaryCounts: salaryCounts,
			payroll: budget.payroll,
			available: budget.available,
			buyOuts: budget.buyOuts,
			nextYearAvailable: nextBudget.available,
			nextDraftSeason: nextDraftSeason,
			nextDraftPickCount: nextDraftPickCount
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
		
		// Attach standings info to each franchise for card display
		// Match on franchiseId (rosterId) instead of name, since names change with regimes
		if (standingsData && standingsData.standings) {
			var standingsById = {};
			standingsData.standings.forEach(function(team) {
				standingsById[team.franchiseId] = team;
			});
			
			franchises.forEach(function(f) {
				var standing = standingsById[f.rosterId];
				if (standing) {
					f.record = {
						wins: standing.wins,
						losses: standing.losses,
						ties: standing.ties,
						rank: standing.rank
					};
				}
			});
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
			rosterLimit: LeagueConfig.ROSTER_LIMIT,
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
	var otherAssetsShort = [];
	
	// Add other players (not the searched player)
	var otherPlayers = playerNames.filter(function(p) { return p.id !== matchedPlayerId; });
	otherPlayers.forEach(function(p) {
		otherAssets.push(p.name);
		otherAssetsShort.push(shortenPlayerName(p.name));
	});
	
	// Add picks
	picks.forEach(function(pick) {
		var pickStr = pick.season + ' ' + formatPickRound(pick.round);
		otherAssets.push(pickStr);
		otherAssetsShort.push(pickStr);
	});
	
	// Add cash
	cashItems.forEach(function(cash) {
		var cashStr = '$' + cash.amount;
		otherAssets.push(cashStr);
		otherAssetsShort.push(cashStr);
	});
	
	return {
		matchedPlayerName: matchedPlayerName,
		matchedPlayerShort: matchedPlayerName ? shortenPlayerName(matchedPlayerName) : null,
		otherAssets: otherAssets.join(', '),
		otherAssetsShort: otherAssetsShort.join(', ')
	};
}

// Format a trade for search results
function formatTradeResult(trade, tradeNumber, summary) {
	var date = new Date(trade.timestamp);
	var monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
	var dateStr = monthNames[date.getMonth()] + ' ' + date.getFullYear();
	
	// Handle missing summary (for searches without player context)
	summary = summary || {};
	
	return {
		type: 'trade',
		tradeNumber: tradeNumber,
		matchedPlayerName: summary.matchedPlayerName || null,
		matchedPlayerShort: summary.matchedPlayerShort || null,
		otherAssets: summary.otherAssets || null,
		otherAssetsShort: summary.otherAssetsShort || null,
		dateStr: dateStr,
		url: '/trades/' + tradeNumber
	};
}

// Collect all player IDs from an array of trades
function collectPlayerIdsFromTrades(trades) {
	var playerIds = new Set();
	trades.forEach(function(trade) {
		(trade.parties || []).forEach(function(party) {
			(party.receives.players || []).forEach(function(p) {
				playerIds.add(p.playerId.toString());
			});
			(party.receives.rfaRights || []).forEach(function(r) {
				playerIds.add(r.playerId.toString());
			});
		});
	});
	return Array.from(playerIds);
}

// Build summaries for trades without a searched player context
async function buildTradeSummaries(trades) {
	if (!trades || trades.length === 0) return [];
	
	// Collect all player IDs and fetch names
	var playerIds = collectPlayerIdsFromTrades(trades);
	var playerDocs = await Player.find({ _id: { $in: playerIds } }).select('name').lean();
	
	var allPlayerNames = {};
	playerDocs.forEach(function(p) {
		allPlayerNames[p._id.toString()] = p.name;
	});
	
	// Build summary for each trade (no searched player to highlight)
	return trades.map(function(trade) {
		return buildTradeSummary(trade, {}, allPlayerNames);
	});
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
				var summaries = await buildTradeSummaries([trade]);
				return response.render('search-results', {
					players: [],
					trades: [formatTradeResult(trade, tradeNumber, summaries[0])]
				});
			}
			// If no trade found with that number, fall through to regular search
		}
		
		// Check if query is "trade" or "trades" - we'll show recent trades alongside any player results
		var isTradeKeyword = (query.toLowerCase() === 'trade' || query.toLowerCase() === 'trades');
		
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
			// No player matches - but if it's a trade keyword, show recent trades
			if (isTradeKeyword) {
				var recentTrades = await Transaction.find({ type: 'trade' })
					.sort({ timestamp: -1 })
					.limit(5)
					.lean();
				
				var summaries = await buildTradeSummaries(recentTrades);
				var tradeResults = recentTrades.map(function(trade, i) {
					return formatTradeResult(trade, trade.tradeId, summaries[i]);
				});
				
				return response.render('search-results', { players: [], trades: tradeResults });
			}
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
		
		// Show 5 players, track extras
		var totalPlayers = playerResults.length;
		var displayedPlayers = playerResults.slice(0, 5);
		var extraPlayersCount = Math.max(0, totalPlayers - 5);
		
		// Find trades to display
		var displayedTrades = [];
		var extraTrades = [];
		
		if (isTradeKeyword) {
			// For "trade"/"trades" keyword, show recent trades (not player-specific)
			var recentTrades = await Transaction.find({ type: 'trade' })
				.sort({ timestamp: -1 })
				.limit(5)
				.lean();
			
			var summaries = await buildTradeSummaries(recentTrades);
			displayedTrades = recentTrades.map(function(trade, i) {
				return formatTradeResult(trade, trade.tradeId, summaries[i]);
			});
		} else {
			// Find trades involving the displayed players (fetch more to show extras as links)
			var topPlayers = players.slice(0, 5);
			var playerTradeResults = await findTradesForPlayers(topPlayers, 6);
			
			var allTradeResults = playerTradeResults.map(function(result) {
				return formatTradeResult(result.trade, result.trade.tradeId, result.summary);
			});
			
			// Show 3 trades, track extras as quick links
			displayedTrades = allTradeResults.slice(0, 3);
			extraTrades = allTradeResults.slice(3).map(function(t) {
				return { tradeNumber: t.tradeNumber, url: t.url };
			});
		}
		
		response.render('search-results', { 
			players: displayedPlayers,
			extraPlayersCount: extraPlayersCount,
			trades: displayedTrades,
			extraTrades: extraTrades
		});
	} catch (err) {
		console.error('Search error:', err);
		response.render('search-results', { players: [], trades: [] });
	}
}

// Build timeline data for Wikipedia-style franchise history chart
async function getTimelineData(currentSeason) {
	var startYear = 2008;
	var endYear = currentSeason;
	var years = [];
	for (var y = startYear; y <= endYear; y++) {
		years.push(y);
	}
	
	// Fetch all regimes with populated owners
	var regimes = await Regime.find({})
		.populate('ownerIds')
		.populate('franchiseId')
		.lean();
	
	// Get all franchises
	var franchises = await Franchise.find({}).lean();
	var franchiseById = {};
	franchises.forEach(function(f) {
		franchiseById[f._id.toString()] = f;
	});
	
	// Build a map of person -> seasons -> franchises they managed
	var personSeasons = {};
	var peopleMap = {};
	
	regimes.forEach(function(regime) {
		var franchise = franchiseById[regime.franchiseId._id ? regime.franchiseId._id.toString() : regime.franchiseId.toString()];
		var rosterId = franchise ? franchise.rosterId : null;
		
		var start = regime.startSeason;
		var end = regime.endSeason || currentSeason;
		
		// For each owner of this regime
		(regime.ownerIds || []).forEach(function(owner) {
			if (!owner || !owner._id) return;
			
			var personId = owner._id.toString();
			var personName = owner.name;
			
			if (!personSeasons[personId]) {
				personSeasons[personId] = {};
				peopleMap[personId] = personName;
			}
			
			// Mark each season they were active
			for (var y = start; y <= end && y <= currentSeason; y++) {
				if (!personSeasons[personId][y]) {
					personSeasons[personId][y] = [];
				}
				personSeasons[personId][y].push({
					rosterId: rosterId,
					displayName: regime.displayName
				});
			}
		});
	});
	
	// Determine the color for each franchise (consistent across the chart)
	// Using 12 distinct colors that work well together
	var franchiseColors = {
		1: '#e74c3c',   // red
		2: '#3498db',   // blue
		3: '#2ecc71',   // green
		4: '#9b59b6',   // purple
		5: '#f39c12',   // orange
		6: '#1abc9c',   // teal
		7: '#e91e63',   // pink
		8: '#00bcd4',   // cyan
		9: '#ff5722',   // deep orange
		10: '#8bc34a',  // light green
		11: '#ffc107',  // amber
		12: '#607d8b'   // blue grey
	};
	
	// Build rows for each person
	var rows = [];
	Object.keys(personSeasons).forEach(function(personId) {
		var personName = peopleMap[personId];
		var seasons = personSeasons[personId];
		
		// Find first and last active seasons
		var activeYears = Object.keys(seasons).map(Number).sort(function(a, b) { return a - b; });
		var firstSeason = activeYears[0];
		var lastSeason = activeYears[activeYears.length - 1];
		var isCurrent = lastSeason >= currentSeason;
		
		// Build cells for each year
		var cells = years.map(function(year) {
			var active = seasons[year] || [];
			if (active.length === 0) {
				return { year: year, active: false };
			}
			
			// Handle co-ownership: could be on multiple franchises (rare but possible)
			// For display, just use the first one
			var franchise = active[0];
			
			return {
				year: year,
				active: true,
				rosterId: franchise.rosterId,
				displayName: franchise.displayName,
				color: franchiseColors[franchise.rosterId] || '#666'
			};
		});
		
		rows.push({
			personId: personId,
			personName: personName,
			cells: cells,
			firstSeason: firstSeason,
			lastSeason: lastSeason,
			isCurrent: isCurrent,
			yearsActive: activeYears.length
		});
	});
	
	// Sort rows: current owners first (sorted by first season), then past owners (sorted by last season desc)
	rows.sort(function(a, b) {
		if (a.isCurrent && !b.isCurrent) return -1;
		if (!a.isCurrent && b.isCurrent) return 1;
		
		if (a.isCurrent && b.isCurrent) {
			// Both current: sort by first season (veterans first)
			return a.firstSeason - b.firstSeason;
		}
		
		// Both past: sort by last season (most recent first)
		return b.lastSeason - a.lastSeason;
	});
	
	// Build franchise legend
	var legend = Object.keys(franchiseColors).map(function(rosterId) {
		// Find current regime name for this franchise
		var currentRegime = regimes.find(function(r) {
			var f = franchiseById[r.franchiseId._id ? r.franchiseId._id.toString() : r.franchiseId.toString()];
			return f && f.rosterId === parseInt(rosterId) && 
				r.startSeason <= currentSeason && 
				(r.endSeason === null || r.endSeason >= currentSeason);
		});
		
		return {
			rosterId: parseInt(rosterId),
			displayName: currentRegime ? currentRegime.displayName : 'Franchise ' + rosterId,
			color: franchiseColors[rosterId]
		};
	}).sort(function(a, b) {
		return a.displayName.localeCompare(b.displayName);
	});
	
	// Build per-franchise breakdowns
	var franchiseBreakdowns = legend.map(function(legendItem) {
		var rosterId = legendItem.rosterId;
		
		// Filter rows to only people who were ever on this franchise
		var franchiseRows = rows.filter(function(row) {
			return row.cells.some(function(cell) {
				return cell.active && cell.rosterId === rosterId;
			});
		}).map(function(row) {
			// Rebuild cells to only show this franchise
			var cells = row.cells.map(function(cell) {
				if (cell.active && cell.rosterId === rosterId) {
					return cell;
				}
				return { year: cell.year, active: false };
			});
			
			return {
				personName: row.personName,
				cells: cells,
				isCurrent: row.isCurrent && row.cells.find(function(c) { 
					return c.year === currentSeason && c.active && c.rosterId === rosterId; 
				})
			};
		});
		
		// Sort: waterfall - who got there first, tiebreak by who left last
		// (current owners naturally end up at bottom since they haven't left)
		franchiseRows.sort(function(a, b) {
			var aFirst = a.cells.findIndex(function(c) { return c.active; });
			var bFirst = b.cells.findIndex(function(c) { return c.active; });
			
			if (aFirst !== bFirst) return aFirst - bFirst;
			
			// Tiebreak: who left last (find last active cell)
			var aLast = a.cells.length - 1 - a.cells.slice().reverse().findIndex(function(c) { return c.active; });
			var bLast = b.cells.length - 1 - b.cells.slice().reverse().findIndex(function(c) { return c.active; });
			return aLast - bLast;
		});
		
		return {
			rosterId: rosterId,
			displayName: legendItem.displayName,
			color: legendItem.color,
			rows: franchiseRows
		};
	});
	
	return {
		years: years,
		rows: rows,
		legend: legend,
		franchises: franchiseBreakdowns,
		currentSeason: currentSeason,
		totalPeople: rows.length
	};
}

async function timeline(request, response) {
	try {
		var config = await LeagueConfig.findById('pso');
		var currentSeason = config ? config.season : new Date().getFullYear();
		
		var timelineData = await getTimelineData(currentSeason);
		
		response.render('timeline', {
			timeline: timelineData,
			currentSeason: currentSeason,
			activePage: 'timeline'
		});
	} catch (err) {
		console.error('Timeline error:', err);
		response.status(500).send('Error loading timeline');
	}
}

module.exports = {
	getLeagueOverview: getLeagueOverview,
	getFranchise: getFranchise,
	overview: overview,
	franchise: franchise,
	search: search,
	timeline: timeline
};
