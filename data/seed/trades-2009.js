/**
 * Seed 2009 trade transactions.
 * 
 * Supports period filtering:
 *   --period=offseason  Trade 7 (July 29, before auction)
 *   --period=auction    Trades 8-9 (Aug 23, Aug 31 - before contracts)
 *   --period=inseason   Trades 10-16 (Oct-Dec, after contracts)
 * 
 * Usage:
 *   docker compose run --rm -it web node data/seed/trades-2009.js --period=offseason
 *   docker compose run --rm -it web node data/seed/trades-2009.js --period=auction
 *   docker compose run --rm -it web node data/seed/trades-2009.js --period=inseason
 *   docker compose run --rm -it web node data/seed/trades-2009.js --dry-run --period=all
 */

var dotenv = require('dotenv').config({ path: __dirname + '/../../.env' });
var mongoose = require('mongoose');
var fs = require('fs');
var path = require('path');
var readline = require('readline');

var Franchise = require('../../models/Franchise');
var Player = require('../../models/Player');
var Regime = require('../../models/Regime');
var Transaction = require('../../models/Transaction');
var resolver = require('../utils/player-resolver');

mongoose.connect(process.env.MONGODB_URI);

var TRADES_PATH = path.join(__dirname, '../trades/trades.json');

// 2009 dates from summer-meetings.txt
var AUCTION_DATE = new Date('2009-08-16');
var CONTRACT_DUE_DATE = new Date('2009-09-02');

// Global state
var rl = null;
var playersByNormalizedName = {};
var playersByEspnId = {};
var positionByEspnId = {};
var franchiseByOwnerName = {};
var franchiseIdByOwnerName = {};
var dryRun = false;
var period = 'all';

/**
 * Load 2009 trades from trades.json, filtered by period.
 */
function loadTrades() {
	var content = fs.readFileSync(TRADES_PATH, 'utf8');
	var allTrades = JSON.parse(content);
	
	return allTrades.filter(function(t) {
		if (!t.date || !t.date.startsWith('2009')) return false;
		
		var tradeDate = new Date(t.date);
		
		if (period === 'offseason') {
			// Before auction
			return tradeDate < AUCTION_DATE;
		} else if (period === 'auction') {
			// Between auction and contract due date
			return tradeDate >= AUCTION_DATE && tradeDate < CONTRACT_DUE_DATE;
		} else if (period === 'inseason') {
			// After contract due date
			return tradeDate >= CONTRACT_DUE_DATE;
		}
		
		// period === 'all'
		return true;
	});
}

/**
 * Look up a player's current contract from existing transactions.
 * This is the chronological state - what we've already tracked.
 * 
 * Returns { salary, startYear, endYear } or null if not found.
 */
async function getPlayerContractState(playerId, beforeDate) {
	// Find the most recent transaction that established this player's contract
	// This could be: auction-ufa, contract, fa (pickup), rfa-conversion, draft-select
	
	var contractTxn = await Transaction.findOne({
		playerId: playerId,
		type: { $in: ['auction-ufa', 'contract', 'rfa-conversion', 'draft-select'] },
		timestamp: { $lt: beforeDate }
	}).sort({ timestamp: -1 });
	
	if (contractTxn) {
		return {
			salary: contractTxn.salary,
			startYear: contractTxn.startYear,
			endYear: contractTxn.endYear,
			source: contractTxn.type
		};
	}
	
	// Check FA pickups (contract info is in the adds array)
	var faTxn = await Transaction.findOne({
		type: 'fa',
		'adds.playerId': playerId,
		timestamp: { $lt: beforeDate }
	}).sort({ timestamp: -1 });
	
	if (faTxn) {
		var add = faTxn.adds.find(function(a) {
			return a.playerId && a.playerId.toString() === playerId.toString();
		});
		if (add) {
			return {
				salary: add.salary,
				startYear: add.startYear,
				endYear: add.endYear,
				source: 'fa'
			};
		}
	}
	
	return null;
}

/**
 * Resolve a player from trade data.
 * Uses espnId first, then falls back to name resolution.
 */
