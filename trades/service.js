var Transaction = require('../models/Transaction');
var Player = require('../models/Player');
var Pick = require('../models/Pick');
var Regime = require('../models/Regime');
var LeagueConfig = require('../models/LeagueConfig');


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

function formatPickNumber(pickNumber, teamsPerRound) {
	// Convert overall pick number to round.pick format (e.g., 2.04)
	teamsPerRound = teamsPerRound || 12;
	var round = Math.ceil(pickNumber / teamsPerRound);
	var pickInRound = ((pickNumber - 1) % teamsPerRound) + 1;
	return round + '.' + pickInRound.toString().padStart(2, '0');
}

// Shared logic to build trade display data
async function buildTradeDisplayData(trades, options) {
	options = options || {};
	var currentSeason = options.currentSeason || new Date().getFullYear();
	
	// Get all players for lookups
	var players = await Player.find({}).lean();
	var playerMap = {};
	players.forEach(function(p) { playerMap[p._id.toString()] = p; });
	
	// Get all picks for lookups (keyed by season:round:originalFranchiseId)
	var picks = await Pick.find({}).lean();
	var pickLookup = {};
	picks.forEach(function(p) {
		var key = p.season + ':' + p.round + ':' + p.originalFranchiseId.toString();
		pickLookup[key] = p;
	});
	
	// Get all draft-select transactions to find which player each pick became
	var draftSelections = await Transaction.find({ type: 'draft-select' }).lean();
	var pickToPlayer = {}; // pickId -> playerId
	draftSelections.forEach(function(t) {
		if (t.pickId && t.playerId) {
			pickToPlayer[t.pickId.toString()] = t.playerId.toString();
		}
	});
	
	// Build pick trade history using composite key (season:round:originalFranchiseId)
	// This lets us track pick ownership across all trades, even without pickId
	var pickTradeHistory = {};
	
	function getPickKey(season, round, originalFranchiseId) {
		return season + ':' + round + ':' + originalFranchiseId.toString();
	}
	
	for (var i = 0; i < trades.length; i++) {
		var trade = trades[i];
		var tradeNumber = trade.wordpressTradeId || (i + 1);
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
		var tradeNumber = trade.wordpressTradeId || (i + 1);
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
		var tradeNumber = trade.wordpressTradeId || (i + 1);
		var tradeYear = trade.timestamp.getFullYear();
		
		var parties = [];
		
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
				var notes = [];
				
				// Build chain of all trades for this player on the same contract
				var history = playerTradeHistory[p.playerId.toString()] || [];
				var sameContractTrades = history.filter(function(h) {
					return h.contractStart === (p.contractStart || p.startYear) &&
					       h.contractEnd === (p.contractEnd || p.endYear);
				});
				sameContractTrades.sort(function(a, b) { return a.tradeNumber - b.tradeNumber; });
				
				// Only show chain if there's more than just this trade
				if (sameContractTrades.length > 1) {
					var chain = [];
					for (var t = 0; t < sameContractTrades.length; t++) {
						var chainItem = sameContractTrades[t];
						chain.push({
							tradeNumber: chainItem.tradeNumber,
							isCurrent: chainItem.tradeNumber === tradeNumber
						});
					}
					notes.push({ type: 'chain', items: chain, separator: '·' });
				}
				
				playerAssets.push({ type: 'player', display: display, notes: notes });
			}
			
			// RFA rights
			for (var k = 0; k < (party.receives.rfaRights || []).length; k++) {
				var r = party.receives.rfaRights[k];
				var player = playerMap[r.playerId.toString()];
				var playerName = player ? player.name : 'Unknown';
				playerAssets.push({
					type: 'rfa',
					display: playerName + ' (RFA rights)',
					notes: []
				});
			}
			
			// Picks - grouped by season
			for (var k = 0; k < (party.receives.picks || []).length; k++) {
				var pickInfo = party.receives.picks[k];
				
				var season = pickInfo.season || currentSeason;
				var round = pickInfo.round || 1;
				var originalFranchiseId = pickInfo.fromFranchiseId;
				var originalOwner = originalFranchiseId ? await getDisplayName(originalFranchiseId, tradeYear) : 'Unknown';
				
				// Look up the actual Pick document for additional info
				var pickKey = originalFranchiseId ? getPickKey(season, round, originalFranchiseId) : null;
				var pickDoc = pickKey ? pickLookup[pickKey] : null;
				
				// Get pick number if it exists (works for both 'used' and 'passed' picks)
				var pickHasNumber = pickDoc && pickDoc.pickNumber && (pickDoc.status === 'used' || pickDoc.status === 'passed');
				var pickNumber = pickHasNumber ? pickDoc.pickNumber : null;
				
				// Determine if pick number was known at trade time
				// (trade happened in same year as the draft AND pick number is set)
				var knewPickNumber = (tradeYear === season) && pickNumber;
				
				// Determine the outcome of the pick
				var outcome = null;
				if (pickDoc && pickDoc.status === 'passed') {
					outcome = 'Passed';
				} else if (pickDoc && pickDoc.status === 'used' && pickDoc._id && pickToPlayer[pickDoc._id.toString()]) {
					var becamePlayerId = pickToPlayer[pickDoc._id.toString()];
					var becamePlayerDoc = playerMap[becamePlayerId];
					outcome = becamePlayerDoc ? becamePlayerDoc.name : null;
				}
				
				// Build display string - main line only
				var display = formatRound(round) + ' round draft pick';
				
				// Show pick number inline if known at trade time
				if (knewPickNumber) {
					display += ' (#' + formatPickNumber(pickNumber) + ')';
				}
				
				display += ' from ' + originalOwner;
				display += ' in ' + season;
				
				// Build fine print notes
				var notes = [];
				
				// Build chain of all trades for this pick, plus outcome
				var history = originalFranchiseId ? (pickTradeHistory[pickKey] || []) : [];
				var allTrades = history.slice().sort(function(a, b) { return a.tradeNumber - b.tradeNumber; });
				
				// Determine if we have an outcome to show
				var hasOutcome = pickNumber || outcome;
				
				// Build outcome text if applicable (always show if we have outcome data)
				var outcomeText = '';
				if (hasOutcome) {
					if (!knewPickNumber && pickNumber) {
						outcomeText = '#' + formatPickNumber(pickNumber);
						if (outcome) outcomeText += ' ' + outcome;
					} else if (outcome) {
						outcomeText = outcome;
					}
				}
				
				// Show chain only if there's more than one trade
				if (allTrades.length > 1) {
					var chain = [];
					
					// Add all trades
					for (var t = 0; t < allTrades.length; t++) {
						var chainItem = allTrades[t];
						chain.push({
							type: 'trade',
							tradeNumber: chainItem.tradeNumber,
							isCurrent: chainItem.tradeNumber === tradeNumber
						});
					}
					
					// Add outcome at the end
					if (outcomeText) {
						chain.push({ type: 'outcome', text: outcomeText });
					}
					
					notes.push({ type: 'chain', items: chain, separator: '·' });
				} else if (outcomeText) {
					// Single trade with outcome - just show the outcome
					notes.push({ type: 'outcome', text: outcomeText });
				}
				
				if (!seasonAssets[season]) seasonAssets[season] = [];
				// Use pickNumber for sorting (lower is better), or Infinity for unknown picks
				var sortKey = pickNumber || Infinity;
				seasonAssets[season].push({ type: 'pick', display: display, notes: notes, sortOrder: 0, sortKey: sortKey });
			}
			
			// Cash - grouped by season
			for (var k = 0; k < (party.receives.cash || []).length; k++) {
				var c = party.receives.cash[k];
				var fromOwner = c.fromFranchiseId ? await getDisplayName(c.fromFranchiseId, tradeYear) : 'Unknown';
				var display = '$' + c.amount + ' from ' + fromOwner + ' in ' + c.season;
				
				if (!seasonAssets[c.season]) seasonAssets[c.season] = [];
				seasonAssets[c.season].push({ type: 'cash', display: display, notes: [], sortOrder: 1 });
			}
			
			// Build final asset list
			var allAssets = playerAssets.slice();
			
			var seasons = Object.keys(seasonAssets).map(Number).sort(function(a, b) { return a - b; });
			for (var s = 0; s < seasons.length; s++) {
				var seasonNum = seasons[s];
				var assets = seasonAssets[seasonNum];
				// Sort by type (picks before cash), then by pick number (better picks first)
				assets.sort(function(a, b) {
					if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
					return (a.sortKey || Infinity) - (b.sortKey || Infinity);
				});
				for (var a = 0; a < assets.length; a++) {
					allAssets.push(assets[a]);
				}
			}
			
			if (allAssets.length === 0) {
				allAssets.push({ type: 'nothing', display: 'Nothing', notes: [] });
			}
			
			parties.push({
				franchiseName: franchiseName,
				usePlural: usePlural,
				assets: allAssets
			});
		}
		
		tradeData.push({
			number: tradeNumber,
			timestamp: trade.timestamp || new Date(),
			notes: trade.notes,
			parties: parties
		});
	}
	
	return tradeData;
}

