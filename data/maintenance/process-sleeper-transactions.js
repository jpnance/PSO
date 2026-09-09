#!/usr/bin/env node

/**
 * Process Sleeper FAAB and free agent transactions into PSO.
 * 
 * This script:
 * 1. Fetches transactions from Sleeper for current + previous week
 * 2. Filters to waiver (FAAB) and free_agent types
 * 3. Validates each transaction against PSO state
 * 4. Simulates processing to predict final roster state
 * 5. Compares predicted state against actual Sleeper rosters
 * 6. If match: processes transactions for real
 * 7. Syncs budgets back to Sleeper
 * 8. Posts drop notifications to GroupMe
 * 
 * Usage:
 *   runt process-sleeper-transactions --dry-run
 *   runt process-sleeper-transactions
 */

var dotenv = require('dotenv').config({ path: __dirname + '/../../.env' });
var mongoose = require('mongoose');

var Transaction = require('../../models/Transaction');
var Contract = require('../../models/Contract');
var Player = require('../../models/Player');
var Franchise = require('../../models/Franchise');
var Regime = require('../../models/Regime');
var LeagueConfig = require('../../models/LeagueConfig');
var PSO = require('../../config/pso');
var sleeperHelper = require('../../helpers/sleeper');
var faValidation = require('../../helpers/fa-validation');
var transactionService = require('../../services/transaction');
var notifications = require('../../helpers/notifications');
var tz = require('../../helpers/timezone');
var { buildRegimeMap } = require('../../helpers/regime');

var DRY_RUN = process.argv.includes('--dry-run');
var IS_PRODUCTION = process.env.NODE_ENV === 'production';
var VERBOSE = process.argv.includes('--verbose') || process.argv.includes('-v');

// Safety check for non-production
if (!DRY_RUN && !IS_PRODUCTION) {
	console.error('Error: Live runs only allowed in production.');
	console.error('Use --dry-run to preview changes.');
	process.exit(1);
}

/**
 * Build lookup maps for players and franchises
 */
async function buildLookups(season) {
	var players = await Player.find({}).lean();
	var playerBySleeperId = {};
	var playerById = {};
	players.forEach(function(p) {
		if (p.sleeperId) playerBySleeperId[p.sleeperId] = p;
		playerById[p._id.toString()] = p;
	});
	
	var franchises = await Franchise.find({ rosterId: { $ne: null } }).lean();
	var regimes = await Regime.find({}).lean();
	var regimeMap = buildRegimeMap(regimes, season);
	
	var franchiseByRosterId = {};
	var franchiseById = {};
	franchises.forEach(function(f) {
		franchiseByRosterId[f.rosterId] = {
			_id: f._id,
			rosterId: f.rosterId,
			displayName: regimeMap[f._id.toString()] || ('Franchise ' + f.rosterId)
		};
		franchiseById[f._id.toString()] = franchiseByRosterId[f.rosterId];
	});
	
	return {
		playerBySleeperId: playerBySleeperId,
		playerById: playerById,
		franchiseByRosterId: franchiseByRosterId,
		franchiseById: franchiseById
	};
}

/**
 * Check if a Sleeper transaction has already been processed
 */
async function isAlreadyProcessed(sleeperTransactionId) {
	var existing = await Transaction.findOne({ sleeperTransactionId: sleeperTransactionId }).lean();
	return !!existing;
}

/**
 * Transform a Sleeper transaction into our internal format
 */
