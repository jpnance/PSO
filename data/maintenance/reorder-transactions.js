/**
 * Reorder Transactions
 * 
 * Ensures all transactions for each player are in logical order.
 * 
 * Timestamps with :33 seconds are considered "inferred" and adjustable.
 * Timestamps without :33 seconds are considered "authoritative" and immutable.
 * 
 * Logical ordering rules:
 * - Acquisition (auction, draft, FA pickup, trade-in) must precede disposal (cut, trade-out)
 * - Cut by owner A must precede pickup by owner B (if A ≠ B)
 * - Within a season, cuts/pickups follow the chronological order from cuts data
 * 
 * Usage:
 *   node data/maintenance/reorder-transactions.js [--dry-run] [--verbose]
 */

var dotenv = require('dotenv').config({ path: __dirname + '/../../.env' });
var mongoose = require('mongoose');

var Transaction = require('../../models/Transaction');
var Player = require('../../models/Player');
var Regime = require('../../models/Regime');
var cutFacts = require('../facts/cut-facts');

mongoose.connect(process.env.MONGODB_URI);

var MINUTE_MS = 60 * 1000;

/**
 * Check if a timestamp has :33 seconds (inferred/adjustable)
 */
function isInferredTimestamp(date) {
	return date.getUTCSeconds() === 33;
}

/**
 * Get regime name for a franchise in a given year
 */
function getRegimeName(regimes, franchiseId, year) {
	if (!franchiseId) return '?';
	var regime = regimes.find(function(r) {
		return r.tenures && r.tenures.some(function(t) {
			return t.franchiseId.toString() === franchiseId.toString() &&
				t.startSeason <= year &&
				(t.endSeason === null || t.endSeason >= year);
		});
	});
	return regime ? regime.displayName : franchiseId.toString().slice(-4);
}

/**
 * Determine if a transaction is an "acquisition" for a player
 */
function isAcquisition(txn, playerId) {
	var pid = playerId.toString();
	
	// Direct acquisition types
	if (['auction-ufa', 'auction-rfa-matched', 'auction-rfa-unmatched', 'draft-select'].includes(txn.type)) {
		return txn.playerId && txn.playerId.toString() === pid;
	}
	
	// FA pickup (player in adds)
	if (txn.type === 'fa' && txn.adds) {
		return txn.adds.some(function(a) {
			return a.playerId && a.playerId.toString() === pid;
		});
	}
	
	// Trade (player received)
	if (txn.type === 'trade' && txn.parties) {
		// Check if this franchise received the player
		return txn.parties.some(function(p) {
			return p.receives && p.receives.players && p.receives.players.some(function(pl) {
				return pl.playerId && pl.playerId.toString() === pid;
			});
		});
	}
	
	// Contract is kind of an acquisition (establishes ownership)
	if (txn.type === 'contract') {
		return txn.playerId && txn.playerId.toString() === pid;
	}
	
	return false;
}

/**
 * Determine if a transaction is a "disposal" for a player
 */
function isDisposal(txn, playerId) {
	var pid = playerId.toString();
	
	// FA drop (player in drops)
	if (txn.type === 'fa' && txn.drops) {
		return txn.drops.some(function(d) {
			return d.playerId && d.playerId.toString() === pid;
		});
	}
	
	// Trade (player given away)
	if (txn.type === 'trade' && txn.parties) {
		return txn.parties.some(function(p) {
			return p.gives && p.gives.players && p.gives.players.some(function(pl) {
				return pl.playerId && pl.playerId.toString() === pid;
			});
		});
	}
	
	return false;
}

/**
 * Get the franchise ID associated with a transaction for a given player
 */
