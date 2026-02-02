/**
 * Seed FA transactions (pickups/drops) from Sleeper and Fantrax transaction data.
 * 
 * Uses the facts layer to load transactions and applies filtering:
 * - Excludes rollbacks (ROLLBACK_LIKELY confidence)
 * - Excludes trade-facilitation drops (TRADE_FACILITATION confidence)
 * - Excludes pre-FAAB transactions (preseason noise)
 * - Excludes commissioner actions that are trade executions
 * 
 * Usage:
 *   docker compose run --rm -it web node data/seed/fa-transactions.js
 *   docker compose run --rm -it web node data/seed/fa-transactions.js --clear
 *   docker compose run --rm -it web node data/seed/fa-transactions.js --dry-run
 *   docker compose run --rm -it web node data/seed/fa-transactions.js --year=2024
 */

var dotenv = require('dotenv').config({ path: __dirname + '/../../.env' });
var fs = require('fs');
var path = require('path');
var mongoose = require('mongoose');
var readline = require('readline');

var Player = require('../../models/Player');
var Franchise = require('../../models/Franchise');
var Regime = require('../../models/Regime');
var Transaction = require('../../models/Transaction');
var PSO = require('../../config/pso.js');
var resolver = require('../utils/player-resolver');

// Facts layer
var sleeperFacts = require('../facts/sleeper-facts');
var fantraxFacts = require('../facts/fantrax-facts');

mongoose.connect(process.env.MONGODB_URI);

// Load fixups
var CONFIG_DIR = path.join(__dirname, '../config');

/**
 * Load all fixups from config files.
 * Returns sets of transaction IDs to ignore.
 */
function loadFixups() {
	var ignored = {
		sleeper: new Set(),
		fantrax: new Set()
	};
	
	// Load Sleeper fixups (by year)
	var sleeperFiles = fs.readdirSync(CONFIG_DIR).filter(function(f) {
		return f.match(/^sleeper-fixups-\d+\.json$/);
	});
	
	sleeperFiles.forEach(function(file) {
		try {
			var fixups = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, file), 'utf8'));
			// Ignored transactions
			(fixups.sleeperIgnored || []).forEach(function(item) {
				if (item.sleeperTxId) ignored.sleeper.add(item.sleeperTxId);
			});
			// Trade-facilitating drops are also "ignored" for FA import purposes
			(fixups.sleeperCutTradeLinks || []).forEach(function(item) {
				// These are linked to trades, not FA transactions
			});
		} catch (e) {
			console.warn('Warning: Could not load ' + file + ':', e.message);
		}
	});
	
	// Load Fantrax fixups
	var fantraxFixupsPath = path.join(CONFIG_DIR, 'fantrax-fixups.json');
	if (fs.existsSync(fantraxFixupsPath)) {
		try {
			var fixups = JSON.parse(fs.readFileSync(fantraxFixupsPath, 'utf8'));
			(fixups.fantraxIgnored || []).forEach(function(item) {
				if (item.transactionId) ignored.fantrax.add(item.transactionId);
			});
		} catch (e) {
			console.warn('Warning: Could not load fantrax-fixups.json:', e.message);
		}
	}
	
	return ignored;
}

var fixupsIgnored = loadFixups();

// Global state
var rl = null;
var playersByNormalizedName = {};
var playersBySleeperId = {};
var franchiseByRosterId = {};
var franchiseByOwnerName = {};

// Sleeper data for ID mapping
var sleeperData = {};
try {
	sleeperData = require('../../public/data/sleeper-data.json');
} catch (e) {
	console.warn('Warning: Could not load sleeper-data.json');
}

/**
 * Confidence levels that indicate a commissioner transaction should be skipped.
 */
var SKIP_CONFIDENCE = [
	'rollback_likely',
	'trade_facilitation',
	'reversal_pair'
];

/**
 * Confidence levels that indicate a commissioner transaction should be imported.
 */
var IMPORT_CONFIDENCE = [
	'manual_assist'
	// 'unknown' - could add this if we trust the algorithm catches all bad ones
];

/**
 * Parse command line arguments.
 */
function parseArgs() {
	var args = {
		clear: false,
		dryRun: false,
		year: null,
		source: null  // 'sleeper', 'fantrax', or null for both
	};
	
	process.argv.forEach(function(arg) {
		if (arg === '--clear') args.clear = true;
		if (arg === '--dry-run') args.dryRun = true;
		if (arg.startsWith('--year=')) args.year = parseInt(arg.split('=')[1]);
		if (arg.startsWith('--source=')) args.source = arg.split('=')[1];
	});
	
	return args;
}

