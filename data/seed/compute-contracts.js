/**
 * Compute current Contract state from JSON data files.
 * 
 * Strategy:
 * 1. Load all contracts from contracts.json where endYear >= currentSeason
 * 2. Replay ALL trades to track ownership changes
 * 3. Replay ALL FA drops to remove cut players
 * 4. Write final state to Contract collection
 * 
 * This gives us the current roster state without needing to replay
 * the entire transaction history - we only care about contracts
 * that are still active.
 * 
 * Usage:
 *   docker compose run --rm web node data/seed/compute-contracts.js
 *   docker compose run --rm web node data/seed/compute-contracts.js --dry-run
 */

require('dotenv').config({ path: __dirname + '/../../.env' });

var mongoose = require('mongoose');
var fs = require('fs');
var path = require('path');

var Contract = require('../../models/Contract');
var Franchise = require('../../models/Franchise');
var Player = require('../../models/Player');
var LeagueConfig = require('../../models/LeagueConfig');
var PSO = require('../../config/pso');

mongoose.connect(process.env.MONGODB_URI);

var CONTRACTS_FILE = path.join(__dirname, '../contracts/contracts.json');
var TRADES_FILE = path.join(__dirname, '../trades/trades.json');
var FA_FILE = path.join(__dirname, '../fa/fa.json');
var RFA_FILE = path.join(__dirname, '../rfa/rfa.json');

var args = {
	dryRun: process.argv.includes('--dry-run')
};