function getTransactionFranchise(txn, playerId) {
	var pid = playerId.toString();
	
	// Simple cases with direct franchiseId
	if (txn.franchiseId) {
		return txn.franchiseId.toString();
	}
	
	// Trade - find which party involves this player
	if (txn.type === 'trade' && txn.parties) {
		for (var i = 0; i < txn.parties.length; i++) {
			var party = txn.parties[i];
			var receives = party.receives && party.receives.players || [];
			var gives = party.gives && party.gives.players || [];
			var hasPlayer = receives.concat(gives).some(function(pl) {
				return pl.playerId && pl.playerId.toString() === pid;
			});
			if (hasPlayer && party.franchiseId) {
				return party.franchiseId.toString();
			}
		}
	}
	
	return null;
}

/**
 * Build the cuts order map for sequencing
 * Returns: { year: { 'playerName|franchiseId': rowIndex } }
 */
function buildCutsOrderMap(regimes, franchises) {
	var allCuts = cutFacts.loadAll();
	var ownerMap = cutFacts.buildOwnerMap(regimes, franchises);
	
	var orderMap = {};
	var yearCounts = {};
	
	allCuts.forEach(function(cut) {
		var year = cut.cutYear;
		if (!orderMap[year]) {
			orderMap[year] = {};
			yearCounts[year] = 0;
		}
		
		var franchiseId = cutFacts.getFranchiseId(cut.owner, ownerMap);
		if (!franchiseId) return;
		
		var key = cut.name.toLowerCase() + '|' + franchiseId.toString();
		orderMap[year][key] = yearCounts[year]++;
	});
	
	return orderMap;
}

/**
 * Get the cuts order index for a transaction
 */
function getCutsOrderIndex(txn, playerId, playerName, cutsOrderMap) {
	var year = txn.timestamp.getFullYear();
	var yearMap = cutsOrderMap[year];
	if (!yearMap) return null;
	
	var franchiseId = getTransactionFranchise(txn, playerId);
	if (!franchiseId) return null;
	
	var key = playerName.toLowerCase() + '|' + franchiseId;
	return yearMap[key] !== undefined ? yearMap[key] : null;
}

/**
 * Build a logical sequence for FA transactions involving a player on the same day.
 * Returns array of transaction IDs in logical order.
 * 
 * Logic: DROPs are sequenced by cuts order. Each ADD follows the DROP that enabled it
 * (i.e., the DROP by a different franchise that precedes it in cuts order).
 */
function buildFaSequence(faTxns, playerId, playerName, cutsOrderMap) {
	if (faTxns.length <= 1) return faTxns.map(function(t) { return t._id.toString(); });
	
	var year = faTxns[0].timestamp.getFullYear();
	
	// Categorize transactions
	var drops = [];
	var adds = [];
	
	faTxns.forEach(function(t) {
		var franchiseId = getTransactionFranchise(t, playerId);
		var cutsOrder = getCutsOrderIndex(t, playerId, playerName, cutsOrderMap);
		var info = { txn: t, franchiseId: franchiseId, cutsOrder: cutsOrder };
		
		if (isDisposal(t, playerId)) {
			drops.push(info);
		}
		if (isAcquisition(t, playerId)) {
			adds.push(info);
		}
	});
	
	// Sort drops by cuts order
	drops.sort(function(a, b) {
		if (a.cutsOrder !== null && b.cutsOrder !== null) {
			return a.cutsOrder - b.cutsOrder;
		}
		return 0;
	});
	
	// Build interleaved sequence: DROP, then ADD by next franchise
	var sequence = [];
	var usedAdds = new Set();
	
	for (var i = 0; i < drops.length; i++) {
		var drop = drops[i];
		sequence.push(drop.txn._id.toString());
		
		// Find the ADD by the next franchise in the chain
		// The next DROP (if any) tells us who picked up after this drop
		var nextDrop = drops[i + 1];
		if (nextDrop) {
			// Look for an ADD by the franchise that has the next drop
			var matchingAdd = adds.find(function(a) {
				return a.franchiseId === nextDrop.franchiseId && !usedAdds.has(a.txn._id.toString());
			});
			if (matchingAdd) {
				sequence.push(matchingAdd.txn._id.toString());
				usedAdds.add(matchingAdd.txn._id.toString());
			}
		}
	}
	
	// Add any remaining ADDs (e.g., the final pickup that wasn't dropped)
	adds.forEach(function(a) {
		if (!usedAdds.has(a.txn._id.toString())) {
			sequence.push(a.txn._id.toString());
		}
	});
	
	return sequence;
}