async function resolvePlayer(playerData, context) {
	// Try ESPN ID first
	if (playerData.espnId && playersByEspnId[playerData.espnId]) {
		return playersByEspnId[playerData.espnId];
	}
	
	var normalizedName = resolver.normalizePlayerName(playerData.name);
	var candidates = playersByNormalizedName[normalizedName] || [];
	
	// Check cache
	var cached = resolver.lookup(playerData.name, context);
	if (cached && cached.sleeperId) {
		var player = await Player.findOne({ sleeperId: cached.sleeperId });
		if (player) return player;
	}
	if (cached && cached.name) {
		var player = await Player.findOne({ name: cached.name, sleeperId: null });
		if (player) return player;
	}
	
	// Single non-ambiguous match
	if (candidates.length === 1 && !resolver.isAmbiguous(normalizedName)) {
		return candidates[0];
	}
	
	// No candidates - create historical player
	if (candidates.length === 0) {
		// Look up position from snapshot if we have ESPN ID
		var position = playerData.espnId ? positionByEspnId[playerData.espnId] : null;
		var positions = position ? [position] : [];
		
		console.log('  Creating historical player: ' + playerData.name + (position ? ' (' + position + ')' : ''));
		
		if (dryRun) {
			return { _id: 'dry-run-id', name: playerData.name, positions: positions };
		}
		
		var player = await Player.create({
			name: playerData.name,
			positions: positions,
			sleeperId: null
		});
		
		if (!playersByNormalizedName[normalizedName]) {
			playersByNormalizedName[normalizedName] = [];
		}
		playersByNormalizedName[normalizedName].push(player);
		
		resolver.addResolution(playerData.name, null, playerData.name, context);
		return player;
	}
	
	// Multiple candidates - prompt
	var result = await resolver.promptForPlayer({
		name: playerData.name,
		context: context,
		candidates: candidates,
		Player: Player,
		rl: rl,
		playerCache: playersByNormalizedName,
		autoHistorical: true
	});
	
	if (result.action === 'quit') {
		throw new Error('User quit');
	}
	
	return result.player;
}

/**
 * Build the Transaction parties array from trade data.
 */
