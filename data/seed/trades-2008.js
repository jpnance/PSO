/**
 * Seed 2008 trade transactions.
 * 
 * These are the first 6 trades in league history.
 * Trade 1 is pre-auction (Aug 19) - mostly a historical record.
 * Trades 2-6 happened during the 2008 season after the auction.
 * 
 * Usage:
 *   docker compose run --rm -it web node data/seed/trades-2008.js
 *   docker compose run --rm -it web node data/seed/trades-2008.js --dry-run
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

// Global state
var rl = null;
var playersByNormalizedName = {};
var playersByEspnId = {};
var franchiseByOwnerName = {};
var franchiseIdByOwnerName = {};
var dryRun = false;

/**
 * Load 2008 trades from trades.json.
 */
function loadTrades() {
	var content = fs.readFileSync(TRADES_PATH, 'utf8');
	var allTrades = JSON.parse(content);
	
	return allTrades.filter(function(t) {
		return t.date && t.date.startsWith('2008');
	});
}

/**
 * Parse contract string like "2010", "2008", "FA", "unsigned".
 * Returns { startYear, endYear } or null if ambiguous.
 */
function parseContractStr(contractStr, salary, tradeYear) {
	if (!contractStr || contractStr === 'unsigned') {
		// Pre-auction trade or unresolved
		return { startYear: null, endYear: null, ambiguous: true };
	}
	
	if (contractStr === 'FA') {
		// FA contract - single year
		return { startYear: tradeYear, endYear: tradeYear, ambiguous: false };
	}
	
	// Parse end year (e.g., "2010")
	var endYear = parseInt(contractStr);
	if (isNaN(endYear)) {
		return { startYear: null, endYear: null, ambiguous: true };
	}
	
	// Infer start year based on salary and end year
	// 1-year contracts: FA pickup style
	// 2-3 year contracts: auction style
	// We can't always know, so mark as potentially ambiguous
	var startYear = tradeYear; // Best guess
	
	return { startYear: startYear, endYear: endYear, ambiguous: true };
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
		console.log('  Creating historical player: ' + playerData.name);
		
		if (dryRun) {
			return { _id: 'dry-run-id', name: playerData.name, positions: [] };
		}
		
		var player = await Player.create({
			name: playerData.name,
			positions: [],
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
				year: 2008,
				type: 'trade',
				tradeId: trade.tradeId,
				franchise: partyData.owner
			};
			
			var player = await resolvePlayer(playerData, context);
			var contractInfo = parseContractStr(playerData.contractStr, playerData.salary, 2008);
			
			party.receives.players.push({
				playerId: player._id,
				salary: playerData.salary,
				startYear: contractInfo.startYear,
				endYear: contractInfo.endYear,
				rfaRights: false,
				ambiguous: contractInfo.ambiguous
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
				season: pickData.year,
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
	
	console.log('=== 2008 Trades Seeder ===');
	if (dryRun) console.log('[DRY RUN]');
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
	
	// Build ESPN ID index from 2008 snapshot
	var snapshotPath = path.join(__dirname, '../archive/snapshots/contracts-2008.txt');
	var snapshotContent = fs.readFileSync(snapshotPath, 'utf8');
	var snapshotLines = snapshotContent.trim().split('\n');
	
	for (var i = 1; i < snapshotLines.length; i++) {
		var parts = snapshotLines[i].split(',');
		var espnId = parts[0];
		var name = parts[2];
		
		if (espnId && name) {
			var normalized = resolver.normalizePlayerName(name);
			var candidates = playersByNormalizedName[normalized];
			if (candidates && candidates.length === 1) {
				playersByEspnId[espnId] = candidates[0];
			}
		}
	}
	console.log('Indexed', Object.keys(playersByEspnId).length, 'players by ESPN ID');
	
	// Load franchise mappings for 2008 via regimes
	var regimes = await Regime.find({});
	var franchises = await Franchise.find({});
	
	regimes.forEach(function(r) {
		var tenure = r.tenures.find(function(t) {
			return t.startSeason <= 2008 && (t.endSeason === null || t.endSeason >= 2008);
		});
		if (tenure) {
			franchiseIdByOwnerName[r.displayName] = tenure.franchiseId;
		}
	});
	console.log('Loaded', Object.keys(franchiseIdByOwnerName).length, 'franchise mappings for 2008');
	
	// Load trades
	var trades = loadTrades();
	console.log('Found', trades.length, 'trades in 2008');
	console.log('');
	
	// Check for existing 2008 trade transactions
	var existingTrades = await Transaction.countDocuments({
		type: 'trade',
		tradeId: { $in: trades.map(function(t) { return t.tradeId; }) }
	});
	
	if (existingTrades > 0) {
		console.log('Found', existingTrades, 'existing 2008 trade transactions.');
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
