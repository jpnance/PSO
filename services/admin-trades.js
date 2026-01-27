var Transaction = require('../models/Transaction');
var Player = require('../models/Player');
var Franchise = require('../models/Franchise');
var Regime = require('../models/Regime');
var budgetHelper = require('../helpers/budget');
var formatPick = require('../helpers/formatPick');
var { formatMoney, formatContractDisplay } = require('../helpers/view');

// Determine if a franchise name is plural (for grammar)
function isPlural(name) {
	return name === 'Schexes' || name.includes('/');
}

// Get display name for a franchise at a given season
async function getDisplayName(franchiseId, season) {
	if (!franchiseId) return 'Unknown';
	return await Regime.getDisplayName(franchiseId, season);
}

// GET /admin/trades - search/redirect to trade
async function listTrades(request, response) {
	var query = (request.query.q || '').trim();
	
	if (query) {
		// Try to find trade by number and redirect directly
		var tradeNumber = parseInt(query, 10);
		
		if (!isNaN(tradeNumber)) {
			var trade = await Transaction.findOne({ 
				type: 'trade', 
				tradeId: tradeNumber 
			});
			
			if (trade) {
				return response.redirect('/admin/trades/' + trade._id);
			}
		}
		
		// Trade not found
		return response.render('admin-trades', {
			query: query,
			notFound: true,
			activePage: 'admin-trades'
		});
	}
	
	// No search - just show the search form
	response.render('admin-trades', {
		query: '',
		notFound: false,
		activePage: 'admin-trades'
	});
}

// GET /admin/trades/:id - edit form
async function editTradeForm(request, response) {
	var trade = await Transaction.findById(request.params.id).lean();
	
	if (!trade || trade.type !== 'trade') {
		return response.status(404).send('Trade not found');
	}
	
	var tradeYear = trade.timestamp ? trade.timestamp.getFullYear() : new Date().getFullYear();
	
	// Get all players for lookups
	var players = await Player.find({}).lean();
	var playerMap = {};
	players.forEach(function(p) { playerMap[p._id.toString()] = p; });
	
	// Get all franchises
	var franchises = await Franchise.find({}).lean();
	
	// Build enriched party data
	var parties = [];
	for (var j = 0; j < (trade.parties || []).length; j++) {
		var party = trade.parties[j];
		var franchiseName = await getDisplayName(party.franchiseId, tradeYear);
		
		// Enrich players
		var playersData = [];
		for (var k = 0; k < (party.receives.players || []).length; k++) {
			var p = party.receives.players[k];
			var player = playerMap[p.playerId.toString()];
			playersData.push({
				playerId: p.playerId,
				playerName: player ? player.name : 'Unknown',
				positions: player ? player.positions : [],
				salary: p.salary,
				startYear: p.startYear,
				endYear: p.endYear,
				rfaRights: p.rfaRights
			});
		}
		
		// Enrich picks
		var picksData = [];
		for (var k = 0; k < (party.receives.picks || []).length; k++) {
			var pick = party.receives.picks[k];
			var fromName = await getDisplayName(pick.fromFranchiseId, pick.season);
			picksData.push({
				round: pick.round,
				season: pick.season,
				fromFranchiseId: pick.fromFranchiseId,
				fromName: fromName,
				pickNumber: pick.pickNumber
			});
		}
		
		// Enrich cash
		var cashData = [];
		for (var k = 0; k < (party.receives.cash || []).length; k++) {
			var cash = party.receives.cash[k];
			var fromName = await getDisplayName(cash.fromFranchiseId, cash.season);
			cashData.push({
				amount: cash.amount,
				season: cash.season,
				fromFranchiseId: cash.fromFranchiseId,
				fromName: fromName,
				index: k
			});
		}
		
		// Enrich RFA rights
		var rfaData = [];
		for (var k = 0; k < (party.receives.rfaRights || []).length; k++) {
			var rfa = party.receives.rfaRights[k];
			var player = playerMap[rfa.playerId.toString()];
			rfaData.push({
				playerId: rfa.playerId,
				playerName: player ? player.name : 'Unknown',
				positions: player ? player.positions : []
			});
		}
		
		// Build assets array for trade card display (matches +tradeParty mixin format)
		var assets = [];
		
		// Players first, sorted by salary descending
		var sortedPlayers = playersData.slice().sort(function(a, b) {
			return (b.salary || 0) - (a.salary || 0);
		});
		sortedPlayers.forEach(function(p) {
			var contractInfo = formatContractDisplay(p.salary || 0, p.startYear, p.endYear);
			if (p.rfaRights) {
				contractInfo += ' (RFA)';
			}
			assets.push({
				type: 'player',
				playerName: p.playerName,
				positions: p.positions || [],
				contractInfo: contractInfo
			});
		});
		
		// RFA rights
		rfaData.forEach(function(rfa) {
			assets.push({
				type: 'rfa',
				playerName: rfa.playerName,
				positions: rfa.positions || [],
				contractInfo: 'RFA rights'
			});
		});
		
		// Group picks and cash by season for sorted display
		var seasonAssets = {};
		
		picksData.forEach(function(pick) {
			var season = pick.season;
			if (!seasonAssets[season]) seasonAssets[season] = [];
			
			var pickMain = formatPick.formatRound(pick.round) + ' round pick';
			var pickContext = 'in ' + season + ' (' + pick.fromName + ')';
			
			seasonAssets[season].push({
				type: 'pick',
				pickMain: pickMain,
				pickContext: pickContext,
				sortOrder: 0,
				sortKey: pick.pickNumber || 999
			});
		});
		
		cashData.forEach(function(cash) {
			var season = cash.season;
			if (!seasonAssets[season]) seasonAssets[season] = [];
			
			seasonAssets[season].push({
				type: 'cash',
				cashMain: formatMoney(cash.amount),
				cashContext: 'from ' + cash.fromName + ' in ' + cash.season,
				sortOrder: 1
			});
		});
		
		// Add season assets in chronological order
		var seasons = Object.keys(seasonAssets).map(Number).sort(function(a, b) { return a - b; });
		seasons.forEach(function(season) {
			var items = seasonAssets[season];
			items.sort(function(a, b) {
				if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
				return (a.sortKey || 0) - (b.sortKey || 0);
			});
			items.forEach(function(item) {
				assets.push(item);
			});
		});
		
		parties.push({
			franchiseId: party.franchiseId,
			franchiseName: franchiseName,
			usePlural: isPlural(franchiseName),
			assets: assets,
			players: playersData,
			picks: picksData,
			cash: cashData,
			rfaRights: rfaData,
			partyIndex: j
		});
	}
	
	response.render('admin-trade-edit', {
		trade: trade,
		parties: parties,
		tradeYear: tradeYear,
		query: request.query,
		activePage: 'admin-trades'
	});
}

