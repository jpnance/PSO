var Transaction = require('../models/Transaction');
var Player = require('../models/Player');
var Regime = require('../models/Regime');
var LeagueConfig = require('../models/LeagueConfig');

var FOOTNOTE_SYMBOLS = ['*', '†', '‡', '§', '¶', '#', '**', '††', '‡‡'];

async function getRegime(franchiseId, season) {
	if (!franchiseId) return null;
	return await Regime.findOne({
		franchiseId: franchiseId,
		startSeason: { $lte: season },
		$or: [{ endSeason: null }, { endSeason: { $gte: season } }]
	});
}

async function getDisplayName(franchiseId, season) {
	var regime = await getRegime(franchiseId, season);
	return regime ? regime.displayName : 'Unknown';
}

function isPlural(regime) {
	if (!regime) return false;
	// Multiple owners or special names like "Schexes"
	if (regime.ownerIds && regime.ownerIds.length > 1) return true;
	if (regime.displayName === 'Schexes') return true;
	if (regime.displayName && regime.displayName.includes('/')) return true;
	return false;
}

function formatContract(startYear, endYear) {
	if (!endYear) return 'unsigned';
	var start = startYear ? startYear.toString().slice(-2) : 'FA';
	var end = endYear.toString().slice(-2);
	return start + '/' + end;
}

function formatRound(round) {
	if (round === 1) return '1st';
	if (round === 2) return '2nd';
	if (round === 3) return '3rd';
	return round + 'th';
}