async function buildParties(trade) {
	var parties = [];
	
	for (var i = 0; i < trade.parties.length; i++) {
		var partyData = trade.parties[i];
		var franchiseId = franchiseIdByOwnerName[partyData.owner];
		
		if (!franchiseId) {
			throw new Error('Unknown owner in trade ' + trade.tradeId + ': ' + partyData.owner);
		}
		
		var party = {
			franchiseId: franchiseId,
			receives: {
				players: [],
				picks: [],
				cash: [],
				rfaRights: []
			}
		};
		
		// Process players
		for (var j = 0; j < partyData.players.length; j++) {
			var playerData = partyData.players[j];
			var context = {
				year: 2009,
				type: 'trade',
				tradeId: trade.tradeId,
				franchise: partyData.owner
			};
			
			var player = await resolvePlayer(playerData, context);
			var tradeDate = new Date(trade.date);
			
			// Look up player's contract from chronological state (source of truth)
			var trackedContract = await getPlayerContractState(player._id, tradeDate);
			
			// Get pre-computed contract from trades.json (for validation)
			var expectedContract = playerData.contract || {};
			
			// Determine contract info to use
			var salary, startYear, endYear;
			
			if (trackedContract) {
				// Use tracked state as source of truth
				salary = trackedContract.salary;
				startYear = trackedContract.startYear;
				endYear = trackedContract.endYear;
				
				// Validate against expected contract from trades.json
				var mismatch = false;
				
				// Compare start years (null === null is a match for FA contracts)
				if (expectedContract.start !== startYear) {
					mismatch = true;
				}
				if (expectedContract.end !== undefined && expectedContract.end !== endYear) {
					mismatch = true;
				}
				if (playerData.salary !== undefined && playerData.salary !== salary) {
					mismatch = true;
				}
				
				if (mismatch) {
					console.log('  WARNING: Contract mismatch for ' + playerData.name);
					console.log('    Tracked state: $' + salary + ' (' + startYear + '/' + endYear + ') from ' + trackedContract.source);
					console.log('    trades.json:   $' + playerData.salary + ' (' + expectedContract.start + '/' + expectedContract.end + ')');
				}
			} else {
				// No tracked state - use trades.json as fallback (e.g., Trade 1 before auction)
				salary = playerData.salary;
				startYear = expectedContract.start;
				endYear = expectedContract.end;
				
				if (trade.tradeId > 1) {
					// After Trade 1, we should have tracked state
					console.log('  WARNING: No tracked contract for ' + playerData.name + ' - using trades.json');
				}
			}
			
			party.receives.players.push({
				playerId: player._id,
				salary: salary,
				startYear: startYear,
				endYear: endYear,
				rfaRights: false
			});
		}
		
		// Process picks
		for (var j = 0; j < partyData.picks.length; j++) {
			var pickData = partyData.picks[j];
			var fromFranchiseId = franchiseIdByOwnerName[pickData.fromOwner];
			
			if (!fromFranchiseId) {
				console.log('  Warning: Unknown fromOwner for pick in trade ' + trade.tradeId + ': ' + pickData.fromOwner);
				continue;
			}
			
			party.receives.picks.push({
				round: pickData.round,
				season: pickData.season,
				fromFranchiseId: fromFranchiseId
			});
		}
		
		// Process cash
		for (var j = 0; j < partyData.cash.length; j++) {
			var cashData = partyData.cash[j];
			var fromFranchiseId = franchiseIdByOwnerName[cashData.fromOwner];
			
			if (!fromFranchiseId) {
				console.log('  Warning: Unknown fromOwner for cash in trade ' + trade.tradeId + ': ' + cashData.fromOwner);
				continue;
			}
			
			party.receives.cash.push({
				amount: cashData.amount,
				season: cashData.season,
				fromFranchiseId: fromFranchiseId
			});
		}
		
		// Process RFA rights
		for (var j = 0; j < partyData.rfaRights.length; j++) {
			var rfaData = partyData.rfaRights[j];
			var context = {
				year: 2008,
				type: 'trade-rfa',
				tradeId: trade.tradeId,
				franchise: partyData.owner
			};
			
			var player = await resolvePlayer(rfaData, context);
			party.receives.rfaRights.push({
				playerId: player._id
			});
		}
		
		parties.push(party);
	}
	
	return parties;
}

/**
 * Main run function.
 */