// POST /admin/trades/:id - save changes
async function editTrade(request, response) {
	var tradeId = request.params.id;
	var body = request.body;
	
	var trade = await Transaction.findById(tradeId);
	if (!trade || trade.type !== 'trade') {
		return response.status(404).send('Trade not found');
	}
	
	// Track affected franchises and seasons for budget recalculation
	var affectedFranchises = new Set();
	var affectedSeasons = new Set();
	
	// Collect current cash info before changes
	trade.parties.forEach(function(party) {
		(party.receives.cash || []).forEach(function(c) {
			affectedFranchises.add(party.franchiseId.toString());
			if (c.fromFranchiseId) affectedFranchises.add(c.fromFranchiseId.toString());
			affectedSeasons.add(c.season);
		});
	});
	
	// Update notes
	var newNotes = (body.notes || '').trim();
	trade.notes = newNotes || null;
	
	// Update timestamp if provided (datetime-local is in ET)
	if (body.timestamp) {
		// The datetime-local input gives us a string like "2024-08-15T14:30" in ET
		// We need to parse this as ET and convert to UTC for storage
		// Using a simple approach: parse it, then adjust for ET offset
		var parts = body.timestamp.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
		if (parts) {
			var year = parseInt(parts[1], 10);
			var month = parseInt(parts[2], 10) - 1;
			var day = parseInt(parts[3], 10);
			var hours = parseInt(parts[4], 10);
			var mins = parseInt(parts[5], 10);
			
			// Create a Date object treating the input as ET
			// We'll use a timezone-aware approach
			var etDateStr = parts[1] + '-' + parts[2] + '-' + parts[3] + 'T' + parts[4] + ':' + parts[5] + ':00';
			
			// Parse as if local, then we rely on the fact that the server should handle this
			// For simplicity, create the date and let JS handle it
			// This works if server is in US timezone; for robustness, we'd use a library
			var localDate = new Date(year, month, day, hours, mins, 0);
			trade.timestamp = localDate;
		}
	}
	
	// Update cash amounts/seasons if provided
	// Format: cash_0_0_amount, cash_0_0_season (party index, cash index)
	// Setting amount to 0 removes the cash entry
	var cashModified = false;
	for (var i = 0; i < trade.parties.length; i++) {
		var party = trade.parties[i];
		var updatedCash = [];
		
		for (var j = 0; j < (party.receives.cash || []).length; j++) {
			var amountKey = 'cash_' + i + '_' + j + '_amount';
			var seasonKey = 'cash_' + i + '_' + j + '_season';
			var cashEntry = party.receives.cash[j];
			
			if (body[amountKey] !== undefined) {
				var newAmount = parseInt(body[amountKey], 10);
				if (!isNaN(newAmount) && newAmount !== cashEntry.amount) {
					cashEntry.amount = newAmount;
					cashModified = true;
				}
			}
			
			if (body[seasonKey] !== undefined) {
				var newSeason = parseInt(body[seasonKey], 10);
				if (!isNaN(newSeason) && newSeason !== cashEntry.season) {
					// Track the new season too
					affectedSeasons.add(newSeason);
					cashEntry.season = newSeason;
					cashModified = true;
				}
			}
			
			// Only keep cash entries with amount > 0
			if (cashEntry.amount > 0) {
				updatedCash.push(cashEntry);
			} else {
				cashModified = true; // Entry was removed
			}
		}
		
		party.receives.cash = updatedCash;
	}
	
	trade.markModified('parties');
	await trade.save();
	
	// Recalculate budgets if cash was modified
	if (cashModified && affectedFranchises.size > 0 && affectedSeasons.size > 0) {
		var franchiseIds = Array.from(affectedFranchises);
		var seasons = Array.from(affectedSeasons);
		await budgetHelper.recalculateCashForBudgets(franchiseIds, seasons);
	}
	
	response.redirect('/admin/trades/' + tradeId + '?saved=1');
}

module.exports = {
	listTrades: listTrades,
	editTradeForm: editTradeForm,
	editTrade: editTrade
};