/**
 * Compare two transactions for sorting
 * Returns: negative if a < b, positive if a > b, 0 if equal
 */
function compareTransactions(a, b, playerId, playerName, cutsOrderMap, faSequence) {
	// First, compare by date (ignore time for initial grouping)
	var aDate = new Date(a.timestamp);
	var bDate = new Date(b.timestamp);
	aDate.setUTCHours(0, 0, 0, 0);
	bDate.setUTCHours(0, 0, 0, 0);
	var dateDiff = aDate.getTime() - bDate.getTime();
	
	if (dateDiff !== 0) {
		// Different days - use date order
		return dateDiff;
	}
	
	// Same day - need logical ordering
	
	// Rule 1: Auction before contract
	if (a.type.startsWith('auction') && b.type === 'contract') return -1;
	if (b.type.startsWith('auction') && a.type === 'contract') return 1;
	
	// Rule 2: Contract before RFA conversion
	if (a.type === 'contract' && b.type === 'rfa-rights-conversion') return -1;
	if (b.type === 'contract' && a.type === 'rfa-rights-conversion') return 1;
	
	// Rule 3: For FA transactions, use the pre-built sequence
	if (a.type === 'fa' && b.type === 'fa' && faSequence) {
		var aIdx = faSequence.indexOf(a._id.toString());
		var bIdx = faSequence.indexOf(b._id.toString());
		if (aIdx !== -1 && bIdx !== -1) {
			return aIdx - bIdx;
		}
	}
	
	// Fallback to original timestamp
	return a.timestamp.getTime() - b.timestamp.getTime();
}

/**
 * Get the franchise that receives a player in a trade
 */
function getTradeReceiver(txn, playerId) {
	var pid = playerId.toString();
	if (txn.type !== 'trade' || !txn.parties) return null;
	
	for (var i = 0; i < txn.parties.length; i++) {
		var party = txn.parties[i];
		if (party.receives && party.receives.players) {
			var hasPlayer = party.receives.players.some(function(pl) {
				return pl.playerId && pl.playerId.toString() === pid;
			});
			if (hasPlayer) {
				return party.franchiseId ? party.franchiseId.toString() : null;
			}
		}
	}
	return null;
}

/**
 * Fix cross-day ownership violations.
 * 
 * Walks through transactions and ensures that:
 * - A franchise must acquire a player before disposing of them
 * - If a disposal happens before the acquisition, move the disposal to after the acquisition
 * 
 * Only adjusts :33 (inferred) timestamps.
 */
