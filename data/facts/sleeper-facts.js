/**
 * Sleeper Transaction Facts Parser
 * 
 * Extracts raw facts from Sleeper transaction JSON files.
 * These files contain complete transaction records from 2022+.
 */

var fs = require('fs');
var path = require('path');

var SLEEPER_DIR = path.join(__dirname, '../sleeper');

/**
 * FAAB open dates by season.
 * FAAB opens the day before NFL season starts (Wednesday before Thursday kickoff).
 * Transactions before this date are auction/draft entry, not real FAAB.
 */
var faabOpenDates = {
	2020: new Date('2020-09-09'),
	2021: new Date('2021-09-08'),
	2022: new Date('2022-09-07'),
	2023: new Date('2023-09-06'),
	2024: new Date('2024-09-04'),
	2025: new Date('2025-09-03')
};

/**
 * Parse a Sleeper transaction into a fact.
 * 
 * @param {object} tx - Sleeper transaction object
 * @returns {object} Transaction fact
 */
function parseTransaction(tx) {
	// Build adds array: { playerId, rosterId, playerInfo }
	var adds = [];
	if (tx.adds) {
		Object.keys(tx.adds).forEach(function(playerId) {
			var rosterId = tx.adds[playerId];
			var playerInfo = tx.player_map ? tx.player_map[playerId] : null;
			
			adds.push({
				playerId: playerId,
				rosterId: rosterId,
				playerName: playerInfo ? (playerInfo.first_name + ' ' + playerInfo.last_name) : null,
				position: playerInfo ? playerInfo.position : null,
				team: playerInfo ? playerInfo.team : null
			});
		});
	}
	
	// Build drops array: { playerId, rosterId, playerInfo }
	var drops = [];
	if (tx.drops) {
		Object.keys(tx.drops).forEach(function(playerId) {
			var rosterId = tx.drops[playerId];
			var playerInfo = tx.player_map ? tx.player_map[playerId] : null;
			
			drops.push({
				playerId: playerId,
				rosterId: rosterId,
				playerName: playerInfo ? (playerInfo.first_name + ' ' + playerInfo.last_name) : null,
				position: playerInfo ? playerInfo.position : null,
				team: playerInfo ? playerInfo.team : null
			});
		});
	}
	
	// Build draft picks array
	var draftPicks = [];
	if (tx.draft_picks) {
		tx.draft_picks.forEach(function(pick) {
			draftPicks.push({
				season: pick.season,
				round: pick.round,
				originalRosterId: pick.roster_id,
				previousRosterId: pick.previous_owner_id,
				newRosterId: pick.owner_id
			});
		});
	}
	
	// Build waiver budget array
	var waiverBudget = [];
	if (tx.waiver_budget) {
		tx.waiver_budget.forEach(function(wb) {
			waiverBudget.push({
				senderRosterId: wb.sender,
				receiverRosterId: wb.receiver,
				amount: wb.amount
			});
		});
	}
	
	// Use status_updated (when transaction was processed) not created (when bid was placed)
	// For waivers, created is when owner placed bid; status_updated is when FAAB ran
	var processedTime = tx.status_updated ? new Date(tx.status_updated) : new Date(tx.created);
	
	return {
		transactionId: tx.transaction_id,
		type: tx.type,
		status: tx.status,
		timestamp: processedTime,
		createdAt: new Date(tx.created),
		statusUpdated: tx.status_updated ? new Date(tx.status_updated) : null,
		leagueId: tx.league_id,
		week: tx.leg,
		rosterIds: tx.roster_ids || [],
		consenterIds: tx.consenter_ids || [],
		adds: adds,
		drops: drops,
		draftPicks: draftPicks,
		waiverBudget: waiverBudget,
		waiverBid: tx.settings ? tx.settings.waiver_bid : null,
		notes: tx.metadata ? tx.metadata.notes : null
	};
}

/**
 * Load transaction facts for a single season.
 * 
 * @param {number} season - The season year
 * @returns {Array} Array of transaction facts for that season
 */
function loadSeason(season) {
	var filename = 'transactions-' + season + '.json';
	var filepath = path.join(SLEEPER_DIR, filename);
	
	if (!fs.existsSync(filepath)) {
		return [];
	}
	
	var content = fs.readFileSync(filepath, 'utf8');
	var data = JSON.parse(content);
	
	// Handle the nested structure
	var transactions = data.data ? data.data.league_transactions_filtered : data;
	
	if (!Array.isArray(transactions)) {
		return [];
	}
	
	return transactions.map(parseTransaction);
}

