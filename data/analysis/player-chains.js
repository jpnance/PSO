/**
 * Player State Machine - Validate and Fix
 * 
 * Walks each player's transaction chain chronologically, tracking state
 * and identifying gaps where transitions are invalid.
 * 
 * States:
 *   - available: in free agent pool
 *   - rostered: on a franchise roster
 *   - rfa-held: RFA rights held by a franchise (not rostered)
 * 
 * Usage:
 *   node data/analysis/player-chains.js --report           # Report issues
 *   node data/analysis/player-chains.js --player="Name"    # Debug single player
 *   node data/analysis/player-chains.js --fix --dry-run    # Preview fixes
 *   node data/analysis/player-chains.js --fix              # Insert unknown transactions
 */

require('dotenv').config();
var mongoose = require('mongoose');
var Transaction = require('../../models/Transaction');
var Player = require('../../models/Player');
var Franchise = require('../../models/Franchise');

// =============================================================================
// State Machine Definition
// =============================================================================

var STATES = {
	AVAILABLE: 'available',
	ROSTERED: 'rostered',
	RFA_HELD: 'rfa-held'
};

/**
 * Define valid state transitions for each transaction type.
 * Format: { fromState: toState } or { fromState: { toState, franchise } }
 */
var TRANSITIONS = {
	// Acquisitions: available → rostered
	'draft-select': {
		valid: [STATES.AVAILABLE],
		result: STATES.ROSTERED
	},
	'auction-ufa': {
		valid: [STATES.AVAILABLE],
		result: STATES.ROSTERED
	},
	// FA is special - validity depends on whether player is in adds or drops
	// This is handled specially in walkPlayerChain
	'fa': {
		valid: 'dynamic',
		result: 'dynamic'
	},
	'expansion-draft-select': {
		valid: [STATES.AVAILABLE, STATES.ROSTERED, STATES.RFA_HELD], // Can select rostered/RFA players
		result: STATES.ROSTERED
	},
	'expansion-draft-protect': {
		valid: [STATES.ROSTERED, STATES.RFA_HELD], // Can protect rostered/RFA players
		result: STATES.ROSTERED // Stays rostered
	},
	
	// RFA acquisitions: rfa-held → rostered
	// Also accepts rostered (from expansion-draft-protect, which preserves RFA rights)
	'auction-rfa-matched': {
		valid: [STATES.RFA_HELD, STATES.ROSTERED],
		result: STATES.ROSTERED
	},
	'auction-rfa-unmatched': {
		valid: [STATES.RFA_HELD, STATES.ROSTERED],
		result: STATES.ROSTERED
	},
	
	// Contract lifecycle
	'contract': {
		valid: [STATES.ROSTERED], // Signing a contract while rostered
		result: STATES.ROSTERED
	},
	'rfa-rights-conversion': {
		valid: [STATES.ROSTERED], // Contract expired, RFA rights created
		result: STATES.RFA_HELD
	},
	'contract-expiry': {
		valid: [STATES.ROSTERED], // Contract expired, no RFA rights
		result: STATES.AVAILABLE
	},
	'rfa-rights-lapsed': {
		valid: [STATES.RFA_HELD], // RFA rights not exercised
		result: STATES.AVAILABLE
	},
	'rfa-unknown': {
		valid: [STATES.AVAILABLE], // Player was cut, RFA status unknown (pre-2014)
		result: STATES.AVAILABLE   // Stays available - we don't know what happened
	},
	'unknown': {
		valid: [STATES.AVAILABLE, STATES.ROSTERED, STATES.RFA_HELD], // Can transition from any state
		result: 'dynamic' // Result depends on what's needed next
	},
	
	// Trades: can happen while rostered or rfa-held
	'trade': {
		valid: [STATES.ROSTERED, STATES.RFA_HELD],
		result: function(tx, playerId, currentState) {
			// Trade maintains state but changes franchise
			return currentState;
		}
	}
};

// =============================================================================
// Transaction Helpers
// =============================================================================

/**
 * Build a map of playerId → transactions for all players.
 * Loads all transactions once and indexes them by player involvement.
 */
