var Transaction = require('../models/Transaction');
var Player = require('../models/Player');
var Franchise = require('../models/Franchise');
var Regime = require('../models/Regime');
var budgetHelper = require('../helpers/budget');
var formatPick = require('../helpers/formatPick');
var { formatMoney, formatContractDisplay, isPluralName } = require('../helpers/view');
var { getRegimeName } = require('../helpers/regime');

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
	
	var franchises = await Franchise.find({}).lean();
	var regimes = await Regime.find({}).lean();
	
	// Build enriched party data
	var parties = [];
	for (var j = 0; j < (trade.parties || []).length; j++) {
		var party = trade.parties[j];
		var regimeName = party.regimeName || getRegimeName(regimes, party.franchiseId, tradeYear);
		
		// Enrich players
		var playersData = [];
		for (var k = 0; k < (party.receives.players || []).length; k++) {
			var p = party.receives.players[k];
			var player = playerMap[p.playerId.toString()];
		playersData.push({
			playerId: p.playerId,
			playerName: player ? player.name : 'Unknown',
			href: player && player.slugs && player.slugs[0] ? '/players/' + player.slugs[0] : null,
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
			var fromName = getRegimeName(regimes, pick.fromFranchiseId, pick.season);
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
			var fromName = getRegimeName(regimes, cash.fromFranchiseId, cash.season);
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
			href: player && player.slugs && player.slugs[0] ? '/players/' + player.slugs[0] : null,
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
			href: p.href,
			positions: p.positions || [],
			contractInfo: contractInfo
		});
	});
	
	// RFA rights
	rfaData.forEach(function(rfa) {
		assets.push({
			type: 'rfa',
			playerName: rfa.playerName,
			href: rfa.href,
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
			regimeName: regimeName,
			regimeName: party.regimeName || '',
			usePlural: isPluralName(regimeName),
			assets: assets,
			players: playersData,
			picks: picksData,
			cash: cashData,
			rfaRights: rfaData,
			partyIndex: j
		});
	}
	
	parties.sort(function(a, b) {
		return a.regimeName.localeCompare(b.regimeName);
	});

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
	
	// Update regime names
	for (var i = 0; i < trade.parties.length; i++) {
		var key = 'regimeName_' + i;
		if (body[key] !== undefined) {
			var newName = (body[key] || '').trim();
			trade.parties[i].regimeName = newName || null;
		}
	}

	// Update notes
	var newNotes = (body.notes || '').trim();
	trade.notes = newNotes || null;
	
	// Update timestamp if provided (input is in ET, stored as UTC)
	if (body.timestamp) {
		var parts = body.timestamp.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
		if (parts) {
			// Determine ET offset (EDT = -4, EST = -5) by asking Intl for this date
			var naive = new Date(parseInt(parts[1], 10), parseInt(parts[2], 10) - 1, parseInt(parts[3], 10));
			var etStr = naive.toLocaleString('en-US', { timeZone: 'America/New_York', timeZoneName: 'short' });
			var offsetHours = etStr.includes('EDT') ? 4 : 5;

			trade.timestamp = new Date(parts[1] + '-' + parts[2] + '-' + parts[3] + 'T' + parts[4] + ':' + parts[5] + ':00-0' + offsetHours + ':00');
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
