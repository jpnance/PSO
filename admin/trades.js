var Transaction = require('../models/Transaction');
var Player = require('../models/Player');
var Franchise = require('../models/Franchise');
var Regime = require('../models/Regime');
var budgetHelper = require('../helpers/budget');

// Determine if a franchise name is plural (for grammar)
function isPlural(name) {
	return name === 'Schexes' || name.includes('/');
}

// Get display name for a franchise at a given season
async function getDisplayName(franchiseId, season) {
	if (!franchiseId) return 'Unknown';
	var regime = await Regime.findOne({
		franchiseId: franchiseId,
		startSeason: { $lte: season },
		$or: [{ endSeason: null }, { endSeason: { $gte: season } }]
	});
	return regime ? regime.displayName : 'Unknown';
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
			pageTitle: 'Trades - PSO Admin',
			activePage: 'admin'
		});
	}
	
	// No search - just show the search form
	response.render('admin-trades', {
		query: '',
		notFound: false,
		pageTitle: 'Trades - PSO Admin',
		activePage: 'admin'
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
				playerName: player ? player.name : 'Unknown'
			});
		}
		
		parties.push({
			franchiseId: party.franchiseId,
			franchiseName: franchiseName,
			usePlural: isPlural(franchiseName),
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
		pageTitle: 'Trade #' + (trade.tradeId || trade._id) + ' - PSO Admin',
		activePage: 'admin'
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