async function tradeHistory(request, response) {
	var config = await LeagueConfig.findById('pso');
	var currentSeason = config ? config.season : new Date().getFullYear();
	
	// Fetch all trades, oldest first (so we can number them)
	var trades = await Transaction.find({ type: 'trade' })
		.sort({ timestamp: 1 })
		.lean();
	
	// Create trade number lookup
	var tradeNumberMap = {};
	for (var i = 0; i < trades.length; i++) {
		tradeNumberMap[trades[i]._id.toString()] = i + 1;
	}
	
	// Get all players for lookups
	var players = await Player.find({}).lean();
	var playerMap = {};
	players.forEach(function(p) { playerMap[p._id.toString()] = p; });
	
	// Build pick trade history using composite key (season:round:originalFranchiseId)
	// This lets us track pick ownership across all trades, even without pickId
	var pickTradeHistory = {};
	
	function getPickKey(season, round, originalFranchiseId) {
		return season + ':' + round + ':' + originalFranchiseId.toString();
	}
	
	for (var i = 0; i < trades.length; i++) {
		var trade = trades[i];
		var tradeNumber = i + 1;
		for (var j = 0; j < (trade.parties || []).length; j++) {
			var party = trade.parties[j];
			for (var k = 0; k < (party.receives.picks || []).length; k++) {
				var pickInfo = party.receives.picks[k];
				// fromFranchiseId in the trade schema is the original owner
				if (pickInfo.season && pickInfo.round && pickInfo.fromFranchiseId) {
					var key = getPickKey(pickInfo.season, pickInfo.round, pickInfo.fromFranchiseId);
					if (!pickTradeHistory[key]) pickTradeHistory[key] = [];
					pickTradeHistory[key].push({
						tradeNumber: tradeNumber,
						tradeId: trade._id,
						receivingFranchiseId: party.franchiseId
					});
				}
			}
		}
	}
	
	// Build player trade history
	var playerTradeHistory = {};
	for (var i = 0; i < trades.length; i++) {
		var trade = trades[i];
		var tradeNumber = i + 1;
		for (var j = 0; j < (trade.parties || []).length; j++) {
			var party = trade.parties[j];
			for (var k = 0; k < (party.receives.players || []).length; k++) {
				var p = party.receives.players[k];
				var playerId = p.playerId.toString();
				if (!playerTradeHistory[playerId]) playerTradeHistory[playerId] = [];
				playerTradeHistory[playerId].push({
					tradeNumber: tradeNumber,
					receivingFranchiseId: party.franchiseId,
					contractStart: p.contractStart || p.startYear,
					contractEnd: p.contractEnd || p.endYear
				});
			}
		}
	}
	
	// Build display data for each trade
	var tradeData = [];
	
	for (var i = 0; i < trades.length; i++) {
		var trade = trades[i];
		var tradeNumber = i + 1;
		var tradeYear = trade.timestamp.getFullYear();
		
		var parties = [];
		var allFootnotes = []; // Collect footnotes for the whole trade
		
		for (var j = 0; j < (trade.parties || []).length; j++) {
			var party = trade.parties[j];
			var regime = await getRegime(party.franchiseId, tradeYear);
			var franchiseName = regime ? regime.displayName : 'Unknown';
			var usePlural = isPlural(regime);
			
			// Collect all assets with their display info
			var playerAssets = [];
			var seasonAssets = {};
			
			// Players - sorted by salary descending
			var playerList = (party.receives.players || []).slice();
			playerList.sort(function(a, b) { return (b.salary || 0) - (a.salary || 0); });
			
			for (var k = 0; k < playerList.length; k++) {
				var p = playerList[k];
				var player = playerMap[p.playerId.toString()];
				var playerName = player ? player.name : 'Unknown';
				var contract = formatContract(p.contractStart || p.startYear, p.contractEnd || p.endYear);
				
				var display = playerName + ' ($' + (p.salary || 0) + ', ' + contract + ')';
				
				// Check if this player was traded before on the same contract
				var history = playerTradeHistory[p.playerId.toString()] || [];
				var prevTrades = history.filter(function(h) {
					return h.tradeNumber < tradeNumber &&
					       h.contractStart === (p.contractStart || p.startYear) &&
					       h.contractEnd === (p.contractEnd || p.endYear);
				});
				if (prevTrades.length > 0) {
					var lastTrade = prevTrades[prevTrades.length - 1];
					var symbol = FOOTNOTE_SYMBOLS[allFootnotes.length % FOOTNOTE_SYMBOLS.length];
					display = playerName + symbol + ' ($' + (p.salary || 0) + ', ' + contract + ')';
					allFootnotes.push({ symbol: symbol, tradeNumber: lastTrade.tradeNumber });
				}
				
				playerAssets.push({ type: 'player', display: display });
			}
			
			// RFA rights
			for (var k = 0; k < (party.receives.rfaRights || []).length; k++) {
				var r = party.receives.rfaRights[k];
				var player = playerMap[r.playerId.toString()];
				var playerName = player ? player.name : 'Unknown';
				playerAssets.push({
					type: 'rfa',
					display: playerName + ' (RFA rights)'
				});
			}
			
			// Picks - grouped by season
			for (var k = 0; k < (party.receives.picks || []).length; k++) {
				var pickInfo = party.receives.picks[k];
				
				var season = pickInfo.season || currentSeason;
				var round = pickInfo.round || 1;
				var originalFranchiseId = pickInfo.fromFranchiseId;
				var originalOwner = originalFranchiseId ? await getDisplayName(originalFranchiseId, tradeYear) : 'Unknown';
				
				// Build "via" chain by looking at all previous trades for this pick
				var viaChain = [];
				if (originalFranchiseId) {
					var pickKey = getPickKey(season, round, originalFranchiseId);
					var history = pickTradeHistory[pickKey] || [];
					
					for (var h = 0; h < history.length; h++) {
						// Stop when we reach the current trade
						if (history[h].tradeNumber >= tradeNumber) break;
						
						// Add the receiving franchise from each prior trade
						var viaName = await getDisplayName(history[h].receivingFranchiseId, tradeYear);
						// Don't include the original owner in via chain (redundant)
						if (viaName !== originalOwner) {
							viaChain.push(viaName);
						}
					}
				}
				
				var display = formatRound(round) + ' round pick from ' + originalOwner;
				if (viaChain.length > 0) {
					display += ' (' + viaChain.map(function(v) { return 'via ' + v; }).join(', ') + ')';
				}
				display += ' in ' + season;
				
				// Check if pick was traded before for footnote reference
				if (originalFranchiseId) {
					var pickKey = getPickKey(season, round, originalFranchiseId);
					var history = pickTradeHistory[pickKey] || [];
					var prevTrades = history.filter(function(h) { return h.tradeNumber < tradeNumber; });
					if (prevTrades.length > 0) {
						var lastTrade = prevTrades[prevTrades.length - 1];
						var symbol = FOOTNOTE_SYMBOLS[allFootnotes.length % FOOTNOTE_SYMBOLS.length];
						display = display.replace(' in ' + season, symbol + ' in ' + season);
						allFootnotes.push({ symbol: symbol, tradeNumber: lastTrade.tradeNumber });
					}
				}
				
				if (!seasonAssets[season]) seasonAssets[season] = [];
				seasonAssets[season].push({ type: 'pick', display: display, sortOrder: 0 });
			}
			
			// Cash - grouped by season
			for (var k = 0; k < (party.receives.cash || []).length; k++) {
				var c = party.receives.cash[k];
				var fromOwner = c.fromFranchiseId ? await getDisplayName(c.fromFranchiseId, tradeYear) : 'Unknown';
				var display = '$' + c.amount + ' from ' + fromOwner + ' in ' + c.season;
				
				if (!seasonAssets[c.season]) seasonAssets[c.season] = [];
				seasonAssets[c.season].push({ type: 'cash', display: display, sortOrder: 1 });
			}
			
			// Build final asset list
			var allAssets = playerAssets.slice();
			
			var seasons = Object.keys(seasonAssets).map(Number).sort(function(a, b) { return a - b; });
			for (var s = 0; s < seasons.length; s++) {
				var seasonNum = seasons[s];
				var assets = seasonAssets[seasonNum];
				assets.sort(function(a, b) { return a.sortOrder - b.sortOrder; });
				for (var a = 0; a < assets.length; a++) {
					allAssets.push(assets[a]);
				}
			}
			
			if (allAssets.length === 0) {
				allAssets.push({ type: 'nothing', display: 'Nothing' });
			}
			
			parties.push({
				franchiseName: franchiseName,
				usePlural: usePlural,
				assets: allAssets
			});
		}
		
		tradeData.push({
			number: tradeNumber,
			timestamp: trade.timestamp,
			notes: trade.notes,
			parties: parties,
			footnotes: allFootnotes
		});
	}
	
	// Reverse for display (most recent first)
	tradeData.reverse();
	
	response.render('trade-history', {
		trades: tradeData,
		totalTrades: tradeData.length
	});
}

module.exports = {
	tradeHistory: tradeHistory
};