/**
 * Load all FA transactions from Sleeper facts.
 * Includes regular FA transactions and commissioner actions with confidence levels.
 */
function loadSleeperTransactions(year) {
	var seasons = year ? [year] : sleeperFacts.getAvailableYears();
	var allTx = [];
	
	seasons.forEach(function(season) {
		var raw = sleeperFacts.loadSeason(season);
		
		// Add season to all transactions (needed for filtering)
		raw.forEach(function(tx) {
			tx.season = season;
			tx.factSource = 'sleeper';
		});
		
		// Get regular FA transactions (waiver and free_agent types)
		var faTx = sleeperFacts.getFATransactions(raw);
		faTx = sleeperFacts.filterRealFaab(faTx);
		
		// Get commissioner actions with confidence analysis
		var commissionerTx = sleeperFacts.findCommissionerActions(raw);
		commissionerTx.forEach(function(tx) {
			tx.season = season;
			tx.factSource = 'sleeper';
			tx.isCommissionerAction = true;
		});
		
		allTx = allTx.concat(faTx);
		allTx = allTx.concat(commissionerTx);
	});
	
	return allTx;
}

/**
 * Load all FA transactions from Fantrax facts.
 * Includes regular waiver transactions and commissioner actions with confidence levels.
 */
function loadFantraxTransactions(year) {
	var availability = fantraxFacts.checkAvailability();
	var seasons = year ? [year] : availability.years;
	var allTx = [];
	
	seasons.forEach(function(season) {
		var raw = fantraxFacts.loadSeason(season);
		
		// Add season to all transactions (needed for filtering)
		raw.forEach(function(tx) {
			tx.season = season;
			tx.factSource = 'fantrax';
		});
		
		// Get regular waiver transactions (non-commissioner claim + drop)
		var waiverTx = fantraxFacts.getWaivers(raw);
		waiverTx = fantraxFacts.filterRealFaab(waiverTx);
		// Filter out commissioner waivers - they'll be analyzed separately
		waiverTx = waiverTx.filter(function(tx) { return !tx.isCommissioner; });
		
		// Get commissioner actions with confidence analysis
		var commissionerTx = fantraxFacts.findCommissionerActions(raw);
		commissionerTx.forEach(function(tx) {
			tx.season = season;
			tx.factSource = 'fantrax';
			tx.isCommissionerAction = true;
		});
		
		allTx = allTx.concat(waiverTx);
		allTx = allTx.concat(commissionerTx);
	});
	
	return allTx;
}

/**
 * Get confidence for a transaction.
 * Checks commissioner actions for rollback/trade-facilitation patterns.
 */
function getConfidence(tx, allTx) {
	// Regular FA transactions are always real
	if (tx.type === 'waiver' || tx.type === 'free_agent') {
		return { confidence: 'real', reason: 'Normal FA transaction' };
	}
	
	// Commissioner transactions need analysis
	if (tx.type === 'commissioner') {
		// Check for trade transfers (commissioner moving players for a trade)
		if (tx.isTradeTransfer) {
			return { confidence: 'trade_execution', reason: 'Trade execution' };
		}
		
		// Check rollback patterns, trade facilitation, etc.
		// This would typically be done by the facts layer
		if (tx.confidence) {
			return { confidence: tx.confidence, reason: tx.confidenceReason || '' };
		}
	}
	
	return { confidence: 'unknown', reason: '' };
}

/**
 * Check if a transaction should be imported.
 */
function shouldImport(tx) {
	// Check fixups first - explicit ignores take precedence
	if (tx.factSource === 'sleeper' && tx.transactionId && fixupsIgnored.sleeper.has(tx.transactionId)) {
		return false;
	}
	if (tx.factSource === 'fantrax' && tx.transactionId && fixupsIgnored.fantrax.has(tx.transactionId)) {
		return false;
	}
	
	// Commissioner actions are handled by confidence level
	if (tx.isCommissionerAction) {
		// Import if confidence indicates it's a legitimate manual assist
		if (IMPORT_CONFIDENCE.indexOf(tx.confidence) >= 0) {
			return true;
		}
		// Skip if confidence indicates rollback/trade-facilitation
		if (SKIP_CONFIDENCE.indexOf(tx.confidence) >= 0) {
			return false;
		}
		// Unknown confidence - skip for safety (can review these separately)
		return false;
	}
	
	// Import regular FA transactions (waiver, free_agent)
	return tx.type === 'waiver' || tx.type === 'free_agent';
}