/**
 * Load all available Sleeper transaction facts.
 * 
 * @returns {Array} Array of all transaction facts
 */
function loadAll() {
	var files = fs.readdirSync(SLEEPER_DIR);
	var allTransactions = [];
	
	files.forEach(function(file) {
		var match = file.match(/^transactions-(\d{4})\.json$/);
		if (match) {
			var season = parseInt(match[1]);
			var transactions = loadSeason(season);
			
			// Add season to each transaction
			transactions.forEach(function(tx) {
				tx.season = season;
			});
			
			allTransactions = allTransactions.concat(transactions);
		}
	});
	
	// Sort by timestamp
	allTransactions.sort(function(a, b) {
		return a.timestamp - b.timestamp;
	});
	
	return allTransactions;
}

/**
 * Get list of available Sleeper transaction years.
 * 
 * @returns {Array<number>} Array of years with transaction files
 */
function getAvailableYears() {
	var files = fs.readdirSync(SLEEPER_DIR);
	var years = [];
	
	files.forEach(function(file) {
		var match = file.match(/^transactions-(\d{4})\.json$/);
		if (match) {
			years.push(parseInt(match[1]));
		}
	});
	
	return years.sort();
}

/**
 * Filter transactions by type.
 * 
 * @param {Array} transactions - Array of transaction facts
 * @param {string|Array} types - Type(s) to filter for
 * @returns {Array} Filtered transactions
 */
function filterByType(transactions, types) {
	if (!Array.isArray(types)) {
		types = [types];
	}
	
	return transactions.filter(function(tx) {
		return types.indexOf(tx.type) >= 0;
	});
}

/**
 * Get trades only.
 * 
 * @param {Array} transactions - Array of transaction facts
 * @returns {Array} Trade transactions only
 */
function getTrades(transactions) {
	return filterByType(transactions, 'trade');
}

/**
 * Get waiver/FA transactions only.
 * 
 * @param {Array} transactions - Array of transaction facts
 * @returns {Array} Waiver and free agent transactions
 */
function getFATransactions(transactions) {
	return filterByType(transactions, ['waiver', 'free_agent']);
}

/**
 * Get summary statistics for transaction facts.
 * 
 * @param {Array} transactions - Array of transaction facts
 * @returns {object} Summary stats
 */
function getSummary(transactions) {
	var byType = {};
	var bySeason = {};
	
	transactions.forEach(function(tx) {
		byType[tx.type] = (byType[tx.type] || 0) + 1;
		bySeason[tx.season] = (bySeason[tx.season] || 0) + 1;
	});
	
	return {
		total: transactions.length,
		byType: byType,
		bySeason: bySeason,
		seasons: Object.keys(bySeason).sort()
	};
}

/**
 * Check if a transaction is before FAAB opened for that season.
 * 
 * @param {object} tx - Transaction fact
 * @returns {boolean} True if transaction is pre-FAAB
 */
function isPreFaab(tx) {
	if (!tx.timestamp) return false;
	var faabOpen = faabOpenDates[tx.season];
	return faabOpen && tx.timestamp < faabOpen;
}

/**
 * Filter to only real FAAB transactions (after FAAB opened).
 * 
 * @param {Array} transactions - Array of transaction facts
 * @returns {Array} Only transactions after FAAB opened
 */
function filterRealFaab(transactions) {
	return transactions.filter(function(tx) {
		return !isPreFaab(tx);
	});
}

/**
 * Find suspicious transactions (potential rollbacks or errors).
 * Looks for:
 * - Add followed quickly by drop of same player
 * - Commissioner reversals
 * 
 * @param {Array} transactions - Array of transaction facts
 * @param {object} options - { maxHours: 48 }
 * @returns {Array} Array of suspicious transactions
 */
function findSuspiciousTransactions(transactions, options) {
	options = options || { maxHours: 48 };
	var suspicious = [];
	
	// Sort by timestamp
	var sorted = transactions.slice().sort(function(a, b) {
		if (!a.timestamp) return 1;
		if (!b.timestamp) return -1;
		return a.timestamp - b.timestamp;
	});
	
	// Find quick add-then-drop patterns
	sorted.forEach(function(tx, i) {
		if (!tx.adds || tx.adds.length === 0) return;
		
		tx.adds.forEach(function(add) {
			// Look for drop of same player within maxHours
			for (var j = i + 1; j < sorted.length && j < i + 100; j++) {
				var other = sorted[j];
				if (!other.drops) continue;
				
				var matchingDrop = other.drops.find(function(d) {
					return d.playerId === add.playerId;
				});
				
				if (matchingDrop && tx.timestamp && other.timestamp) {
					var hours = (other.timestamp - tx.timestamp) / (1000 * 60 * 60);
					if (hours >= 0 && hours < options.maxHours) {
						suspicious.push({
							type: 'quick-turnaround',
							player: add.playerName,
							playerId: add.playerId,
							addTransaction: tx,
							dropTransaction: other,
							hours: Math.round(hours),
							isCommissionerReversal: other.type === 'commissioner'
						});
						break;
					}
				}
			}
		});
	});
	
	return suspicious;
}