async function buildPlayerTransactionMap() {
	var allTxns = await Transaction.find({}).sort({ timestamp: 1 }).lean();
	var map = {};
	
	for (var i = 0; i < allTxns.length; i++) {
		var tx = allTxns[i];
		var involvedPlayers = new Set();
		
		// Direct playerId
		if (tx.playerId) {
			involvedPlayers.add(tx.playerId.toString());
		}
		
		// Adds array
		if (tx.adds) {
			tx.adds.forEach(function(a) {
				if (a.playerId) involvedPlayers.add(a.playerId.toString());
			});
		}
		
		// Drops array
		if (tx.drops) {
			tx.drops.forEach(function(d) {
				if (d.playerId) involvedPlayers.add(d.playerId.toString());
			});
		}
		
		// Trade parties
		if (tx.parties) {
			tx.parties.forEach(function(party) {
				if (party.receives && party.receives.players) {
					party.receives.players.forEach(function(p) {
						if (p.playerId) involvedPlayers.add(p.playerId.toString());
					});
				}
			});
		}
		
		// Add this transaction to each involved player's list
		involvedPlayers.forEach(function(pid) {
			if (!map[pid]) map[pid] = [];
			map[pid].push(tx);
		});
	}
	
	return map;
}

/**
 * Determine if a transaction affects a specific player and how.
 * Returns: { type, direction, franchiseId } or null
 * direction: 'to' (player joins franchise) or 'from' (player leaves franchise)
 */
function getTransactionEffect(tx, playerId) {
	var playerIdStr = playerId.toString();
	
	// Direct playerId reference (auction, draft, contract, rfa-conversion, etc.)
	if (tx.playerId && tx.playerId.toString() === playerIdStr) {
		return {
			type: tx.type,
			direction: 'to',
			franchiseId: tx.franchiseId
		};
	}
	
	// In adds array (FA pickup, trade receiving)
	if (tx.adds) {
		var add = tx.adds.find(function(a) {
			return a.playerId && a.playerId.toString() === playerIdStr;
		});
		if (add) {
			return {
				type: tx.type,
				direction: 'to',
				franchiseId: tx.franchiseId
			};
		}
	}
	
	// In drops array (FA cut, trade sending)
	if (tx.drops) {
		var drop = tx.drops.find(function(d) {
			return d.playerId && d.playerId.toString() === playerIdStr;
		});
		if (drop) {
			return {
				type: tx.type,
				direction: 'from',
				franchiseId: tx.franchiseId
			};
		}
	}
	
	// Trade - check parties
	if (tx.type === 'trade' && tx.parties) {
		for (var i = 0; i < tx.parties.length; i++) {
			var party = tx.parties[i];
			if (party.receives && party.receives.players) {
				var received = party.receives.players.find(function(p) {
					return p.playerId && p.playerId.toString() === playerIdStr;
				});
				if (received) {
					return {
						type: 'trade',
						direction: 'to',
						franchiseId: party.franchiseId
					};
				}
			}
		}
	}
	
	return null;
}

// =============================================================================
// State Machine Engine
// =============================================================================

/**
 * Walk a player's transaction chain and identify issues.
 * 
 * Returns: {
 *   valid: boolean,
 *   issues: [{ timestamp, expected, actual, transaction }],
 *   finalState: string,
 *   finalFranchise: ObjectId
 * }
 */