/**
 * Resolve a player from a transaction add/drop.
 */
async function resolvePlayer(item, context) {
	// Try Sleeper ID first (Sleeper uses 'playerId' for the Sleeper player ID)
	var sleeperId = item.sleeperId || item.playerId;
	if (sleeperId && playersBySleeperId[sleeperId]) {
		return { playerId: playersBySleeperId[sleeperId]._id };
	}
	
	// Try name lookup
	var name = item.playerName;
	if (!name) {
		return { playerId: null, error: 'No player name' };
	}
	
	// Check resolver cache
	var cached = resolver.lookup(name, context);
	if (cached && cached.sleeperId && playersBySleeperId[cached.sleeperId]) {
		return { playerId: playersBySleeperId[cached.sleeperId]._id };
	}
	if (cached && cached.name) {
		var player = await Player.findOne({ name: cached.name });
		if (player) return { playerId: player._id };
	}
	
	// Try normalized name lookup
	var normalized = resolver.normalizePlayerName(name);
	var candidates = playersByNormalizedName[normalized] || [];
	
	// Filter by position if available
	// Sleeper uses 'position' (singular string), Fantrax uses 'positions' (string like "DL" or "RB/WR")
	var itemPosition = item.position || item.positions;
	if (itemPosition && candidates.length > 1) {
		var posArray = typeof itemPosition === 'string' ? itemPosition.split('/') : [itemPosition];
		var posMatches = candidates.filter(function(p) {
			if (!p.positions) return false;
			return posArray.some(function(pos) { return p.positions.includes(pos); });
		});
		if (posMatches.length === 1) {
			return { playerId: posMatches[0]._id };
		}
		candidates = posMatches.length > 0 ? posMatches : candidates;
	}
	
	// Single match and not a known ambiguous name - auto-resolve
	if (candidates.length === 1 && !resolver.isAmbiguous(normalized)) {
		return { playerId: candidates[0]._id };
	}
	
	// Need interactive resolution if:
	// - Multiple candidates (disambiguation)
	// - Single candidate but name is ambiguous (confirm it's the right one)
	// - Zero candidates (manual lookup by Sleeper ID)
	if (candidates.length > 1 || candidates.length === 0 || resolver.isAmbiguous(normalized)) {
		var result = await resolver.promptForPlayer({
			name: name,
			context: context,
			candidates: candidates,
			position: itemPosition,
			Player: Player,
			rl: rl,
			playerCache: playersByNormalizedName
		});
		
		if (result.action === 'quit') {
			throw new Error('User quit');
		}
		
		if (result.player) {
			return { playerId: result.player._id };
		}
	}
	
	// Not found (user skipped or couldn't resolve)
	return { playerId: null, error: 'Player not found: ' + name };
}

/**
 * Convert a fact transaction to a database Transaction record.
 */
async function convertTransaction(tx) {
	var errors = [];
	var adds = [];
	var drops = [];
	
	// Get franchise - try roster ID first (Sleeper), then owner name (Fantrax)
	var franchiseId = null;
	var franchiseContext = null;
	
	// Try roster ID (Sleeper)
	var rosterId = tx.rosterIds ? tx.rosterIds[0] : null;
	if (!rosterId && tx.adds && tx.adds.length > 0) {
		rosterId = tx.adds[0].rosterId;
	}
	if (!rosterId && tx.drops && tx.drops.length > 0) {
		rosterId = tx.drops[0].rosterId;
	}
	
	if (rosterId) {
		franchiseId = franchiseByRosterId[rosterId];
		franchiseContext = 'F' + rosterId;
	}
	
	// Try Fantrax team ID (preferred for Fantrax)
	if (!franchiseId && tx.franchiseTeamId && tx.season) {
		var fantraxMapping = PSO.fantraxIds[tx.season];
		if (fantraxMapping && fantraxMapping[tx.franchiseTeamId]) {
			var fantraxRosterId = fantraxMapping[tx.franchiseTeamId];
			franchiseId = franchiseByRosterId[fantraxRosterId];
			franchiseContext = tx.owner || ('F' + fantraxRosterId);
		}
	}
	
	// Fallback: owner name via PSO.franchiseIds (for commissioner actions without team ID)
	if (!franchiseId && tx.owner) {
		var ownerRosterId = franchiseByOwnerName[tx.owner.toLowerCase()];
		if (ownerRosterId) {
			franchiseId = ownerRosterId;
			franchiseContext = tx.owner;
		}
	}
	
	if (!franchiseId) {
		errors.push('No franchise for rosterId: ' + rosterId + ', owner: ' + tx.owner);
		return { errors: errors };
	}
	
	var context = {
		year: tx.season,
		type: 'fa',
		franchise: franchiseContext
	};
	
	// Process adds
	if (tx.adds) {
		for (var i = 0; i < tx.adds.length; i++) {
			var add = tx.adds[i];
			var resolution = await resolvePlayer(add, context);
			
			if (resolution.playerId) {
				adds.push({
					playerId: resolution.playerId,
					salary: tx.waiverBid || 0,
					startYear: null,  // FA contract
					endYear: tx.season
				});
			} else {
				errors.push(resolution.error || 'Could not resolve: ' + add.playerName);
			}
		}
	}
	
	// Process drops
	if (tx.drops) {
		for (var i = 0; i < tx.drops.length; i++) {
			var drop = tx.drops[i];
			var resolution = await resolvePlayer(drop, context);
			
			if (resolution.playerId) {
				drops.push({
					playerId: resolution.playerId,
					salary: null,  // We don't know dropped player's salary from FA transaction
					startYear: null,
					endYear: null
				});
			} else {
				errors.push(resolution.error || 'Could not resolve drop: ' + drop.playerName);
			}
		}
	}
	
	if (errors.length > 0 && adds.length === 0 && drops.length === 0) {
		return { errors: errors };
	}
	
	return {
		type: 'fa',
		timestamp: tx.timestamp,
		source: tx.factSource,
		franchiseId: franchiseId,
		adds: adds,
		drops: drops,
		errors: errors.length > 0 ? errors : null
	};
}