async function run() {
	console.log('Computing current Contract state...');
	if (args.dryRun) console.log('[DRY RUN]\n');
	
	// Use LeagueConfig season if available, otherwise fall back to PSO.season
	var config = await LeagueConfig.findById('pso').lean();
	var currentSeason = config ? config.season : PSO.season;
	console.log('Current season:', currentSeason, config ? '(from LeagueConfig)' : '(from PSO.season)');
	console.log('');
	
	// Load franchises
	var franchises = await Franchise.find({}).lean();
	var franchiseByRosterId = {};
	franchises.forEach(function(f) {
		franchiseByRosterId[f.rosterId] = f;
	});
	console.log('Loaded', franchises.length, 'franchises');
	
	// Load players
	var players = await Player.find({}).lean();
	var playersBySleeperId = {};
	var playersByName = {};
	players.forEach(function(p) {
		if (p.sleeperId) {
			playersBySleeperId[p.sleeperId] = p;
		}
		// For historical players, use name with |historical suffix
		var key = p.sleeperId ? p.name.toLowerCase() : p.name.toLowerCase() + '|historical';
		playersByName[key] = p;
	});
	console.log('Loaded', players.length, 'players');
	
	// Load contracts.json - filter to active contracts
	var allContracts = JSON.parse(fs.readFileSync(CONTRACTS_FILE, 'utf8'));
	var activeContracts = allContracts.filter(function(c) {
		return c.endYear >= currentSeason;
	});
	console.log('Loaded', allContracts.length, 'total contracts,', activeContracts.length, 'active for', currentSeason);
	
	// Build initial contract state from contracts.json
	// Key: playerId, Value: { franchiseId, salary, startYear, endYear }
	var contractState = {};
	var playerNameToId = {}; // For matching trades/drops by name
	var unmatchedContracts = [];
	
	for (var i = 0; i < activeContracts.length; i++) {
		var c = activeContracts[i];
		
		// Find the player
		var player = null;
		if (c.sleeperId) {
			player = playersBySleeperId[c.sleeperId];
		}
		if (!player && c.name) {
			var isHistorical = !c.sleeperId;
			var key = isHistorical ? c.name.toLowerCase() + '|historical' : c.name.toLowerCase();
			player = playersByName[key];
		}
		
		if (!player) {
			unmatchedContracts.push(c.name + ' (' + c.season + ')');
			continue;
		}
		
		// Find the franchise
		var franchise = franchiseByRosterId[c.rosterId];
		if (!franchise) {
			unmatchedContracts.push(c.name + ': unknown franchise ' + c.rosterId);
			continue;
		}
		
		// Store the contract (use most recent if player appears multiple times)
		var playerId = player._id.toString();
		if (!contractState[playerId] || c.season > contractState[playerId].season) {
			contractState[playerId] = {
				playerId: player._id,
				playerName: player.name,
				franchiseId: franchise._id,
				rosterId: c.rosterId,
				salary: c.salary,
				startYear: c.startYear,
				endYear: c.endYear,
				season: c.season
			};
		}
		
		// Build name lookup for trade/drop matching
		playerNameToId[c.name.toLowerCase()] = playerId;
		if (c.sleeperId) {
			playerNameToId[c.sleeperId] = playerId;
		}
	}
	
	console.log('Built initial state with', Object.keys(contractState).length, 'contracts');
	if (unmatchedContracts.length > 0) {
		console.log('  Unmatched:', unmatchedContracts.length);
	}
	console.log('');
	
	// =====================================================
	// Build unified event timeline: trades + FA transactions
	// Process chronologically to handle drop → pickup cycles
	// =====================================================
	
	var trades = JSON.parse(fs.readFileSync(TRADES_FILE, 'utf8'));
	var faTransactions = JSON.parse(fs.readFileSync(FA_FILE, 'utf8'));
	
	// Build timeline of events
	var events = [];
	
	trades.forEach(function(trade) {
		events.push({
			type: 'trade',
			timestamp: new Date(trade.date),
			data: trade
		});
	});
	
	faTransactions.forEach(function(fa) {
		events.push({
			type: 'fa',
			timestamp: new Date(fa.timestamp),
			data: fa
		});
	});
	
	// Sort chronologically
	events.sort(function(a, b) {
		return a.timestamp - b.timestamp;
	});
	
	console.log('Built timeline:', trades.length, 'trades +', faTransactions.length, 'FA transactions =', events.length, 'events');
	
	var tradesApplied = 0;
	var playersTraded = 0;
	var playersDropped = 0;
	var playersAdded = 0;
	var eventsIgnored = 0;
	
	for (var i = 0; i < events.length; i++) {
		var event = events[i];
		
		if (event.type === 'trade') {
			var trade = event.data;
			var tradeDate = event.timestamp;
			var tradeApplied = false;
			
			for (var j = 0; j < trade.parties.length; j++) {
				var party = trade.parties[j];
				var newFranchise = franchiseByRosterId[party.rosterId];
				if (!newFranchise) continue;
				
				// Process players this party receives
				for (var k = 0; k < (party.players || []).length; k++) {
					var tradedPlayer = party.players[k];
					
					// Find the player in our contract state
					var playerId = null;
					if (tradedPlayer.sleeperId) {
						playerId = playerNameToId[tradedPlayer.sleeperId];
					}
					if (!playerId && tradedPlayer.name) {
						playerId = playerNameToId[tradedPlayer.name.toLowerCase()];
					}
					
					if (playerId && contractState[playerId]) {
						// Only apply trade if it happened AFTER the contract was signed
						var contractSeason = contractState[playerId].season;
						var contractSignedDate = new Date(contractSeason + '-08-01');
						
						if (tradeDate >= contractSignedDate) {
							// Update ownership
							contractState[playerId].franchiseId = newFranchise._id;
							contractState[playerId].rosterId = party.rosterId;
							playersTraded++;
							tradeApplied = true;
						} else {
							eventsIgnored++;
						}
					}
				}
			}
			
			if (tradeApplied) tradesApplied++;
		}
		else if (event.type === 'fa') {
			var fa = event.data;
			var faTimestamp = event.timestamp;
			var faRosterId = fa.rosterId;
			var faFranchise = franchiseByRosterId[faRosterId];
			
			// Process drops first (within same transaction, drops happen before adds)
			for (var j = 0; j < (fa.drops || []).length; j++) {
				var drop = fa.drops[j];
				
				var playerId = playerNameToId[drop.name.toLowerCase()];
				
				if (playerId && contractState[playerId]) {
					// Only apply drop if it happened AFTER the contract was signed
					var contractSeason = contractState[playerId].season;
					var contractSignedDate = new Date(contractSeason + '-08-01');
					
					if (faTimestamp >= contractSignedDate) {
						delete contractState[playerId];
						playersDropped++;
					} else {
						eventsIgnored++;
					}
				}
			}
			
			// Process adds - these create new contracts (FA pickups)
			for (var j = 0; j < (fa.adds || []).length; j++) {
				var add = fa.adds[j];
				
				// Skip adds that don't have endYear >= currentSeason
				if (add.endYear < currentSeason) continue;
				
				// Find the player
				var player = null;
				if (add.sleeperId) {
					player = playersBySleeperId[add.sleeperId];
				}
				if (!player && add.name) {
					var isHistorical = !add.sleeperId;
					var key = isHistorical ? add.name.toLowerCase() + '|historical' : add.name.toLowerCase();
					player = playersByName[key];
				}
				
				if (!player || !faFranchise) continue;
				
				var playerId = player._id.toString();
				
				// Create new contract entry for this FA pickup
				// Use the season from fa.season or derive from endYear
				var faSeason = fa.season || add.endYear;
				
				contractState[playerId] = {
					playerId: player._id,
					playerName: player.name,
					franchiseId: faFranchise._id,
					rosterId: faRosterId,
					salary: add.salary,
					startYear: add.startYear,  // null for FA pickups
					endYear: add.endYear,
					season: faSeason
				};
				
				// Update name lookup
				playerNameToId[add.name.toLowerCase()] = playerId;
				if (add.sleeperId) {
					playerNameToId[add.sleeperId] = playerId;
				}
				
				playersAdded++;
			}
		}
	}
	
	console.log('Applied', tradesApplied, 'trades affecting', playersTraded, 'player ownership changes');
	console.log('Processed FA:', playersDropped, 'drops,', playersAdded, 'adds (ignored', eventsIgnored, 'historical)');
	console.log('');
	
	// =====================================================
	// Compute RFA Rights
	// =====================================================
	// RFA rights come from rfa-rights-conversion entries.
	// RFA rights only last ONE year - if not exercised, they lapse.
	// So we only care about conversions from the PREVIOUS season.
	// e.g., for 2025, we want conversions from contracts that ended in 2024.
	
	var previousSeason = currentSeason - 1;
	
	var rfaData = JSON.parse(fs.readFileSync(RFA_FILE, 'utf8'));
	var rfaConversions = rfaData.filter(function(r) {
		return r.type === 'rfa-rights-conversion' && r.season === previousSeason;
	});
	// Sort by timestamp so most recent wins
	rfaConversions.sort(function(a, b) {
		return new Date(a.timestamp) - new Date(b.timestamp);
	});
	console.log('Loaded', rfaConversions.length, 'RFA conversions from', previousSeason);
	
	// Build RFA state - key: playerId, value: { franchiseId, rosterId, season }
	var rfaState = {};
	var rfaNameToId = {};
	
	for (var i = 0; i < rfaConversions.length; i++) {
		var rfa = rfaConversions[i];
		
		// Find the player
		var player = null;
		if (rfa.sleeperId) {
			player = playersBySleeperId[rfa.sleeperId];
		}
		if (!player && rfa.playerName) {
			var isHistorical = !rfa.sleeperId;
			var key = isHistorical ? rfa.playerName.toLowerCase() + '|historical' : rfa.playerName.toLowerCase();
			player = playersByName[key];
		}
		
		if (!player) continue;
		
		var franchise = franchiseByRosterId[rfa.rosterId];
		if (!franchise) continue;
		
		var playerId = player._id.toString();
		
		// Store/update RFA rights (most recent wins)
		rfaState[playerId] = {
			playerId: player._id,
			playerName: player.name,
			franchiseId: franchise._id,
			rosterId: rfa.rosterId,
			season: rfa.season
		};
		
		rfaNameToId[rfa.playerName.toLowerCase()] = playerId;
		if (rfa.sleeperId) {
			rfaNameToId[rfa.sleeperId] = playerId;
		}
	}
	
	console.log('Built initial RFA state with', Object.keys(rfaState).length, 'players');
	
	// Replay trades for RFA rights
	var rfaTrades = 0;
	for (var i = 0; i < trades.length; i++) {
		var trade = trades[i];
		var tradeDate = new Date(trade.date);
		
		for (var j = 0; j < trade.parties.length; j++) {
			var party = trade.parties[j];
			var newFranchise = franchiseByRosterId[party.rosterId];
			if (!newFranchise) continue;
			
			// Process RFA rights this party receives
			for (var k = 0; k < (party.rfaRights || []).length; k++) {
				var rfaRight = party.rfaRights[k];
				
				var playerId = null;
				if (rfaRight.sleeperId) {
					playerId = rfaNameToId[rfaRight.sleeperId];
				}
				if (!playerId && rfaRight.name) {
					playerId = rfaNameToId[rfaRight.name.toLowerCase()];
				}
				
				if (playerId && rfaState[playerId]) {
					// Only apply if trade is after the RFA conversion
					var rfaSeason = rfaState[playerId].season;
					// RFA conversions happen in January after the season
					var rfaDate = new Date((rfaSeason + 1) + '-01-15');
					
					if (tradeDate >= rfaDate) {
						rfaState[playerId].franchiseId = newFranchise._id;
						rfaState[playerId].rosterId = party.rosterId;
						rfaTrades++;
					}
				}
			}
		}
	}
	
	console.log('Applied', rfaTrades, 'RFA ownership changes from trades');
	
	// Remove RFA rights for players who now have a signed contract
	var rfaSignedCount = 0;
	Object.keys(rfaState).forEach(function(playerId) {
		if (contractState[playerId]) {
			delete rfaState[playerId];
			rfaSignedCount++;
		}
	});
	console.log('Removed', rfaSignedCount, 'RFAs who signed contracts');
	
	// Remove RFA rights that were dropped (check FA for RFA drops - no contract info)
	// These would be drops where the player has no salary/contract
	var rfaDropped = 0;
	for (var i = 0; i < faTransactions.length; i++) {
		var fa = faTransactions[i];
		
		for (var j = 0; j < (fa.drops || []).length; j++) {
			var drop = fa.drops[j];
			
			// RFA drops typically have null startYear or are explicitly RFA
			// Check if this is a player in our RFA state
			var playerId = rfaNameToId[drop.name.toLowerCase()];
			
			if (playerId && rfaState[playerId]) {
				// Check if the drop is after the RFA conversion
				var rfaSeason = rfaState[playerId].season;
				var rfaDate = new Date((rfaSeason + 1) + '-01-15');
				var dropDate = new Date(fa.timestamp);
				
				if (dropDate >= rfaDate) {
					delete rfaState[playerId];
					rfaDropped++;
				}
			}
		}
	}
	console.log('Removed', rfaDropped, 'dropped RFA rights');
	
	var finalRfas = Object.values(rfaState);
	console.log('Final RFA count:', finalRfas.length);
	console.log('');
	
	// Final state
	var finalContracts = Object.values(contractState);
	console.log('Final contract count:', finalContracts.length);
	
	// Group by franchise for summary
	var byFranchise = {};
	finalContracts.forEach(function(c) {
		var rid = c.rosterId;
		if (!byFranchise[rid]) byFranchise[rid] = { contracts: 0, rfas: 0 };
		byFranchise[rid].contracts++;
	});
	finalRfas.forEach(function(r) {
		var rid = r.rosterId;
		if (!byFranchise[rid]) byFranchise[rid] = { contracts: 0, rfas: 0 };
		byFranchise[rid].rfas++;
	});
	
	console.log('Roster sizes (contracts + RFAs):');
	Object.keys(byFranchise).sort(function(a, b) { return a - b; }).forEach(function(rid) {
		var franchise = franchiseByRosterId[rid];
		var counts = byFranchise[rid];
		console.log('  ' + (franchise ? PSO.franchises[rid] : 'Unknown') + ': ' + counts.contracts + ' + ' + counts.rfas + ' RFAs');
	});
	
	// Write to database
	var totalToWrite = finalContracts.length + finalRfas.length;
	
	if (!args.dryRun) {
		console.log('\nClearing existing contracts...');
		var deleteResult = await Contract.deleteMany({});
		console.log('  Deleted', deleteResult.deletedCount, 'contracts');
		
		console.log('Writing', finalContracts.length, 'contracts...');
		for (var i = 0; i < finalContracts.length; i++) {
			var c = finalContracts[i];
			await Contract.create({
				playerId: c.playerId,
				franchiseId: c.franchiseId,
				salary: c.salary,
				startYear: c.startYear,
				endYear: c.endYear
			});
		}
		
		console.log('Writing', finalRfas.length, 'RFA rights...');
		for (var i = 0; i < finalRfas.length; i++) {
			var r = finalRfas[i];
			await Contract.create({
				playerId: r.playerId,
				franchiseId: r.franchiseId,
				salary: null,  // RFA rights have null salary
				startYear: null,
				endYear: null
			});
		}
		console.log('Done! Total:', totalToWrite);
	} else {
		console.log('\n[DRY RUN] Would write', finalContracts.length, 'contracts +', finalRfas.length, 'RFAs =', totalToWrite, 'total');
	}
	
	process.exit(0);
}

run().catch(function(err) {
	console.error('Error:', err);
	process.exit(1);
});