function walkPlayerChain(player, transactions) {
	var state = STATES.AVAILABLE;
	var franchiseId = null;
	var issues = [];
	
	for (var i = 0; i < transactions.length; i++) {
		var tx = transactions[i];
		var effect = getTransactionEffect(tx, player._id);
		
		if (!effect) continue; // Transaction doesn't affect this player
		
		var transition = TRANSITIONS[effect.type];
		if (!transition) {
			issues.push({
				timestamp: tx.timestamp,
				message: 'Unknown transaction type: ' + effect.type,
				state: state,
				transaction: tx
			});
			continue;
		}
		
		// Handle FA transactions specially - validity depends on add vs drop
		if (effect.type === 'fa') {
			if (effect.direction === 'to') {
				// FA pickup: available → rostered
				if (state !== STATES.AVAILABLE) {
					issues.push({
						timestamp: tx.timestamp,
						message: 'Invalid transition: ' + state + ' → fa (pickup)',
						expected: [STATES.AVAILABLE],
						actual: state,
						transaction: tx
					});
				}
				state = STATES.ROSTERED;
				franchiseId = effect.franchiseId;
			} else if (effect.direction === 'from') {
				// FA drop (cut): rostered → available
				if (state !== STATES.ROSTERED) {
					issues.push({
						timestamp: tx.timestamp,
						message: 'Invalid transition: ' + state + ' → fa (cut)',
						expected: [STATES.ROSTERED],
						actual: state,
						transaction: tx
					});
				}
				state = STATES.AVAILABLE;
				franchiseId = null;
			}
			continue;
		}
		
		// Check if current state is valid for this transition
		var validFrom = transition.valid;
		if (!validFrom.includes(state)) {
			issues.push({
				timestamp: tx.timestamp,
				message: 'Invalid transition: ' + state + ' → ' + effect.type,
				expected: validFrom,
				actual: state,
				transaction: tx
			});
		}
		
		// For trades, verify the player is moving to a DIFFERENT franchise
		if (effect.type === 'trade' && effect.direction === 'to') {
			var receivingFranchiseId = effect.franchiseId ? effect.franchiseId.toString() : null;
			var currentFranchiseId = franchiseId ? franchiseId.toString() : null;
			
			if (receivingFranchiseId && currentFranchiseId && receivingFranchiseId === currentFranchiseId) {
				issues.push({
					timestamp: tx.timestamp,
					message: 'Trade to same franchise: player already rostered here',
					actual: state,
					transaction: tx
				});
			}
		}
		
		// Validate auction transactions have salary (winningBid)
		if (effect.type.startsWith('auction-') && !tx.winningBid) {
			issues.push({
				timestamp: tx.timestamp,
				message: 'Auction transaction missing winningBid',
				transaction: tx
			});
		}
		
		// Calculate new state
		var newState;
		if (typeof transition.result === 'function') {
			newState = transition.result(tx, player._id, state);
		} else {
			newState = transition.result;
		}
		
		// Update franchise tracking
		if (effect.direction === 'to') {
			franchiseId = effect.franchiseId;
		} else if (effect.direction === 'from' && newState === STATES.AVAILABLE) {
			franchiseId = null;
		}
		
		if (newState) {
			state = newState;
		}
	}
	
	return {
		valid: issues.length === 0,
		issues: issues,
		finalState: state,
		finalFranchise: franchiseId
	};
}

// =============================================================================
// Fix Mode - Insert unknown transactions to fill gaps
// =============================================================================

/**
 * Determine what state is required for a transaction to be valid.
 */
function getRequiredState(txType, direction) {
	if (txType === 'fa') {
		return direction === 'to' ? STATES.AVAILABLE : STATES.ROSTERED;
	}
	
	var transition = TRANSITIONS[txType];
	if (!transition || !transition.valid || transition.valid === 'dynamic') {
		return null;
	}
	
	// Return the first valid state (most common case)
	return transition.valid[0];
}

/**
 * Fix a player's chain by inserting unknown transactions.
 * Returns array of unknown transactions to create.
 */
function fixPlayerChain(player, transactions) {
	var state = STATES.AVAILABLE;
	var franchiseId = null;
	var fixes = [];
	
	for (var i = 0; i < transactions.length; i++) {
		var tx = transactions[i];
		var effect = getTransactionEffect(tx, player._id);
		
		if (!effect) continue;
		
		var transition = TRANSITIONS[effect.type];
		if (!transition) continue;
		
		// Determine required state for this transaction
		var requiredState = getRequiredState(effect.type, effect.direction);
		
		if (requiredState && state !== requiredState) {
			// Need to insert unknown to bridge the gap
			// Timestamp slightly before the transaction
			var fixTimestamp = new Date(tx.timestamp.getTime() - 1000);
			
			fixes.push({
				type: 'unknown',
				timestamp: fixTimestamp,
				source: 'snapshot',
				playerId: player._id,
				franchiseId: effect.franchiseId, // Best guess
				notes: 'Auto-inserted: ' + state + ' → ' + requiredState + ' (before ' + effect.type + ')'
			});
			
			state = requiredState;
		}
		
		// Calculate new state (simplified - just track what we can)
		if (effect.type === 'fa') {
			state = effect.direction === 'to' ? STATES.ROSTERED : STATES.AVAILABLE;
			franchiseId = effect.direction === 'to' ? effect.franchiseId : null;
		} else if (transition.result && transition.result !== 'dynamic') {
			if (typeof transition.result === 'function') {
				state = transition.result(tx, player._id, state);
			} else {
				state = transition.result;
			}
			if (effect.direction === 'to') {
				franchiseId = effect.franchiseId;
			}
		}
	}
	
	return fixes;
}

// =============================================================================
// Main
// =============================================================================