async function tradeHistory(request, response) {
	var config = await LeagueConfig.findById('pso');
	var currentSeason = config ? config.season : new Date().getFullYear();
	
	// Fetch all trades, oldest first (so we can number them)
	var trades = await Transaction.find({ type: 'trade' })
		.sort({ timestamp: 1 })
		.lean();
	
	var tradeData = await buildTradeDisplayData(trades, { currentSeason: currentSeason });
	
	// Reverse for display (most recent first)
	tradeData.reverse();
	
	response.render('trade-history', {
		trades: tradeData,
		totalTrades: tradeData.length
	});
}

async function singleTrade(request, response) {
	var tradeId = parseInt(request.params.id, 10);
	
	if (isNaN(tradeId)) {
		return response.status(404).send('Trade not found');
	}
	
	var config = await LeagueConfig.findById('pso');
	var currentSeason = config ? config.season : new Date().getFullYear();
	
	// We need all trades to build the chain links properly
	var allTrades = await Transaction.find({ type: 'trade' })
		.sort({ timestamp: 1 })
		.lean();
	
	// Find the specific trade
	var trade = allTrades.find(function(t) {
		return t.wordpressTradeId === tradeId;
	});
	
	if (!trade) {
		return response.status(404).send('Trade not found');
	}
	
	var tradeData = await buildTradeDisplayData(allTrades, { currentSeason: currentSeason });
	
	// Find our specific trade in the display data
	var singleTradeData = tradeData.find(function(t) {
		return t.number === tradeId;
	});
	
	response.render('trade-history', {
		trades: [singleTradeData],
		totalTrades: allTrades.length,
		singleTrade: true,
		tradeNumber: tradeId
	});
}

module.exports = {
	tradeHistory: tradeHistory,
	singleTrade: singleTrade
};