function transformTransaction(sleeperTxn, lookups, config) {
	var franchise = null;
	var adds = [];
	var drops = [];
	
	// Get franchise from roster_ids (should be just one for waiver/free_agent)
	if (sleeperTxn.roster_ids && sleeperTxn.roster_ids.length > 0) {
		franchise = lookups.franchiseByRosterId[sleeperTxn.roster_ids[0]];
	}
	
	// Process adds
	if (sleeperTxn.adds) {
		Object.keys(sleeperTxn.adds).forEach(function(sleeperId) {
			var player = lookups.playerBySleeperId[sleeperId];
			if (player) {
				adds.push({
					playerId: player._id,
					sleeperId: sleeperId,
					name: player.name
				});
			} else {
				adds.push({
					playerId: null,
					sleeperId: sleeperId,
					name: 'Unknown (Sleeper ID: ' + sleeperId + ')'
				});
			}
		});
	}
	
	// Process drops
	if (sleeperTxn.drops) {
		Object.keys(sleeperTxn.drops).forEach(function(sleeperId) {
			var player = lookups.playerBySleeperId[sleeperId];
			if (player) {
				drops.push({
					playerId: player._id,
					sleeperId: sleeperId,
					name: player.name
				});
			} else {
				drops.push({
					playerId: null,
					sleeperId: sleeperId,
					name: 'Unknown (Sleeper ID: ' + sleeperId + ')'
				});
			}
		});
	}
	
	// Determine timestamp - anchor FAAB transactions to noon ET
	var timestamp = new Date(sleeperTxn.created);
	if (sleeperTxn.type === 'waiver') {
		timestamp = tz.anchorToFAABTime(timestamp, config.faab);
	}
	
	// Get bid amount for waiver transactions
	var bidAmount = 0;
	if (sleeperTxn.type === 'waiver' && sleeperTxn.settings && sleeperTxn.settings.waiver_bid !== undefined) {
		bidAmount = sleeperTxn.settings.waiver_bid;
	}
	
	return {
		sleeperTransactionId: sleeperTxn.transaction_id,
		type: sleeperTxn.type,
		franchise: franchise,
		adds: adds,
		drops: drops,
		bidAmount: bidAmount,
		timestamp: timestamp,
		raw: sleeperTxn
	};
}

/**
 * Validate a transformed transaction
 */
async function validateTransaction(txn, season) {
	var errors = [];
	
	// Check for unknown players
	txn.adds.forEach(function(add) {
		if (!add.playerId) {
			errors.push('Unknown player in add: ' + add.name);
		}
	});
	txn.drops.forEach(function(drop) {
		if (!drop.playerId) {
			errors.push('Unknown player in drop: ' + drop.name);
		}
	});
	
	// Check franchise
	if (!txn.franchise) {
		errors.push('Could not determine franchise for transaction');
		return { valid: false, errors: errors };
	}
	
	// Skip further validation if we have unknown players
	if (errors.length > 0) {
		return { valid: false, errors: errors };
	}
	
	// Use fa-validation for detailed checks
	var validation = await faValidation.validateTransaction({
		franchiseId: txn.franchise._id,
		season: season,
		adds: txn.adds,
		drops: txn.drops,
		bidAmount: txn.bidAmount,
		transactionType: txn.type,
		timestamp: txn.timestamp
	});
	
	return validation;
}

/**
 * Get current PSO roster for a franchise (player Sleeper IDs)
 */
async function getPSORoster(franchiseId, season, lookups) {
	var contracts = await Contract.find({
		franchiseId: franchiseId,
		endYear: { $gte: season }
	}).lean();
	
	var sleeperIds = [];
	contracts.forEach(function(c) {
		var player = lookups.playerById[c.playerId.toString()];
		if (player && player.sleeperId) {
			sleeperIds.push(player.sleeperId);
		}
	});
	
	return sleeperIds.sort();
}

/**
 * Simulate transaction effects on a roster (for dry-run reconciliation)
 */
function simulateTransaction(roster, txn) {
	var newRoster = roster.slice();
	
	// Remove drops
	txn.drops.forEach(function(drop) {
		if (drop.sleeperId) {
			var idx = newRoster.indexOf(drop.sleeperId);
			if (idx !== -1) newRoster.splice(idx, 1);
		}
	});
	
	// Add adds
	txn.adds.forEach(function(add) {
		if (add.sleeperId && newRoster.indexOf(add.sleeperId) === -1) {
			newRoster.push(add.sleeperId);
		}
	});
	
	return newRoster.sort();
}

/**
 * Compare two rosters and return differences
 */
function compareRosters(expected, actual) {
	var expectedSet = new Set(expected);
	var actualSet = new Set(actual);
	
	var missing = expected.filter(function(id) { return !actualSet.has(id); });
	var extra = actual.filter(function(id) { return !expectedSet.has(id); });
	
	return {
		match: missing.length === 0 && extra.length === 0,
		missing: missing,
		extra: extra
	};
}

/**
 * Format a transaction for logging
 */
function formatTransaction(txn, lookups) {
	var parts = [];
	parts.push('[' + txn.type + '] ' + txn.franchise.displayName);
	
	if (txn.adds.length > 0) {
		parts.push('  + ' + txn.adds.map(function(a) { return a.name; }).join(', '));
	}
	if (txn.drops.length > 0) {
		parts.push('  - ' + txn.drops.map(function(d) { return d.name; }).join(', '));
	}
	if (txn.bidAmount > 0) {
		parts.push('  FAAB: $' + txn.bidAmount);
	}
	
	return parts.join('\n');
}

/**
 * Post drop notification to GroupMe
 */