function fixOwnershipViolations(transactions, playerId, playerName, regimes, verbose) {
	if (transactions.length <= 1) return [];
	
	var updates = [];
	var currentOwner = null;
	var ownershipHistory = []; // { franchiseId, acquiredAt, acquiredVia }
	
	// First pass: build ownership timeline from authoritative transactions
	for (var i = 0; i < transactions.length; i++) {
		var txn = transactions[i];
		var isInferred = isInferredTimestamp(txn.timestamp);
		
		// Skip inferred transactions in first pass - we're building the authoritative timeline
		if (isInferred) continue;
		
		var franchiseId = null;
		
		// Check acquisition
		if (isAcquisition(txn, playerId)) {
			if (txn.type === 'trade') {
				franchiseId = getTradeReceiver(txn, playerId);
			} else if (txn.franchiseId) {
				franchiseId = txn.franchiseId.toString();
			}
			
			if (franchiseId) {
				ownershipHistory.push({
					franchiseId: franchiseId,
					acquiredAt: txn.timestamp,
					acquiredVia: txn
				});
			}
		}
	}
	
	// Second pass: check inferred transactions against ownership timeline
	for (var i = 0; i < transactions.length; i++) {
		var txn = transactions[i];
		
		if (!isInferredTimestamp(txn.timestamp)) continue;
		if (!isDisposal(txn, playerId)) continue;
		
		// This is an inferred disposal - who is doing the disposing?
		var disposerFranchiseId = getTransactionFranchise(txn, playerId);
		if (!disposerFranchiseId) continue;
		
		// Find when this franchise acquired the player (from authoritative sources)
		var acquisition = null;
		for (var j = 0; j < ownershipHistory.length; j++) {
			if (ownershipHistory[j].franchiseId === disposerFranchiseId) {
				acquisition = ownershipHistory[j];
				break;
			}
		}
		
		if (!acquisition) continue; // No authoritative acquisition found
		
		// Check if the disposal is before the acquisition
		if (txn.timestamp.getTime() < acquisition.acquiredAt.getTime()) {
			// Violation! Move disposal to just after acquisition
			var newTime = new Date(acquisition.acquiredAt.getTime() + MINUTE_MS);
			newTime.setUTCSeconds(33);
			newTime.setUTCMilliseconds(0);
			
			var year = txn.timestamp.getFullYear();
			
			if (verbose) {
				console.log('  Ownership violation: ' + txn.type + ' by ' + 
					getRegimeName(regimes, disposerFranchiseId, year) + 
					' on ' + txn.timestamp.toISOString() + 
					' but acquired via ' + acquisition.acquiredVia.type + 
					' on ' + acquisition.acquiredAt.toISOString());
			}
			
			updates.push({
				txn: txn,
				oldTime: txn.timestamp,
				newTime: newTime,
				reason: 'ownership-violation'
			});
		}
	}
	
	// Also check inferred acquisitions (FA pickups) that should follow a disposal
	for (var i = 0; i < transactions.length; i++) {
		var txn = transactions[i];
		
		if (!isInferredTimestamp(txn.timestamp)) continue;
		if (!isAcquisition(txn, playerId)) continue;
		if (txn.type !== 'fa') continue; // Only FA pickups need this check
		
		var acquirerFranchiseId = getTransactionFranchise(txn, playerId);
		if (!acquirerFranchiseId) continue;
		
		// This FA pickup should come after someone else's disposal
		// Find the matching disposal we might have moved
		var matchingUpdate = updates.find(function(u) {
			var disposerFranchiseId = getTransactionFranchise(u.txn, playerId);
			return disposerFranchiseId !== acquirerFranchiseId && 
				u.txn.type === 'fa' && 
				isDisposal(u.txn, playerId);
		});
		
		if (matchingUpdate && txn.timestamp.getTime() <= matchingUpdate.newTime.getTime()) {
			// Move this pickup to after the disposal
			var newTime = new Date(matchingUpdate.newTime.getTime() + MINUTE_MS);
			newTime.setUTCSeconds(33);
			newTime.setUTCMilliseconds(0);
			
			updates.push({
				txn: txn,
				oldTime: txn.timestamp,
				newTime: newTime,
				reason: 'follows-disposal'
			});
		}
	}
	
	return updates;
}

/**
 * Reorder transactions for a single player
 * Only reorders transactions within the same day, preserving cross-day ordering.
 */
