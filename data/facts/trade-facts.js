/**
 * Trade Facts
 * 
 * Loads trade data from trades.json (the canonical source).
 * Contract strings are preserved as-is (e.g., "2019", "09/11", "FA").
 */

var fs = require('fs');
var path = require('path');

// Local cache directory
var TRADES_DIR = path.join(__dirname, '../trades');

/**
 * Get all unique contract strings from trade facts (for analysis).
 * 
 * @param {Array} tradeFacts - Array of trade facts
 * @returns {Array} Unique contract strings with counts
 */
function getContractStrings(tradeFacts) {
	var counts = {};
	
	tradeFacts.forEach(function(trade) {
		trade.parties.forEach(function(party) {
			party.players.forEach(function(player) {
				var str = player.contractStr;
				counts[str] = (counts[str] || 0) + 1;
			});
		});
	});
	
	return Object.keys(counts)
		.map(function(str) { return { contractStr: str, count: counts[str] }; })
		.sort(function(a, b) { return b.count - a.count; });
}

/**
 * Check if trades.json exists.
 * 
 * @returns {boolean} True if file exists
 */
function checkAvailability() {
	var cacheFile = path.join(TRADES_DIR, 'trades.json');
	return fs.existsSync(cacheFile);
}

/**
 * Load trades data from trades.json.
 * 
 * @returns {Array} Array of trade facts, or empty array if file doesn't exist
 */
function loadAll() {
	var cacheFile = path.join(TRADES_DIR, 'trades.json');
	
	if (!fs.existsSync(cacheFile)) {
		return [];
	}
	
	var raw = fs.readFileSync(cacheFile, 'utf8');
	var trades = JSON.parse(raw);
	
	// Convert date strings back to Date objects
	trades.forEach(function(trade) {
		if (trade.date) {
			trade.date = new Date(trade.date);
		}
	});
	
	return trades;
}

/**
 * Save trades data to trades.json.
 * 
 * @param {Array} tradeFacts - Array of trade facts to save
 */
function saveCache(tradeFacts) {
	var cacheFile = path.join(TRADES_DIR, 'trades.json');
	
	// Ensure directory exists
	if (!fs.existsSync(TRADES_DIR)) {
		fs.mkdirSync(TRADES_DIR, { recursive: true });
	}
	
	fs.writeFileSync(cacheFile, JSON.stringify(tradeFacts, null, 2));
}

module.exports = {
	checkAvailability: checkAvailability,
	loadAll: loadAll,
	saveCache: saveCache,
	getContractStrings: getContractStrings
};