/**
 * Check if a commissioner transaction is actually a trade transfer.
 * Trade transfers have the same player(s) in both adds and drops (moving between teams).
 * 
 * @param {object} tx - Transaction object
 * @returns {boolean} True if this is a trade transfer
 */
function isTradeTransfer(tx) {
	if (tx.type !== 'commissioner') return false;
	if (!tx.adds || !tx.drops) return false;
	if (tx.adds.length === 0 || tx.drops.length === 0) return false;
	
	// Get player IDs from adds and drops
	var addIds = tx.adds.map(function(p) { return p.playerId; }).sort();
	var dropIds = tx.drops.map(function(p) { return p.playerId; }).sort();
	
	// If all added players are also dropped, it's a trade transfer
	// (players moving from one roster to another)
	var allMatch = addIds.length === dropIds.length && 
		addIds.every(function(id, i) { return id === dropIds[i]; });
	
	return allMatch;
}

/**
 * Confidence levels for flagged commissioner actions.
 */
var Confidence = {
	ROLLBACK_LIKELY: 'rollback_likely',           // Owner add followed by commissioner drop within 72h
	TRADE_FACILITATION: 'trade_facilitation',     // Roster was in trade within 72h
	REVERSAL_PAIR: 'reversal_pair',               // Commissioner drop + add at same time (swap)
	MANUAL_ASSIST: 'manual_assist',               // Standalone drop, no recent owner activity
	UNKNOWN: 'unknown'                            // No clear pattern detected
};

/**
 * Find all in-season commissioner transactions with confidence indicators.
 * Flags every commissioner add/drop (excluding trade transfers) and assigns confidence.
 * 
 * @param {Array} transactions - Array of transaction facts
 * @returns {Array} Array of flagged commissioner actions with confidence
 */