async function run() {
	dryRun = process.argv.includes('--dry-run');
	
	// Parse period argument
	var periodArg = process.argv.find(function(a) { return a.startsWith('--period='); });
	if (periodArg) {
		period = periodArg.split('=')[1];
	}
	
	console.log('=== 2009 Trades Seeder ===');
	if (dryRun) console.log('[DRY RUN]');
	console.log('Period:', period);
	console.log('');
	
	// Load player resolutions
	console.log('Loaded', resolver.count(), 'cached player resolutions');
	
	// Create readline interface
	rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout
	});
	
	// Load all players from database
	var allPlayers = await Player.find({});
	allPlayers.forEach(function(p) {
		var normalized = resolver.normalizePlayerName(p.name);
		if (!playersByNormalizedName[normalized]) {
			playersByNormalizedName[normalized] = [];
		}
		playersByNormalizedName[normalized].push(p);
	});
	console.log('Loaded', allPlayers.length, 'players from database');
	
	// Build ESPN ID index from 2009 snapshot
	var snapshotPath = path.join(__dirname, '../archive/snapshots/contracts-2009.txt');
	var snapshotContent = fs.readFileSync(snapshotPath, 'utf8');
	var snapshotLines = snapshotContent.trim().split('\n');
	
	for (var i = 1; i < snapshotLines.length; i++) {
		var parts = snapshotLines[i].split(',');
		var espnId = parts[0];
		var name = parts[2];
		var position = parts[3];
		
		if (espnId && name) {
			var normalized = resolver.normalizePlayerName(name);
			var candidates = playersByNormalizedName[normalized];
			if (candidates && candidates.length === 1) {
				playersByEspnId[espnId] = candidates[0];
			}
			// Also store position for historical player creation
			if (position) {
				positionByEspnId[espnId] = position;
			}
		}
	}
	console.log('Indexed', Object.keys(playersByEspnId).length, 'players by ESPN ID');
	
	// Load franchise mappings for 2009 via regimes
	var regimes = await Regime.find({});
	var franchises = await Franchise.find({});
	
	regimes.forEach(function(r) {
		var tenure = r.tenures.find(function(t) {
			return t.startSeason <= 2009 && (t.endSeason === null || t.endSeason >= 2009);
		});
		if (tenure) {
			franchiseIdByOwnerName[r.displayName] = tenure.franchiseId;
		}
	});
	console.log('Loaded', Object.keys(franchiseIdByOwnerName).length, 'franchise mappings for 2009');
	
	// Load trades
	var trades = loadTrades();
	console.log('Found', trades.length, 'trades for period:', period);
	console.log('');
	
	// Check for existing 2009 trade transactions in this period
	var existingTrades = await Transaction.countDocuments({
		type: 'trade',
		tradeId: { $in: trades.map(function(t) { return t.tradeId; }) }
	});
	
	if (existingTrades > 0) {
		console.log('Found', existingTrades, 'existing 2009 trade transactions.');
		var answer = await new Promise(function(resolve) {
			rl.question('Clear them and re-seed? [y/N] ', resolve);
		});
		
		if (answer.toLowerCase() === 'y') {
			console.log('Clearing...');
			if (!dryRun) {
				await Transaction.deleteMany({
					type: 'trade',
					tradeId: { $in: trades.map(function(t) { return t.tradeId; }) }
				});
			}
		} else {
			console.log('Aborting.');
			rl.close();
			process.exit(0);
		}
	}
	
	// Process each trade
	var created = 0;
	var errors = [];
	
	for (var i = 0; i < trades.length; i++) {
		var trade = trades[i];
		console.log('Trade', trade.tradeId, '(' + trade.date.split('T')[0] + ')');
		
		try {
			var parties = await buildParties(trade);
			
			// Show what we're creating
			parties.forEach(function(p, idx) {
				var ownerName = trade.parties[idx].owner;
				var assets = [];
				if (p.receives.players.length) {
					assets.push(p.receives.players.length + ' player(s)');
				}
				if (p.receives.picks.length) {
					assets.push(p.receives.picks.length + ' pick(s)');
				}
				if (p.receives.cash.length) {
					var totalCash = p.receives.cash.reduce(function(sum, c) { return sum + c.amount; }, 0);
					assets.push('$' + totalCash + ' cash');
				}
				if (p.receives.rfaRights.length) {
					assets.push(p.receives.rfaRights.length + ' RFA rights');
				}
				console.log('  ' + ownerName + ' receives:', assets.join(', ') || 'nothing');
			});
			
			// Create transaction
			if (!dryRun) {
				await Transaction.create({
					type: 'trade',
					tradeId: trade.tradeId,
					timestamp: new Date(trade.date),
					source: 'wordpress',
					parties: parties
				});
			}
			
			created++;
		} catch (err) {
			if (err.message === 'User quit') {
				console.log('\nQuitting...');
				break;
			}
			errors.push({ tradeId: trade.tradeId, reason: err.message });
			console.log('  Error:', err.message);
		}
		
		console.log('');
	}
	
	// Save resolutions
	resolver.save();
	
	console.log('=== Done ===');
	console.log('Created:', created, 'trade transactions');
	
	if (errors.length > 0) {
		console.log('');
		console.log('Errors:', errors.length);
		errors.forEach(function(e) {
			console.log('  - Trade', e.tradeId + ':', e.reason);
		});
	}
	
	rl.close();
	process.exit(0);
}

run().catch(function(err) {
	console.error('Error:', err);
	if (rl) rl.close();
	process.exit(1);
});