async function run() {
	await mongoose.connect(process.env.MONGODB_URI);
	
	var args = process.argv.slice(2);
	var reportMode = args.includes('--report');
	var fixMode = args.includes('--fix');
	var dryRun = args.includes('--dry-run');
	var playerArg = args.find(function(a) { return a.startsWith('--player='); });
	var targetPlayer = playerArg ? playerArg.split('=')[1] : null;
	
	// Load all transactions and build player → transactions map (single query)
	var txnMap = await buildPlayerTransactionMap();
	var playerIds = Object.keys(txnMap);
	console.log('Players with transactions:', playerIds.length);
	
	// Load player names
	var players = await Player.find({}).lean();
	var playerMap = {};
	players.forEach(function(p) { playerMap[p._id.toString()] = p; });
	
	// Walk each player's chain
	var validCount = 0;
	var invalidCount = 0;
	var issuesByType = {};
	var examples = [];
	var allFixes = [];
	
	for (var i = 0; i < playerIds.length; i++) {
		var playerId = playerIds[i];
		var player = playerMap[playerId];
		
		if (!player) continue;
		
		if (targetPlayer && player.name !== targetPlayer) continue;
		
		var transactions = txnMap[playerId] || [];
		var result = walkPlayerChain(player, transactions);
		
		if (result.valid) {
			validCount++;
		} else {
			invalidCount++;
			
			result.issues.forEach(function(issue) {
				var key = issue.actual + '|' + issue.transaction.type;
				issuesByType[key] = (issuesByType[key] || 0) + 1;
				
				if (examples.length < 50) {
					examples.push({
						player: player.name,
						issue: issue
					});
				}
			});
			
			// In fix mode, generate fixes for this player
			if (fixMode) {
				var fixes = fixPlayerChain(player, transactions);
				fixes.forEach(function(fix) {
					fix.playerName = player.name;
					allFixes.push(fix);
				});
			}
		}
		
		if (targetPlayer) {
			console.log('\n=== ' + player.name + ' ===');
			console.log('Transactions:', transactions.length);
			transactions.forEach(function(tx) {
				var effect = getTransactionEffect(tx, player._id);
				console.log('  ' + tx.timestamp.toISOString().slice(0, 10) + ' ' + tx.type + 
					(effect ? ' (' + effect.direction + ')' : ''));
			});
			console.log('\nFinal state:', result.finalState);
			console.log('Valid:', result.valid);
			if (!result.valid) {
				console.log('Issues:');
				result.issues.forEach(function(issue) {
					console.log('  ' + issue.timestamp.toISOString().slice(0, 10) + ': ' + issue.message);
				});
			}
		}
	}
	
	if (!targetPlayer) {
		console.log('\nValid chains:', validCount);
		console.log('Invalid chains:', invalidCount);
		
		if (reportMode && Object.keys(issuesByType).length > 0) {
			console.log('\nIssues by type:');
			Object.entries(issuesByType)
				.sort(function(a, b) { return b[1] - a[1]; })
				.forEach(function(entry) {
					console.log('  ' + entry[1] + 'x ' + entry[0]);
				});
			
			console.log('\nExamples:');
			examples.slice(0, 20).forEach(function(ex) {
				console.log('  ' + ex.player + ': ' + ex.issue.message + 
					' (' + ex.issue.timestamp.toISOString().slice(0, 10) + ')');
			});
		}
		
		// Fix mode - create unknown transactions
		if (fixMode && allFixes.length > 0) {
			console.log('\n=== Fix Mode ===');
			console.log('Fixes to create:', allFixes.length);
			
			if (dryRun) {
				console.log('[DRY RUN] Would create:');
				allFixes.slice(0, 20).forEach(function(fix) {
					console.log('  ' + fix.playerName + ': ' + fix.notes);
				});
				if (allFixes.length > 20) {
					console.log('  ... and', allFixes.length - 20, 'more');
				}
			} else {
				var created = 0;
				for (var j = 0; j < allFixes.length; j++) {
					var fix = allFixes[j];
					delete fix.playerName; // Remove display-only field
					await Transaction.create(fix);
					created++;
				}
				console.log('Created', created, 'unknown transactions');
			}
		}
	}
	
	await mongoose.disconnect();
	process.exit(invalidCount > 0 && !fixMode ? 1 : 0);
}

run().catch(function(err) {
	console.error(err);
	process.exit(1);
});