function findCommissionerActions(transactions) {
	var WINDOW_HOURS = 72;
	
	// Filter to real FAAB (in-season) and commissioner actions (excluding trade transfers)
	var inSeason = filterRealFaab(transactions);
	var commissionerTxs = inSeason.filter(function(tx) {
		return tx.type === 'commissioner' && !isTradeTransfer(tx);
	});
	
	// Build lookup for trades and trade transfers
	var tradesByRoster = {};
	inSeason.filter(function(tx) {
		return tx.type === 'trade' || isTradeTransfer(tx);
	}).forEach(function(tx) {
		(tx.rosterIds || []).forEach(function(rid) {
			if (!tradesByRoster[rid]) tradesByRoster[rid] = [];
			tradesByRoster[rid].push(tx.timestamp);
		});
	});
	
	function wasInRecentTrade(rosterId, timestamp) {
		var trades = tradesByRoster[rosterId] || [];
		return trades.some(function(tradeTime) {
			var diff = Math.abs(timestamp - tradeTime) / (1000 * 60 * 60);
			return diff < WINDOW_HOURS;
		});
	}
	
	// Sort all non-trade transactions by timestamp for context lookup
	var sorted = inSeason.filter(function(tx) {
		return tx.type !== 'trade' && !isTradeTransfer(tx);
	}).sort(function(a, b) {
		if (!a.timestamp) return 1;
		if (!b.timestamp) return -1;
		return a.timestamp - b.timestamp;
	});
	
	// For each commissioner transaction, find context and assign confidence
	return commissionerTxs.map(function(tx) {
		var affectedPlayers = [];
		
		// Collect all players in this transaction
		(tx.adds || []).forEach(function(p) {
			affectedPlayers.push({ name: p.playerName, id: p.playerId, position: p.position, action: 'add' });
		});
		(tx.drops || []).forEach(function(p) {
			affectedPlayers.push({ name: p.playerName, id: p.playerId, position: p.position, action: 'drop' });
		});
		
		// Find recent transactions for each affected player (within 72h window)
		var context = affectedPlayers.map(function(player) {
			var recentTxs = sorted.filter(function(otherTx) {
				if (otherTx.transactionId === tx.transactionId) return false;
				if (!otherTx.timestamp || !tx.timestamp) return false;
				var hoursDiff = (tx.timestamp - otherTx.timestamp) / (1000 * 60 * 60);
				if (hoursDiff < 0 || hoursDiff > WINDOW_HOURS) return false;
				
				var inAdds = (otherTx.adds || []).some(function(p) { return p.playerId === player.id; });
				var inDrops = (otherTx.drops || []).some(function(p) { return p.playerId === player.id; });
				return inAdds || inDrops;
			});
			
			return {
				player: player.name,
				playerId: player.id,
				position: player.position,
				commissionerAction: player.action,
				recentTransactions: recentTxs.map(function(t) {
					var playerAction = null;
					if ((t.adds || []).some(function(p) { return p.playerId === player.id; })) {
						playerAction = 'added';
					} else if ((t.drops || []).some(function(p) { return p.playerId === player.id; })) {
						playerAction = 'dropped';
					}
					var hoursDiff = Math.round((tx.timestamp - t.timestamp) / (1000 * 60 * 60));
					return {
						transactionId: t.transactionId,
						timestamp: t.timestamp,
						type: t.type,
						rosterIds: t.rosterIds,
						playerAction: playerAction,
						hoursAgo: hoursDiff
					};
				})
			};
		});
		
		// Determine confidence level
		var rosterId = tx.rosterIds[0];
		var confidence = Confidence.UNKNOWN;
		var confidenceReason = null;
		
		// Check for reversal pair (commissioner actions within 5 minutes of each other)
		var hasMatchingSwap = commissionerTxs.some(function(other) {
			if (other.transactionId === tx.transactionId) return false;
			if (other.rosterIds[0] !== rosterId) return false; // Same roster
			
			// Within 5 minutes
			var timeDiff = Math.abs(tx.timestamp - other.timestamp) / (1000 * 60);
			if (timeDiff > 5) return false;
			
			// Check if one has adds and the other has drops (complementary actions)
			var thisHasAdds = tx.adds && tx.adds.length > 0 && (!tx.drops || tx.drops.length === 0);
			var thisHasDrops = tx.drops && tx.drops.length > 0 && (!tx.adds || tx.adds.length === 0);
			var otherHasAdds = other.adds && other.adds.length > 0 && (!other.drops || other.drops.length === 0);
			var otherHasDrops = other.drops && other.drops.length > 0 && (!other.adds || other.adds.length === 0);
			
			return (thisHasAdds && otherHasDrops) || (thisHasDrops && otherHasAdds);
		});
		
		if (hasMatchingSwap) {
			confidence = Confidence.REVERSAL_PAIR;
			confidenceReason = 'Commissioner add and drop at same time (swap/rollback)';
		} else if (wasInRecentTrade(rosterId, tx.timestamp)) {
			confidence = Confidence.TRADE_FACILITATION;
			confidenceReason = 'Roster involved in trade within 72h';
		} else {
			// Check for rollback pattern: owner action reversed by commissioner
			var hasReversalPattern = context.some(function(c) {
				return c.recentTransactions.some(function(t) {
					if (t.type === 'commissioner') return false;
					if (c.commissionerAction === 'drop' && t.playerAction === 'added') return true;
					if (c.commissionerAction === 'add' && t.playerAction === 'dropped') return true;
					return false;
				});
			});
			
			if (hasReversalPattern) {
				confidence = Confidence.ROLLBACK_LIKELY;
				confidenceReason = 'Owner transaction reversed by commissioner';
			} else if (context.every(function(c) { return c.recentTransactions.length === 0; })) {
				confidence = Confidence.MANUAL_ASSIST;
				confidenceReason = 'No recent owner activity for affected players';
			}
		}
		
		return {
			transactionId: tx.transactionId,
			timestamp: tx.timestamp,
			season: tx.season,
			rosterIds: tx.rosterIds,
			adds: tx.adds,
			drops: tx.drops,
			context: context,
			confidence: confidence,
			confidenceReason: confidenceReason
		};
	});
}

module.exports = {
	// Constants
	faabOpenDates: faabOpenDates,
	Confidence: Confidence,
	
	// Core
	parseTransaction: parseTransaction,
	loadSeason: loadSeason,
	loadAll: loadAll,
	getAvailableYears: getAvailableYears,
	
	// Filtering
	filterByType: filterByType,
	getTrades: getTrades,
	getFATransactions: getFATransactions,
	isPreFaab: isPreFaab,
	filterRealFaab: filterRealFaab,
	
	// Analysis
	getSummary: getSummary,
	findSuspiciousTransactions: findSuspiciousTransactions,
	findCommissionerActions: findCommissionerActions,
	isTradeTransfer: isTradeTransfer
};