/**
 * Main run function.
 */
async function run() {
	var args = parseArgs();
	
	console.log('Loading FA transactions from facts layer...');
	console.log('Loaded', resolver.count(), 'cached player resolutions');
	
	// Create readline interface
	rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout
	});
	
	// Load all players
	var allPlayers = await Player.find({});
	allPlayers.forEach(function(p) {
		var normalized = resolver.normalizePlayerName(p.name);
		if (!playersByNormalizedName[normalized]) {
			playersByNormalizedName[normalized] = [];
		}
		playersByNormalizedName[normalized].push(p);
		
		if (p.sleeperId) {
			playersBySleeperId[p.sleeperId] = p;
		}
	});
	console.log('Loaded', allPlayers.length, 'players from database');
	
	// Load franchises
	var franchises = await Franchise.find({});
	franchises.forEach(function(f) {
		if (f.rosterId) {
			franchiseByRosterId[f.rosterId] = f._id;
		}
	});
	
	// Build owner name -> franchise ID mapping using PSO config
	// PSO.franchiseIds maps owner names to roster IDs
	Object.keys(PSO.franchiseIds).forEach(function(ownerName) {
		var rosterId = PSO.franchiseIds[ownerName];
		if (franchiseByRosterId[rosterId]) {
			franchiseByOwnerName[ownerName.toLowerCase()] = franchiseByRosterId[rosterId];
		}
	});
	
	// Build additional mappings from Regime display names
	// This handles names like "Schex" -> Schexes franchise, etc.
	var regimes = await Regime.find({});
	regimes.forEach(function(regime) {
		var regimeLower = regime.displayName.toLowerCase();
		// Map to the CURRENT tenure's franchise (most recent)
		var currentTenure = regime.tenures.find(function(t) { return t.endSeason === null; });
		if (currentTenure && !franchiseByOwnerName[regimeLower]) {
			franchiseByOwnerName[regimeLower] = currentTenure.franchiseId;
		}
	});
	console.log('  Built', Object.keys(franchiseByOwnerName).length, 'owner name mappings');
	console.log('Loaded', franchises.length, 'franchises');
	
	// Load transactions from facts
	var transactions = [];
	
	if (!args.source || args.source === 'sleeper') {
		var sleeperTx = loadSleeperTransactions(args.year);
		console.log('Loaded', sleeperTx.length, 'Sleeper FA transactions');
		transactions = transactions.concat(sleeperTx);
	}
	
	if (!args.source || args.source === 'fantrax') {
		var fantraxTx = loadFantraxTransactions(args.year);
		console.log('Loaded', fantraxTx.length, 'Fantrax FA transactions');
		transactions = transactions.concat(fantraxTx);
	}
	
	// Filter to importable transactions
	var toImport = transactions.filter(shouldImport);
	console.log('\nFiltered to', toImport.length, 'importable transactions');
	
	// Show filtering stats
	var stats = {
		regularFA: 0,
		fixupIgnored: 0,
		commissionerManualAssist: 0,
		commissionerRollback: 0,
		commissionerTradeFacilitation: 0,
		commissionerReversalPair: 0,
		commissionerUnknown: 0
	};
	
	transactions.forEach(function(tx) {
		// Check fixups first
		var isFixupIgnored = (tx.factSource === 'sleeper' && tx.transactionId && fixupsIgnored.sleeper.has(tx.transactionId)) ||
			(tx.factSource === 'fantrax' && tx.transactionId && fixupsIgnored.fantrax.has(tx.transactionId));
		
		if (isFixupIgnored) {
			stats.fixupIgnored++;
		} else if (tx.isCommissionerAction) {
			if (tx.confidence === 'manual_assist') {
				stats.commissionerManualAssist++;
			} else if (tx.confidence === 'rollback_likely') {
				stats.commissionerRollback++;
			} else if (tx.confidence === 'trade_facilitation') {
				stats.commissionerTradeFacilitation++;
			} else if (tx.confidence === 'reversal_pair') {
				stats.commissionerReversalPair++;
			} else {
				stats.commissionerUnknown++;
			}
		} else {
			stats.regularFA++;
		}
	});
	
	console.log('\nTransaction breakdown:');
	console.log('  Regular FA (waiver/free_agent):', stats.regularFA, '-> IMPORT');
	console.log('  Commissioner - manual_assist:', stats.commissionerManualAssist, '-> IMPORT');
	console.log('  Fixup ignored:', stats.fixupIgnored, '-> SKIP');
	console.log('  Commissioner - rollback_likely:', stats.commissionerRollback, '-> SKIP');
	console.log('  Commissioner - trade_facilitation:', stats.commissionerTradeFacilitation, '-> SKIP');
	console.log('  Commissioner - reversal_pair:', stats.commissionerReversalPair, '-> SKIP');
	console.log('  Commissioner - unknown:', stats.commissionerUnknown, '-> SKIP (review separately)');
	
	// Group by season for summary
	var bySeason = {};
	toImport.forEach(function(tx) {
		bySeason[tx.season] = (bySeason[tx.season] || 0) + 1;
	});
	
	console.log('\nBy season:');
	Object.keys(bySeason).sort().forEach(function(season) {
		console.log('  ' + season + ':', bySeason[season]);
	});
	
	if (args.dryRun) {
		console.log('\n[Dry run - no changes made]');
		rl.close();
		process.exit(0);
	}
	
	// Clear existing if requested
	if (args.clear) {
		console.log('\nClearing existing FA transactions from Sleeper/Fantrax sources...');
		var deleted = await Transaction.deleteMany({
			type: 'fa',
			source: { $in: ['sleeper', 'fantrax'] }
		});
		console.log('  Deleted:', deleted.deletedCount);
	}
	
	// Process and create transactions
	console.log('\nProcessing transactions...');
	
	var created = 0;
	var errored = 0;
	var allErrors = [];
	
	for (var i = 0; i < toImport.length; i++) {
		var tx = toImport[i];
		
		try {
			var record = await convertTransaction(tx);
			
			if (record.errors && !record.franchiseId) {
				errored++;
				allErrors.push({
					tx: tx,
					errors: record.errors
				});
				continue;
			}
			
			await Transaction.create({
				type: record.type,
				timestamp: record.timestamp,
				source: record.source,
				franchiseId: record.franchiseId,
				adds: record.adds,
				drops: record.drops
			});
			
			created++;
			
			if (record.errors) {
				allErrors.push({
					tx: tx,
					errors: record.errors,
					partial: true
				});
			}
		} catch (err) {
			if (err.message === 'User quit') {
				console.log('\nQuitting...');
				break;
			}
			
			errored++;
			allErrors.push({
				tx: tx,
				errors: [err.message]
			});
		}
		
		// Progress
		if ((i + 1) % 100 === 0) {
			console.log('  Processed', i + 1, '/', toImport.length, '...');
		}
	}
	
	// Save resolutions
	resolver.save();
	
	console.log('\nDone!');
	console.log('  Created:', created);
	console.log('  Errors:', errored);
	
	if (allErrors.length > 0) {
		console.log('\nErrors (first 20):');
		allErrors.slice(0, 20).forEach(function(e) {
			e.errors.forEach(function(err) {
				console.log('  -', err);
			});
		});
		if (allErrors.length > 20) {
			console.log('  ... and', allErrors.length - 20, 'more');
		}
	}
	
	rl.close();
	process.exit(0);
}

run().catch(function(err) {
	console.error('Error:', err);
	if (rl) rl.close();
	process.exit(1);
});
