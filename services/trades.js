var Transaction = require('../models/Transaction');
var Player = require('../models/Player');
var Pick = require('../models/Pick');
var Regime = require('../models/Regime');
var Person = require('../models/Person');
var LeagueConfig = require('../models/LeagueConfig');
var formatPick = require('../helpers/formatPick');
var { formatMoney, formatContractYears, formatContractDisplay } = require('../helpers/view');


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
// tradesToDisplay: the trades to build full display data for
// allTrades: all trades (used for building chain link indexes)
async function buildTradeDisplayData(tradesToDisplay, allTrades, options) {
	options = options || {};
	var currentSeason = options.currentSeason || new Date().getFullYear();
	
	// First pass: collect IDs we need from trades we're displaying (not all trades)
	var playerIds = new Set();
	var pickKeys = []; // { season, round, originalFranchiseId }
	
	tradesToDisplay.forEach(function(trade) {
		(trade.parties || []).forEach(function(party) {
			// Collect player IDs
			(party.receives.players || []).forEach(function(p) {
				playerIds.add(p.playerId.toString());
			});
			// Collect RFA player IDs
			(party.receives.rfaRights || []).forEach(function(r) {
				playerIds.add(r.playerId.toString());
			});
			// Collect pick keys for lookup
			(party.receives.picks || []).forEach(function(pickInfo) {
				if (pickInfo.season && pickInfo.round && pickInfo.fromFranchiseId) {
					pickKeys.push({
						season: pickInfo.season,
						round: pickInfo.round,
						originalFranchiseId: pickInfo.fromFranchiseId
					});
				}
			});
		});
	});
	
	// Build pick query conditions
	var pickConditions = pickKeys.map(function(pk) {
		return {
			season: pk.season,
			round: pk.round,
			originalFranchiseId: pk.originalFranchiseId
		};
	});
	
	// Load only what we need in parallel
	var lookupData = await Promise.all([
		playerIds.size > 0 
			? Player.find({ _id: { $in: Array.from(playerIds) } }).lean()
			: Promise.resolve([]),
		pickConditions.length > 0
			? Pick.find({ $or: pickConditions }).lean()
			: Promise.resolve([]),
		Regime.find({}).lean()
	]);
	
	var players = lookupData[0];
	var picks = lookupData[1];
	var allRegimes = lookupData[2];
	
	// Build player map
	var playerMap = {};
	players.forEach(function(p) { playerMap[p._id.toString()] = p; });
	
	// Build pick lookup
	var pickLookup = {};
	picks.forEach(function(p) {
		var key = p.season + ':' + p.round + ':' + p.originalFranchiseId.toString();
		pickLookup[key] = p;
	});
	
	// Collect pick IDs that we have, then load only those draft selections
	var pickIds = picks.map(function(p) { return p._id; });
	var draftSelections = pickIds.length > 0
		? await Transaction.find({ type: 'draft-select', pickId: { $in: pickIds } }).lean()
		: [];
	
	// Also load the players that were drafted (for "pick became X" display)
	var draftedPlayerIds = draftSelections
		.filter(function(t) { return t.playerId; })
		.map(function(t) { return t.playerId; });
	
	if (draftedPlayerIds.length > 0) {
		var draftedPlayers = await Player.find({ _id: { $in: draftedPlayerIds } }).lean();
		draftedPlayers.forEach(function(p) { playerMap[p._id.toString()] = p; });
	}
	
	// Build pickToPlayer map
	var pickToPlayer = {}; // pickId -> playerId
	draftSelections.forEach(function(t) {
		if (t.pickId && t.playerId) {
			pickToPlayer[t.pickId.toString()] = t.playerId.toString();
		}
	});
	
	// In-memory regime lookup (replaces per-trade DB queries)
	function getRegimeAtTime(franchiseId, season) {
		if (!franchiseId) return null;
		var fIdStr = franchiseId.toString();
		return allRegimes.find(function(r) {
			return r.tenures.some(function(t) {
				return t.franchiseId.toString() === fIdStr &&
					t.startSeason <= season &&
					(t.endSeason === null || t.endSeason >= season);
			});
		});
	}
	
	function getDisplayNameAtTime(franchiseId, season) {
		var regime = getRegimeAtTime(franchiseId, season);
		return regime ? regime.displayName : 'Unknown';
	}
	
	// Build pick trade history from ALL trades (for chain links)
	var pickTradeHistory = {};
	
	function getPickKey(season, round, originalFranchiseId) {
		return season + ':' + round + ':' + originalFranchiseId.toString();
	}
	
	for (var i = 0; i < allTrades.length; i++) {
		var trade = allTrades[i];
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
	
	// Build player trade history from ALL trades (for chain links)
	var playerTradeHistory = {};
	for (var i = 0; i < allTrades.length; i++) {
		var trade = allTrades[i];
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
	
	// Build display data only for tradesToDisplay
	var tradeData = [];
	
	for (var i = 0; i < tradesToDisplay.length; i++) {
		var trade = tradesToDisplay[i];
		var tradeNumber = trade.tradeId;
		var tradeYear = trade.timestamp.getFullYear();
		
		var parties = [];
		
		for (var j = 0; j < (trade.parties || []).length; j++) {
			var party = trade.parties[j];
			var franchiseName;
			var usePlural;
			if (party.regimeName) {
				franchiseName = party.regimeName;
				usePlural = franchiseName === 'Schexes' || franchiseName.includes('/');
			} else {
				var regime = getRegimeAtTime(party.franchiseId, tradeYear);
				franchiseName = regime ? regime.displayName : 'Unknown';
				usePlural = isPlural(regime);
			}
			
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
					href: player && player.slugs && player.slugs[0] ? '/players/' + player.slugs[0] : null,
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
					href: player && player.slugs && player.slugs[0] ? '/players/' + player.slugs[0] : null,
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
				var originalOwner = originalFranchiseId ? getDisplayNameAtTime(originalFranchiseId, tradeYear) : 'Unknown';
				
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
				var pickChainTrades = history.slice().sort(function(a, b) { return a.tradeNumber - b.tradeNumber; });
				
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
				if (pickChainTrades.length > 1) {
					var chain = [];
					
					// Add all trades
					for (var t = 0; t < pickChainTrades.length; t++) {
						var chainItem = pickChainTrades[t];
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
				var fromOwner = c.fromFranchiseId ? getDisplayNameAtTime(c.fromFranchiseId, tradeYear) : 'Unknown';
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
	var regimes = await Regime.find({ 'tenures.endSeason': null })
		.sort({ displayName: 1 })
		.lean();
	return regimes;
}

// Get all regimes organized for filtering
// Returns { current: [...], past: [...], all: [...] }
async function getRegimesForFilter() {
	var allRegimes = await Regime.find({})
		.sort({ displayName: 1 })
		.lean();
	
	// A regime is "current" if any tenure has endSeason: null
	var current = allRegimes.filter(function(r) {
		return r.tenures.some(function(t) { return t.endSeason === null; });
	});
	var past = allRegimes.filter(function(r) {
		return r.tenures.every(function(t) { return t.endSeason !== null; });
	});
	
	return {
		current: current,
		past: past,
		all: allRegimes
	};
}

// Get all franchises for filtering (using current regime display names)
async function getFranchisesForFilter() {
	var Franchise = require('../models/Franchise');
	var franchises = await Franchise.find({}).sort({ rosterId: 1 }).lean();
	var currentRegimes = await getCurrentRegimes();
	
	// Map franchise ID to current display name (from active tenures)
	var regimeMap = {};
	currentRegimes.forEach(function(r) {
		r.tenures.forEach(function(t) {
			if (t.endSeason === null) {
				regimeMap[t.franchiseId.toString()] = r.displayName;
			}
		});
	});
	
	return franchises.map(function(f) {
		return {
			_id: f._id,
			franchiseId: f._id,
			rosterId: f.rosterId,
			displayName: regimeMap[f._id.toString()] || ('Franchise ' + f.rosterId)
		};
	});
}

// Get all people organized for filtering
// Returns { current: [...], past: [...], regimesByPerson: { personId: [tenures...] } }
async function getPeopleForFilter() {
	// Get all people
	var people = await Person.find({}).sort({ name: 1 }).lean();
	
	// Get all regimes with populated owners
	var allRegimes = await Regime.find({})
		.populate('ownerIds', 'name')
		.lean();
	
	// Build a map of person ID -> tenures they were part of
	var regimesByPerson = {};
	allRegimes.forEach(function(regime) {
		(regime.ownerIds || []).forEach(function(owner) {
			var personId = owner._id.toString();
			if (!regimesByPerson[personId]) {
				regimesByPerson[personId] = [];
			}
			// Add all tenures for this regime
			regime.tenures.forEach(function(t) {
				regimesByPerson[personId].push({
					franchiseId: t.franchiseId,
					startSeason: t.startSeason,
					endSeason: t.endSeason
				});
			});
		});
	});
	
	// Categorize people as current (has at least one active tenure) or past
	var currentPeople = [];
	var pastPeople = [];
	
	people.forEach(function(person) {
		var personTenures = regimesByPerson[person._id.toString()] || [];
		var hasActiveTenure = personTenures.some(function(t) {
			return t.endSeason === null;
		});
		
		var personData = {
			_id: person._id,
			personId: person._id,
			name: person.name
		};
		
		if (hasActiveTenure) {
			currentPeople.push(personData);
		} else if (personTenures.length > 0) {
			pastPeople.push(personData);
		}
	});
	
	return {
		current: currentPeople,
		past: pastPeople,
		regimesByPerson: regimesByPerson
	};
}

// Check if a person was managing a party in a trade at the time of the trade
function personWasPartyAtTime(personTenures, tradeYear, partyFranchiseIds) {
	// Find tenures where this person was active at tradeYear
	var activeTenures = personTenures.filter(function(t) {
		return t.startSeason <= tradeYear && 
		       (t.endSeason === null || t.endSeason >= tradeYear);
	});
	
	// Check if any of those tenures' franchises were parties to the trade
	return activeTenures.some(function(t) {
		return partyFranchiseIds.includes(t.franchiseId.toString());
	});
}

// Check if a regime was active and was a party in a trade at the time
function regimeWasPartyAtTime(regime, tradeYear, partyFranchiseIds) {
	// Use the static helper from the model
	return Regime.wasPartyAtTime(regime, tradeYear, partyFranchiseIds);
}

async function tradeHistory(request, response) {
	var config = await LeagueConfig.findById('pso');
	var currentSeason = config ? config.season : new Date().getFullYear();
	
	// Parse query params
	// null page means "show last 2 pages merged" for a fuller default view
	var page = request.query.page ? parseInt(request.query.page, 10) : null;
	var perPage = 10;
	var isDefaultView = (page === null);
	
	// Multi-select filtering
	var filterFranchises = request.query.franchises ? request.query.franchises.split(',').filter(Boolean) : [];
	var filterPeople = request.query.people ? request.query.people.split(',').filter(Boolean) : [];
	var filterRegimes = request.query.regimes ? request.query.regimes.split(',').filter(Boolean) : [];
	var showPastPeople = request.query.showPastPeople === '1';
	var showPastRegimes = request.query.showPastRegimes === '1';
	
	// Fetch all filter data and trades in parallel
	var parallelData = await Promise.all([
		getPeopleForFilter(),
		getRegimesForFilter(),
		getFranchisesForFilter(),
		Transaction.find({ type: 'trade' }).sort({ timestamp: 1 }).lean()
	]);
	
	var peopleData = parallelData[0];
	var regimesData = parallelData[1];
	var franchisesData = parallelData[2];
	var trades = parallelData[3];
	
	// Combined filtering: apply all filters together (AND across categories)
	var filteredTrades = trades;
	
	// Filter by people (if any selected)
	if (filterPeople.length > 0) {
		filteredTrades = filteredTrades.filter(function(trade) {
			var tradeYear = trade.timestamp.getFullYear();
			var tradePartyIds = (trade.parties || []).map(function(p) { return p.franchiseId.toString(); });
			
			// Every selected person must have been managing one of the parties at trade time
			return filterPeople.every(function(personId) {
				var personRegimes = peopleData.regimesByPerson[personId] || [];
				return personWasPartyAtTime(personRegimes, tradeYear, tradePartyIds);
			});
		});
	}
	
	// Filter by regimes (if any selected) - AND with previous filter
	if (filterRegimes.length > 0) {
		filteredTrades = filteredTrades.filter(function(trade) {
			var tradeYear = trade.timestamp.getFullYear();
			var tradePartyIds = (trade.parties || []).map(function(p) { return p.franchiseId.toString(); });
			
			// Every selected regime must have been active and a party at trade time
			return filterRegimes.every(function(regimeId) {
				var regime = regimesData.all.find(function(r) { return r._id.toString() === regimeId; });
				if (!regime) return false;
				return regimeWasPartyAtTime(regime, tradeYear, tradePartyIds);
			});
		});
	}
	
	// Filter by franchises (if any selected) - AND with previous filters
	if (filterFranchises.length > 0) {
		filteredTrades = filteredTrades.filter(function(trade) {
			var tradePartyIds = (trade.parties || []).map(function(p) { return p.franchiseId.toString(); });
			return filterFranchises.every(function(fId) {
				return tradePartyIds.includes(fId);
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
	
	// Build display data only for paginated trades (pass all trades for chain links)
	var displayTrades = await buildTradeDisplayData(paginatedTrades, trades, { currentSeason: currentSeason });
	
	// Reuse current regimes from filter data (no extra DB query needed)
	var regimes = regimesData.current;
	
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
		filterFranchises: filterFranchises,
		filterPeople: filterPeople,
		filterRegimes: filterRegimes,
		currentPeople: peopleData.current,
		pastPeople: peopleData.past,
		showPastPeople: showPastPeople,
		currentRegimes: regimesData.current,
		pastRegimes: regimesData.past,
		showPastRegimes: showPastRegimes,
		franchises: franchisesData,
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
	
	// Build display data for just this trade (pass all trades for chain links)
	var tradeData = await buildTradeDisplayData([trade], allTrades, { currentSeason: currentSeason });
	var singleTradeData = tradeData[0];
	
	// Get current regimes for the filter dropdown (for consistency with main page)
	var regimes = await getCurrentRegimes();
	
	// Get franchise IDs involved in this trade for quick filtering links
	var involvedFranchises = (trade.parties || []).map(function(party) {
		var partyFId = party.franchiseId.toString();
		var regime = regimes.find(function(r) {
			return r.tenures.some(function(t) {
				return t.franchiseId.toString() === partyFId && t.endSeason === null;
			});
		});
		return {
			franchiseId: partyFId,
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
