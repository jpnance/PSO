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
	
	return {
		transactionId: tx.transaction_id,
		type: tx.type,
		status: tx.status,
		timestamp: new Date(tx.created),
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

module.exports = {
	// Constants
	faabOpenDates: faabOpenDates,
	
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
	findSuspiciousTransactions: findSuspiciousTransactions
};
