var Transaction = require('../models/Transaction');
var Player = require('../models/Player');
var Pick = require('../models/Pick');
var Regime = require('../models/Regime');
var LeagueConfig = require('../models/LeagueConfig');
var formatPick = require('../helpers/formatPick');
var { formatMoney, formatContractYears, formatContractDisplay, ordinal } = require('../helpers/view');


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
		var tradeNumber = trade.tradeId || (i + 1);
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
		var tradeNumber = trade.tradeId || (i + 1);
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
		var tradeNumber = trade.tradeId || (i + 1);
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
				var contractStart = p.contractStart || p.startYear;
				var contractEnd = p.contractEnd || p.endYear;
				var contract = formatContractYears(contractStart, contractEnd);
				
				var display = playerName + ' (' + formatMoney(p.salary || 0) + ', ' + contract + ')';
				var contractInfo = formatContractDisplay(p.salary || 0, contractStart, contractEnd);
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
				
				playerAssets.push({ 
					type: 'player', 
					display: display,
					playerName: playerName,
					contractInfo: contractInfo,
					salary: p.salary || 0,
					notes: notes,
					ambiguous: p.ambiguous || false,
					positions: player ? player.positions : []
				});
			}
			
			// RFA rights
			for (var k = 0; k < (party.receives.rfaRights || []).length; k++) {
				var r = party.receives.rfaRights[k];
				var player = playerMap[r.playerId.toString()];
				var playerName = player ? player.name : 'Unknown';
				playerAssets.push({
					type: 'rfa',
					display: playerName + ' RFA rights',
					playerName: playerName,
					contractInfo: 'RFA rights',
					salary: 0,
					notes: [],
					positions: player ? player.positions : []
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
				
				// Build display string using shared helper
				var display = formatPick.formatPickDisplay({
					round: round,
					pickNumber: knewPickNumber ? pickNumber : null,
					season: season,
					origin: originalOwner
				});
				
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
				
				// Build the "main" part (the actual pick) for bold display
				var pickMain;
				if (knewPickNumber && pickNumber) {
					var teamsPerRound = (season <= 2011) ? 10 : 12;
					pickMain = 'Pick ' + formatPick.formatPickNumber(pickNumber, teamsPerRound);
				} else {
					pickMain = formatPick.formatRound(round) + ' round pick';
				}
				var pickContext = 'in ' + season + ' (' + originalOwner + ')';
				
				if (!seasonAssets[season]) seasonAssets[season] = [];
				// Use pickNumber for sorting (lower is better), or Infinity for unknown picks
				var sortKey = pickNumber || Infinity;
				seasonAssets[season].push({ 
					type: 'pick', 
					display: display, 
					pickMain: pickMain,
					pickContext: pickContext,
					round: round,
					season: season,
					pickNumber: knewPickNumber ? pickNumber : null,
					notes: notes, 
					sortOrder: 0, 
					sortKey: sortKey 
				});
			}
			
			// Cash - grouped by season
			for (var k = 0; k < (party.receives.cash || []).length; k++) {
				var c = party.receives.cash[k];
				var fromOwner = c.fromFranchiseId ? await getDisplayName(c.fromFranchiseId, tradeYear) : 'Unknown';
				var display = formatMoney(c.amount) + ' from ' + fromOwner + ' in ' + c.season;
				var cashMain = formatMoney(c.amount);
				var cashContext = 'from ' + fromOwner + ' in ' + c.season;
				
				if (!seasonAssets[c.season]) seasonAssets[c.season] = [];
				seasonAssets[c.season].push({ 
					type: 'cash', 
					display: display, 
					cashMain: cashMain,
					cashContext: cashContext,
					amount: c.amount,
					season: c.season,
					notes: [], 
					sortOrder: 1 
				});
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
			
			// Collect names of players with ambiguous contracts
			var ambiguousPlayers = allAssets
				.filter(function(a) { return a.ambiguous; })
				.map(function(a) { 
					// Extract player name from display string (format: "Name ($X, YY/YY)")
					var match = a.display.match(/^([^(]+)/);
					return match ? match[1].trim() : a.display;
				});
			
			parties.push({
				franchiseName: franchiseName,
				usePlural: usePlural,
				assets: allAssets,
				ambiguousPlayers: ambiguousPlayers
			});
		}
		
		// Sort parties alphabetically by franchise name
		parties.sort(function(a, b) {
			return a.franchiseName.localeCompare(b.franchiseName);
		});
		
		// Collect all ambiguous player names across parties
		var ambiguousPlayers = [];
		parties.forEach(function(p) {
			ambiguousPlayers = ambiguousPlayers.concat(p.ambiguousPlayers || []);
		});
		
		// Compute auction season for OG title
		// Before Sept 1 = auction season is that year, after Sept 1 = next year
		var tradeDate = trade.timestamp || new Date();
		var auctionSeason = tradeDate.getMonth() >= 8 ? tradeYear + 1 : tradeYear;
		
		tradeData.push({
			number: tradeNumber,
			timestamp: tradeDate,
			tradeYear: tradeYear,
			auctionSeason: auctionSeason,
			notes: trade.notes,
			parties: parties,
			ambiguousPlayers: ambiguousPlayers
		});
	}
	
	return tradeData;
}

// Get all current regimes for filter dropdown
async function getCurrentRegimes() {
	var regimes = await Regime.find({ endSeason: null })
		.sort({ displayName: 1 })
		.lean();
	return regimes;
}

async function tradeHistory(request, response) {
	var config = await LeagueConfig.findById('pso');
	var currentSeason = config ? config.season : new Date().getFullYear();
	
	// Parse query params
	// null page means "show last 2 pages merged" for a fuller default view
	var page = request.query.page ? parseInt(request.query.page, 10) : null;
	var perPage = request.query.per === 'all' ? null : (parseInt(request.query.per, 10) || 10);
	var isDefaultView = (page === null);
	var filterFranchise = request.query.franchise || null;
	var filterPartner = request.query.partner || null;
	
	// Fetch all trades, oldest first (so we can number them)
	var trades = await Transaction.find({ type: 'trade' })
		.sort({ timestamp: 1 })
		.lean();
	
	// Filter by franchise if specified
	var filteredTrades = trades;
	if (filterFranchise) {
		filteredTrades = filteredTrades.filter(function(trade) {
			return (trade.parties || []).some(function(party) {
				return party.franchiseId.toString() === filterFranchise;
			});
		});
	}
	
	// Further filter by trading partner if specified
	if (filterPartner && filterFranchise) {
		filteredTrades = filteredTrades.filter(function(trade) {
			var franchiseIds = (trade.parties || []).map(function(p) { return p.franchiseId.toString(); });
			return franchiseIds.includes(filterFranchise) && franchiseIds.includes(filterPartner);
		});
	} else if (filterPartner && !filterFranchise) {
		// If only partner is specified, filter to trades involving that franchise
		filteredTrades = filteredTrades.filter(function(trade) {
			return (trade.parties || []).some(function(party) {
				return party.franchiseId.toString() === filterPartner;
			});
		});
	}
	
	var totalFiltered = filteredTrades.length;
	
	// Stable pagination: page 1 = oldest trades
	var totalPages = perPage ? Math.ceil(totalFiltered / perPage) : 1;
	
	// Default view shows last 2 pages merged (ensures at least 11 trades if available)
	var paginatedTrades;
	var displayPage; // for UI display
	if (isDefaultView && perPage) {
		// Show last 2 pages (not last 20 trades - the difference matters for partial pages)
		var startPage = Math.max(1, totalPages - 1); // second-to-last page
		var startIdx = (startPage - 1) * perPage;
		paginatedTrades = filteredTrades.slice(startIdx);
		displayPage = null; // indicates "latest" view
		page = totalPages; // for nav purposes
	} else {
		if (page === null) page = totalPages || 1;
		page = Math.max(1, Math.min(page, totalPages || 1));
		paginatedTrades = perPage 
			? filteredTrades.slice((page - 1) * perPage, page * perPage)
			: filteredTrades;
		displayPage = page;
	}
	
	// Reverse for display (newest first on page)
	paginatedTrades = paginatedTrades.slice().reverse();
	
	// Build display data for paginated trades (but pass all trades for chain links)
	var tradeData = await buildTradeDisplayData(trades, { currentSeason: currentSeason });
	
	// Create a map for quick lookup
	var tradeDataMap = {};
	tradeData.forEach(function(t) { tradeDataMap[t.number] = t; });
	
	// Get only the trades we want to display
	var displayTrades = paginatedTrades.map(function(t) {
		return tradeDataMap[t.tradeId];
	}).filter(Boolean);
	
	// Get current regimes for filter dropdown
	var regimes = await getCurrentRegimes();
	
	// Build filter display names
	var filterFranchiseName = null;
	var filterPartnerName = null;
	if (filterFranchise) {
		var regime = regimes.find(function(r) { return r.franchiseId.toString() === filterFranchise; });
		filterFranchiseName = regime ? regime.displayName : 'Unknown';
	}
	if (filterPartner) {
		var regime = regimes.find(function(r) { return r.franchiseId.toString() === filterPartner; });
		filterPartnerName = regime ? regime.displayName : 'Unknown';
	}
	
	// Build query string helper for pagination links
	var buildQuery = function(newPage, newPer) {
		var params = [];
		if (newPage) params.push('page=' + newPage);
		if (newPer && newPer !== 10) params.push('per=' + newPer);
		if (filterFranchise) params.push('franchise=' + filterFranchise);
		if (filterPartner) params.push('partner=' + filterPartner);
		return params.length ? '?' + params.join('&') : '';
	};
	
	// Calculate "older" page for default view (go to page before the 2 we're showing)
	var olderPage = isDefaultView ? (totalPages > 2 ? totalPages - 2 : null) : (page > 1 ? page - 1 : null);
	var newerPage = (!isDefaultView && page < totalPages) ? page + 1 : null;
	
	response.render('trade-history', {
		trades: displayTrades,
		totalTrades: trades.length,
		totalFiltered: totalFiltered,
		page: displayPage,
		perPage: perPage,
		totalPages: totalPages,
		isDefaultView: isDefaultView,
		olderPage: olderPage,
		newerPage: newerPage,
		regimes: regimes,
		filterFranchise: filterFranchise,
		filterFranchiseName: filterFranchiseName,
		filterPartner: filterPartner,
		filterPartnerName: filterPartnerName,
		buildQuery: buildQuery,
		activePage: 'trades'
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
	
	// Find the specific trade and its neighbors
	var tradeIndex = allTrades.findIndex(function(t) {
		return t.tradeId === tradeId;
	});
	
	if (tradeIndex === -1) {
		return response.status(404).send('Trade not found');
	}
	
	var trade = allTrades[tradeIndex];
	
	// Get prev/next trade IDs
	var prevTradeId = tradeIndex > 0 ? allTrades[tradeIndex - 1].tradeId : null;
	var nextTradeId = tradeIndex < allTrades.length - 1 ? allTrades[tradeIndex + 1].tradeId : null;
	
	var tradeData = await buildTradeDisplayData(allTrades, { currentSeason: currentSeason });
	
	// Find our specific trade in the display data
	var singleTradeData = tradeData.find(function(t) {
		return t.number === tradeId;
	});
	
	// Get current regimes for the filter dropdown (for consistency with main page)
	var regimes = await getCurrentRegimes();
	
	// Get franchise IDs involved in this trade for quick filtering links
	var involvedFranchises = (trade.parties || []).map(function(party) {
		var regime = regimes.find(function(r) { return r.franchiseId.toString() === party.franchiseId.toString(); });
		return {
			franchiseId: party.franchiseId.toString(),
			displayName: regime ? regime.displayName : 'Unknown'
		};
	});
	
	response.render('trade-history', {
		trades: [singleTradeData],
		totalTrades: allTrades.length,
		singleTrade: true,
		tradeNumber: tradeId,
		prevTradeId: prevTradeId,
		nextTradeId: nextTradeId,
		involvedFranchises: involvedFranchises,
		regimes: regimes,
		activePage: 'trades'
	});
}

module.exports = {
	tradeHistory: tradeHistory,
	singleTrade: singleTrade
};