async function notifyDrop(txn, config, lookups) {
	if (txn.drops.length === 0) return;
	
	for (var i = 0; i < txn.drops.length; i++) {
		var drop = txn.drops[i];
		var nextFAAB = tz.nextFAABTime(
			new Date(txn.timestamp.getTime() + 24 * 60 * 60 * 1000), // 24 hours after drop
			config.faab
		);
		
		var nextFAABFormatted = nextFAAB.toLocaleString('en-US', {
				timeZone: 'America/New_York',
				weekday: 'short',
				month: 'short',
				day: 'numeric',
				hour: 'numeric',
				minute: '2-digit',
				timeZoneName: 'short'
			});
		
		var message = drop.name + ' was dropped by ' + txn.franchise.displayName + '. ' +
			'First eligible FAAB period: ' + nextFAABFormatted + '.';
		
		await notifications.postToLeague(message);
	}
}

async function main() {
	await mongoose.connect(process.env.MONGODB_URI);
	console.log('Connected to MongoDB');
	
	if (DRY_RUN) {
		console.log('DRY RUN - no changes will be made\n');
	}
	
	var config = await LeagueConfig.findById('pso');
	var season = config ? config.season : PSO.season;
	var currentWeek = PSO.getWeek(new Date(), season);
	var previousWeek = currentWeek > 1 ? currentWeek - 1 : null;
	
	console.log('Season: ' + season + ', Current Week: ' + currentWeek);
	if (previousWeek) {
		console.log('Fetching transactions for weeks ' + previousWeek + ' and ' + currentWeek + '...\n');
	} else {
		console.log('Fetching transactions for week ' + currentWeek + '...\n');
	}
	
	// Build lookups
	var lookups = await buildLookups(season);
	
	// Fetch transactions from current week (and previous if applicable)
	var allSleeperTxns = [];
	try {
		var currTxns = await sleeperHelper.fetchTransactions(currentWeek, season);
		allSleeperTxns = currTxns;
		
		if (previousWeek) {
			var prevTxns = await sleeperHelper.fetchTransactions(previousWeek, season);
			allSleeperTxns = allSleeperTxns.concat(prevTxns);
		}
		
		// De-duplicate by transaction_id (in case same txn appears in both weeks)
		var seen = {};
		allSleeperTxns = allSleeperTxns.filter(function(t) {
			if (seen[t.transaction_id]) return false;
			seen[t.transaction_id] = true;
			return true;
		});
	} catch (err) {
		console.error('Failed to fetch Sleeper transactions:', err.message);
		await notifications.alertCommissioner('Failed to fetch Sleeper transactions: ' + err.message, { priority: 'high' });
		process.exit(1);
	}
	
	// Filter to waiver and free_agent types that completed successfully
	var relevantTxns = allSleeperTxns.filter(function(t) {
		return (t.type === 'waiver' || t.type === 'free_agent') && t.status === 'complete';
	});
	
	// Also count how many failed
	var failedCount = allSleeperTxns.filter(function(t) {
		return (t.type === 'waiver' || t.type === 'free_agent') && t.status === 'failed';
	}).length;
	
	console.log('Found ' + relevantTxns.length + ' completed waiver/free_agent transactions');
	if (failedCount > 0) {
		console.log('(' + failedCount + ' failed bids excluded)');
	}
	console.log('');
	
	// Transform and filter already-processed
	var toProcess = [];
	var skipped = { processed: 0, invalid: 0, commissioner: 0 };
	
	for (var i = 0; i < relevantTxns.length; i++) {
		var sleeperTxn = relevantTxns[i];
		
		// Skip commissioner transactions (these are our syncs back to Sleeper)
		if (sleeperTxn.type === 'commissioner') {
			skipped.commissioner++;
			continue;
		}
		
		// Check if already processed
		if (await isAlreadyProcessed(sleeperTxn.transaction_id)) {
			skipped.processed++;
			if (VERBOSE) console.log('Already processed: ' + sleeperTxn.transaction_id);
			continue;
		}
		
		// Transform
		var txn = transformTransaction(sleeperTxn, lookups, config);
		
		// Validate
		var validation = await validateTransaction(txn, season);
		if (!validation.valid) {
			skipped.invalid++;
			console.log('VALIDATION FAILED: ' + txn.sleeperTransactionId);
			console.log(formatTransaction(txn, lookups));
			console.log('  Errors: ' + validation.errors.join('; '));
			console.log('');
			
			// Alert commissioner about validation failure
			var alertMsg = 'Sleeper transaction validation failed!\n\n' +
				'Transaction: ' + txn.sleeperTransactionId + '\n' +
				'Type: ' + txn.type + '\n' +
				'Franchise: ' + (txn.franchise ? txn.franchise.displayName : 'Unknown') + '\n' +
				'Errors: ' + validation.errors.join('; ');
			await notifications.alertCommissioner(alertMsg, { priority: 'high' });
			continue;
		}
		
		toProcess.push(txn);
	}
	
	console.log('Transactions to process: ' + toProcess.length);
	console.log('Skipped: ' + skipped.processed + ' already processed, ' + 
		skipped.invalid + ' invalid, ' + skipped.commissioner + ' commissioner\n');
	
	if (toProcess.length === 0) {
		console.log('Nothing to process.');
		await mongoose.disconnect();
		return;
	}
	
	// Sort by timestamp (oldest first)
	toProcess.sort(function(a, b) {
		return a.timestamp - b.timestamp;
	});
	
	// === DRY-RUN RECONCILIATION ===
	// Simulate all transactions and compare against Sleeper rosters
	console.log('Simulating transactions and reconciling with Sleeper...\n');
	
	// Get current PSO rosters for affected franchises
	var affectedFranchiseIds = new Set();
	toProcess.forEach(function(txn) {
		if (txn.franchise) affectedFranchiseIds.add(txn.franchise._id.toString());
	});
	
	var psoRosters = {};
	for (var fid of affectedFranchiseIds) {
		psoRosters[fid] = await getPSORoster(fid, season, lookups);
	}
	
	// Simulate transactions
	var simulatedRosters = {};
	Object.keys(psoRosters).forEach(function(fid) {
		simulatedRosters[fid] = psoRosters[fid].slice();
	});
	
	toProcess.forEach(function(txn) {
		var fid = txn.franchise._id.toString();
		simulatedRosters[fid] = simulateTransaction(simulatedRosters[fid], txn);
	});
	
	// Get actual Sleeper rosters
	var sleeperRosters;
	try {
		sleeperRosters = await sleeperHelper.fetchSleeperRosters();
	} catch (err) {
		console.error('Failed to fetch Sleeper rosters for reconciliation:', err.message);
		await notifications.alertCommissioner('Failed to fetch Sleeper rosters: ' + err.message, { priority: 'high' });
		process.exit(1);
	}
	
	// Compare
	var reconciliationErrors = [];
	for (var fid of affectedFranchiseIds) {
		var franchise = lookups.franchiseById[fid];
		var sleeperRoster = sleeperRosters[franchise.rosterId];
		
		if (!sleeperRoster) {
			reconciliationErrors.push(franchise.displayName + ': No Sleeper roster found');
			continue;
		}
		
		var comparison = compareRosters(simulatedRosters[fid], sleeperRoster.players || []);
		
		if (!comparison.match) {
			var errMsg = franchise.displayName + ': Roster mismatch!';
			if (comparison.missing.length > 0) {
				var missingNames = comparison.missing.map(function(sid) {
					var p = lookups.playerBySleeperId[sid];
					return p ? p.name : sid;
				});
				errMsg += ' Missing from Sleeper: ' + missingNames.join(', ');
			}
			if (comparison.extra.length > 0) {
				var extraNames = comparison.extra.map(function(sid) {
					var p = lookups.playerBySleeperId[sid];
					return p ? p.name : sid;
				});
				errMsg += ' Extra in Sleeper: ' + extraNames.join(', ');
			}
			reconciliationErrors.push(errMsg);
		} else if (VERBOSE) {
			console.log(franchise.displayName + ': Roster reconciled OK');
		}
	}
	
	if (reconciliationErrors.length > 0) {
		console.error('\nRECONCILIATION FAILED:');
		reconciliationErrors.forEach(function(e) { console.error('  ' + e); });
		console.error('\nAborting. No transactions were processed.\n');
		
		await notifications.alertCommissioner(
			'Sleeper transaction processing aborted due to roster mismatch!\n\n' +
			reconciliationErrors.join('\n'),
			{ priority: 'urgent' }
		);
		
		await mongoose.disconnect();
		process.exit(1);
	}
	
	console.log('Reconciliation passed - predicted rosters match Sleeper\n');
	
	// === PROCESS TRANSACTIONS ===
	if (DRY_RUN) {
		console.log('Would process the following transactions:\n');
		toProcess.forEach(function(txn) {
			console.log(formatTransaction(txn, lookups));
			console.log('');
		});
		console.log('DRY RUN complete. No changes made.');
		await mongoose.disconnect();
		return;
	}
	
	console.log('Processing ' + toProcess.length + ' transactions...\n');
	
	var processed = 0;
	var failed = 0;
	var dropsToNotify = [];
	
	for (var i = 0; i < toProcess.length; i++) {
		var txn = toProcess[i];
		
		console.log('Processing: ' + txn.sleeperTransactionId);
		console.log(formatTransaction(txn, lookups));
		
		// Alert if free_agent has adds (shouldn't happen - all pickups go through FAAB)
		if (txn.type === 'free_agent' && txn.adds.length > 0) {
			var alertMsg = 'Unexpected: free_agent transaction has adds!\n' +
				'Transaction: ' + txn.sleeperTransactionId + '\n' +
				'Adds: ' + txn.adds.map(function(a) { return a.name; }).join(', ');
			console.error(alertMsg);
			await notifications.alertCommissioner(alertMsg, { priority: 'high' });
		}
		
		try {
			// Build adds with salary (bid amount for waiver)
			var adds = txn.adds.map(function(a) {
				return {
					playerId: a.playerId,
					salary: txn.bidAmount || 1
				};
			});
			
			var drops = txn.drops.map(function(d) {
				return { playerId: d.playerId };
			});
			
			var result = await transactionService.processFA({
				franchiseId: txn.franchise._id,
				adds: adds,
				drops: drops,
				timestamp: txn.timestamp,
				source: 'sleeper',
				sleeperTransactionId: txn.sleeperTransactionId
			});
			
			if (result.success) {
				processed++;
				console.log('  -> Created transaction: ' + result.transaction._id);
				
				// Queue drops for notification (only midweek drops, not FAAB-related drops)
				if (txn.type === 'free_agent' && txn.drops.length > 0) {
					dropsToNotify.push(txn);
				}
			} else {
				failed++;
				console.error('  -> Failed: ' + (result.errors || []).join('; '));
			}
		} catch (err) {
			failed++;
			console.error('  -> Error: ' + err.message);
		}
		
		console.log('');
	}
	
	console.log('\nProcessed: ' + processed + ', Failed: ' + failed);
	
	// === SYNC BUDGETS ===
	// === SYNC BUDGETS ===
	if (processed > 0) {
		console.log('\nSyncing budgets to Sleeper...');
		
		// Get unique affected franchise IDs
		var affectedFranchiseIds = [];
		toProcess.forEach(function(txn) {
			if (txn.franchise && txn.franchise._id) {
				var fid = txn.franchise._id.toString();
				if (affectedFranchiseIds.indexOf(fid) === -1) {
					affectedFranchiseIds.push(fid);
				}
			}
		});
		
		// Build sync data
		var Budget = require('../../models/Budget');
		var franchisesForSync = [];
		
		for (var i = 0; i < affectedFranchiseIds.length; i++) {
			var fid = affectedFranchiseIds[i];
			var franchise = lookups.franchiseById[fid];
			var budget = await Budget.findOne({ franchiseId: fid, season: season }).lean();
			
			if (franchise && franchise.rosterId && budget) {
				franchisesForSync.push({
					franchiseId: fid,
					rosterId: franchise.rosterId,
					available: budget.available
				});
				console.log('  ' + franchise.displayName + ': $' + budget.available + ' available');
			}
		}
		
		if (franchisesForSync.length > 0) {
			var budgetResult = await sleeperHelper.syncBudgets(franchisesForSync);
			if (budgetResult.errors.length > 0) {
				console.error('Budget sync errors:', budgetResult.errors.join('; '));
				await notifications.alertCommissioner(
					'Budget sync errors after processing Sleeper transactions:\n' + budgetResult.errors.join('\n'),
					{ priority: 'high' }
				);
			} else {
				console.log('Budget sync complete: ' + budgetResult.synced + ' updated, ' + budgetResult.skipped + ' already in sync');
			}
		}
	}
	
	// === NOTIFY DROPS ===
	if (dropsToNotify.length > 0) {
		console.log('\nPosting drop notifications to GroupMe...');
		for (var i = 0; i < dropsToNotify.length; i++) {
			await notifyDrop(dropsToNotify[i], config, lookups);
		}
	}
	
	console.log('\nDone.');
	await mongoose.disconnect();
}

main().catch(async function(err) {
	console.error('Fatal error:', err);
	try {
		await notifications.alertCommissioner('Sleeper transaction processing crashed: ' + err.message, { priority: 'urgent' });
	} catch (e) {
		// Ignore notification failure
	}
	process.exit(1);
});