function reorderPlayerTransactions(transactions, playerId, playerName, cutsOrderMap, regimes, verbose) {
	if (transactions.length <= 1) return [];
	
	// Group transactions by date
	var byDate = {};
	transactions.forEach(function(t) {
		var dateKey = t.timestamp.toISOString().split('T')[0];
		if (!byDate[dateKey]) byDate[dateKey] = [];
		byDate[dateKey].push(t);
	});
	
	var allUpdates = [];
	
	// Process each date group independently
	Object.keys(byDate).forEach(function(dateKey) {
		var dayTxns = byDate[dateKey];
		if (dayTxns.length <= 1) return; // Nothing to reorder
		
		// Check if any are floating (adjustable)
		var floating = dayTxns.filter(function(t) { return isInferredTimestamp(t.timestamp); });
		if (floating.length === 0) return; // All anchored, nothing to adjust
		
		// Build FA sequence for this day's FA transactions
		var faTxns = dayTxns.filter(function(t) { return t.type === 'fa'; });
		var faSequence = null;
		if (faTxns.length > 1) {
			faSequence = buildFaSequence(faTxns, playerId, playerName, cutsOrderMap);
		}
		
		// Sort this day's transactions by logical order
		var sorted = dayTxns.slice().sort(function(a, b) {
			return compareTransactions(a, b, playerId, playerName, cutsOrderMap, faSequence);
		});
		
		// Check if this day's transactions need reordering
		var needsReorder = false;
		for (var i = 0; i < dayTxns.length; i++) {
			if (dayTxns[i]._id.toString() !== sorted[i]._id.toString()) {
				needsReorder = true;
				break;
			}
		}
		
		if (!needsReorder) return;
		
		// Find anchor (non-:33) or use earliest timestamp as base
		var anchored = dayTxns.filter(function(t) { return !isInferredTimestamp(t.timestamp); });
		var baseTime;
		if (anchored.length > 0) {
			// Use the earliest anchor as the base
			anchored.sort(function(a, b) { return a.timestamp.getTime() - b.timestamp.getTime(); });
			baseTime = anchored[0].timestamp.getTime();
		} else {
			// All floating - use earliest timestamp as base
			var times = dayTxns.map(function(t) { return t.timestamp.getTime(); });
			baseTime = Math.min.apply(null, times);
		}
		
		// Assign timestamps based on sorted order
		sorted.forEach(function(txn, idx) {
			if (!isInferredTimestamp(txn.timestamp)) return; // Don't adjust anchors
			
			var newTime = baseTime + (idx * MINUTE_MS);
			var newDate = new Date(newTime);
			newDate.setUTCSeconds(33);
			newDate.setUTCMilliseconds(0);
			
			if (newDate.getTime() !== txn.timestamp.getTime()) {
				allUpdates.push({
					txn: txn,
					oldTime: txn.timestamp,
					newTime: newDate
				});
			}
		});
	});
	
	return allUpdates;
}

async function run() {
	var args = process.argv.slice(2);
	var dryRun = args.includes('--dry-run');
	var verbose = args.includes('--verbose');
	
	if (dryRun) {
		console.log('=== DRY RUN MODE ===\n');
	}
	
	var regimes = await Regime.find({}).lean();
	var Franchise = require('../../models/Franchise');
	var franchises = await Franchise.find({}).lean();
	var players = await Player.find({}).lean();
	
	console.log('Building cuts order map...');
	var cutsOrderMap = buildCutsOrderMap(regimes, franchises);
	
	console.log('Loading all transactions...');
	var allTransactions = await Transaction.find({}).lean();
	
	// Group transactions by player
	console.log('Grouping transactions by player...');
	var txnsByPlayer = {};
	
	allTransactions.forEach(function(txn) {
		var playerIds = [];
		
		// Direct playerId
		if (txn.playerId) {
			playerIds.push(txn.playerId.toString());
		}
		
		// Players in adds
		if (txn.adds) {
			txn.adds.forEach(function(a) {
				if (a.playerId) playerIds.push(a.playerId.toString());
			});
		}
		
		// Players in drops
		if (txn.drops) {
			txn.drops.forEach(function(d) {
				if (d.playerId) playerIds.push(d.playerId.toString());
			});
		}
		
		// Players in trade parties
		if (txn.parties) {
			txn.parties.forEach(function(p) {
				if (p.receives && p.receives.players) {
					p.receives.players.forEach(function(pl) {
						if (pl.playerId) playerIds.push(pl.playerId.toString());
					});
				}
				if (p.gives && p.gives.players) {
					p.gives.players.forEach(function(pl) {
						if (pl.playerId) playerIds.push(pl.playerId.toString());
					});
				}
			});
		}
		
		playerIds.forEach(function(pid) {
			if (!txnsByPlayer[pid]) txnsByPlayer[pid] = [];
			txnsByPlayer[pid].push(txn);
		});
	});
	
	// Build player name lookup
	var playerNames = {};
	players.forEach(function(p) {
		playerNames[p._id.toString()] = p.name;
	});
	
	console.log('Checking transaction order for ' + Object.keys(txnsByPlayer).length + ' players...\n');
	
	var totalOwnershipFixes = 0;
	var totalSameDayFixes = 0;
	var playersFixed = 0;
	
	// Phase 1: Fix cross-day ownership violations
	console.log('Phase 1: Fixing cross-day ownership violations...');
	for (var playerId in txnsByPlayer) {
		var playerTxns = txnsByPlayer[playerId];
		var playerName = playerNames[playerId] || 'Unknown';
		
		// Sort by current timestamp first
		playerTxns.sort(function(a, b) {
			return a.timestamp.getTime() - b.timestamp.getTime();
		});
		
		var ownershipUpdates = fixOwnershipViolations(playerTxns, playerId, playerName, regimes, verbose);
		
		if (ownershipUpdates.length > 0) {
			totalOwnershipFixes += ownershipUpdates.length;
			
			if (verbose || dryRun) {
				console.log(playerName + ': ' + ownershipUpdates.length + ' ownership violations');
				ownershipUpdates.forEach(function(u) {
					var year = u.oldTime.getFullYear();
					var fname = getRegimeName(regimes, u.txn.franchiseId, year);
					console.log('  ' + u.txn.type + ' (' + fname + '): ' + 
						u.oldTime.toISOString() + ' → ' + u.newTime.toISOString() +
						' [' + u.reason + ']');
				});
			}
			
			if (!dryRun) {
				for (var i = 0; i < ownershipUpdates.length; i++) {
					var u = ownershipUpdates[i];
					await Transaction.updateOne(
						{ _id: u.txn._id },
						{ $set: { timestamp: u.newTime } }
					);
					// Update our in-memory copy too for phase 2
					u.txn.timestamp = u.newTime;
				}
			}
		}
	}
	
	console.log('Phase 1 complete: ' + totalOwnershipFixes + ' ownership fixes\n');
	
	// Phase 2: Fix same-day ordering issues
	console.log('Phase 2: Fixing same-day ordering issues...');
	for (var playerId in txnsByPlayer) {
		var playerTxns = txnsByPlayer[playerId];
		var playerName = playerNames[playerId] || 'Unknown';
		
		// Re-sort after phase 1 updates
		playerTxns.sort(function(a, b) {
			return a.timestamp.getTime() - b.timestamp.getTime();
		});
		
		var sameDayUpdates = reorderPlayerTransactions(playerTxns, playerId, playerName, cutsOrderMap, regimes, verbose);
		
		if (sameDayUpdates.length > 0) {
			playersFixed++;
			totalSameDayFixes += sameDayUpdates.length;
			
			if (verbose || dryRun) {
				console.log(playerName + ': ' + sameDayUpdates.length + ' same-day adjustments');
				sameDayUpdates.forEach(function(u) {
					var year = u.oldTime.getFullYear();
					var fname = getRegimeName(regimes, u.txn.franchiseId, year);
					console.log('  ' + u.txn.type + ' (' + fname + '): ' + 
						u.oldTime.toISOString() + ' → ' + u.newTime.toISOString());
				});
			}
			
			if (!dryRun) {
				for (var i = 0; i < sameDayUpdates.length; i++) {
					var u = sameDayUpdates[i];
					await Transaction.updateOne(
						{ _id: u.txn._id },
						{ $set: { timestamp: u.newTime } }
					);
				}
			}
		}
	}
	
	console.log('\n=== Summary ===');
	console.log('Ownership violation fixes: ' + totalOwnershipFixes);
	console.log('Same-day ordering fixes: ' + totalSameDayFixes);
	console.log('Total adjustments: ' + (totalOwnershipFixes + totalSameDayFixes));
	
	await mongoose.disconnect();
}

run().catch(function(err) {
	console.error(err);
	process.exit(1);
});
