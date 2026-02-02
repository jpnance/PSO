/**
 * Trade Facts Parser
 * 
 * Extracts raw facts from WordPress trade posts without inference.
 * Contract strings are preserved as-is (e.g., "2019", "09/11", "FA").
 * Supports both network fetching and local cache loading.
 */

var fs = require('fs');
var path = require('path');
var request = require('superagent');
var PSO = require('../../config/pso.js');

// Local cache directory
var TRADES_DIR = path.join(__dirname, '../trades');

// Decode common HTML entities
function decodeHtmlEntities(str) {
	if (!str) return str;
	return str
		.replace(/&#8217;/g, "'")
		.replace(/&#8216;/g, "'")
		.replace(/&#8220;/g, '"')
		.replace(/&#8221;/g, '"')
		.replace(/&#038;/g, '&')
		.replace(/&#39;/g, "'")
		.replace(/&amp;/g, '&')
		.replace(/&apos;/g, "'")
		.replace(/&quot;/g, '"')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>');
}

// Extract ESPN ID from player URL
function extractEspnId(href) {
	if (!href) return null;
	var match = href.match(/\/id\/(\d+)\//) || href.match(/playerId=(\d+)/);
	return match ? match[1] : null;
}

/**
 * Parse a single trade post's HTML content into raw facts.
 * 
 * @param {string} html - The trade post HTML content
 * @param {Date} tradeDate - The date of the trade post
 * @returns {object} Parsed trade fact with parties array
 */
function parseTradeContent(html, tradeDate) {
	var trade = {
		parties: []
	};

	// Split by <strong> tags to find each party's section
	var sections = html.split(/<strong>/);

	for (var i = 1; i < sections.length; i++) {
		var section = sections[i];

		// Extract owner name (everything before </strong>)
		var ownerMatch = section.match(/^([^<]+)<\/strong>/);
		if (!ownerMatch) continue;

		var ownerName = ownerMatch[1].trim();
		var party = {
			owner: ownerName,
			players: [],
			picks: [],
			cash: [],
			rfaRights: []
		};

		// Extract list items
		var listItems = section.match(/<li>.*?<\/li>/g) || [];

		for (var j = 0; j < listItems.length; j++) {
			var item = listItems[j];

			// Player with link: <a href="...">Player Name</a> ($salary, contractStr)
			var playerMatch = item.match(/<a[^>]*>([^<]+)<\/a>\s*\((\$?\d+),?\s*([^)]+)\)/);
			if (playerMatch) {
				var hrefMatch = item.match(/<a[^>]*\shref="([^"]*)"[^>]*>/);
				var href = hrefMatch ? hrefMatch[1] : null;

				party.players.push({
					name: decodeHtmlEntities(playerMatch[1].trim()),
					espnId: extractEspnId(href),
					salary: parseInt(playerMatch[2].replace('$', '')),
					contractStr: playerMatch[3].trim()
				});
				continue;
			}

			// Player without link (plain text)
			var plainPlayerMatch = item.match(/<li>\s*([A-Za-z][A-Za-z\.\s'-]+[A-Za-z])\s*\((\$?\d+),?\s*([^)]+)\)/);
			if (plainPlayerMatch) {
				party.players.push({
					name: decodeHtmlEntities(plainPlayerMatch[1].trim()),
					espnId: null,
					salary: parseInt(plainPlayerMatch[2].replace('$', '')),
					contractStr: plainPlayerMatch[3].trim()
				});
				continue;
			}

			// Cash: $X from Owner in Year
			var cashMatch = item.match(/\$(\d+)\s+from\s+([^\s]+(?:\/[^\s]+)?)\s+in\s+(\d+)/i);
			if (cashMatch) {
				party.cash.push({
					amount: parseInt(cashMatch[1]),
					fromOwner: cashMatch[2],
					season: parseInt(cashMatch[3])
				});
				continue;
			}

			// Cash without "from" (old format): $X in Year
			var cashNoFromMatch = item.match(/\$(\d+)\s+in\s+(\d+)/i);
			if (cashNoFromMatch) {
				party.cash.push({
					amount: parseInt(cashNoFromMatch[1]),
					fromOwner: null,
					season: parseInt(cashNoFromMatch[2])
				});
				continue;
			}

			// Pick: Xth round [draft] pick from Owner in Year
			var pickMatch = item.match(/(\d+)(?:st|nd|rd|th)\s+round\s+(?:draft\s+)?pick\s+from\s+([^\s(]+(?:\/[^\s(]+)?)\s+in\s+(\d+)/i);
			if (pickMatch) {
				party.picks.push({
					round: parseInt(pickMatch[1]),
					fromOwner: pickMatch[2],
					season: parseInt(pickMatch[3]),
					viaOwner: null
				});
				continue;
			}

			// Pick with "via" notation
			var pickViaMatch = item.match(/(\d+)(?:st|nd|rd|th)\s+round\s+(?:draft\s+)?pick\s+from\s+([^\s(]+(?:\/[^\s(]+)?)\s*\(via\s+([^)]+)\)\s+in\s+(\d+)/i);
			if (pickViaMatch) {
				party.picks.push({
					round: parseInt(pickViaMatch[1]),
					fromOwner: pickViaMatch[2],
					viaOwner: pickViaMatch[3],
					season: parseInt(pickViaMatch[4])
				});
				continue;
			}

			// Pick with year before via
			var pickYearBeforeViaMatch = item.match(/(\d+)(?:st|nd|rd|th)\s+round\s+(?:draft\s+)?pick\s+from\s+([^\s(]+(?:\/[^\s(]+)?)\s+in\s+(\d+)\s*\(via\s+([^)]+)\)/i);
			if (pickYearBeforeViaMatch) {
				party.picks.push({
					round: parseInt(pickYearBeforeViaMatch[1]),
					fromOwner: pickYearBeforeViaMatch[2],
					season: parseInt(pickYearBeforeViaMatch[3]),
					viaOwner: pickYearBeforeViaMatch[4]
				});
				continue;
			}

			// Old format pick without year
			var pickNoYearViaMatch = item.match(/(\d+)(?:st|nd|rd|th)\s+round\s+(?:draft\s+)?pick\s+from\s+([^\s(]+(?:\/[^\s(]+)?)\s*\(via\s+([^)]+)\)$/i);
			if (pickNoYearViaMatch) {
				party.picks.push({
					round: parseInt(pickNoYearViaMatch[1]),
					fromOwner: pickNoYearViaMatch[2],
					viaOwner: pickNoYearViaMatch[3],
					season: null
				});
				continue;
			}

			// RFA rights
			var rfaMatch = item.match(/<a[^>]*>([^<]+)<\/a>\s*\(RFA rights\)/i) || 
			               item.match(/<li>\s*([A-Za-z][A-Za-z\.\s'&#;0-9-]+[A-Za-z])\s*\(RFA rights\)/i);
			if (rfaMatch) {
				var rfaHrefMatch = item.match(/<a[^>]*\shref="([^"]*)"[^>]*>/);
				var rfaHref = rfaHrefMatch ? rfaHrefMatch[1] : null;

				party.rfaRights.push({
					name: decodeHtmlEntities(rfaMatch[1].trim().replace(/&#8217;/g, "'")),
					espnId: extractEspnId(rfaHref)
				});
				continue;
			}

			// Nothing: explicitly traded nothing (skip silently)
			if (item.match(/Nothing/i)) {
				continue;
			}

			// Unrecognized item - could log for debugging
			// console.log('Unrecognized trade item:', item.replace(/<[^>]+>/g, ''));
		}

		trade.parties.push(party);
	}

	return trade;
}

/**
 * Fetch all trade posts from WordPress API and parse into facts.
 * 
 * @returns {Promise<Array>} Array of trade facts
 */
async function fetchAll() {
	var allTrades = [];
	var page = 1;
	var hasMore = true;

	while (hasMore) {
		var response = await request
			.get('https://public-api.wordpress.com/rest/v1.1/sites/thedynastyleague.wordpress.com/posts')
			.query({ category: 'trades', number: 100, page: page });

		var posts = response.body.posts;

		if (posts.length === 0) {
			hasMore = false;
		} else {
			for (var i = 0; i < posts.length; i++) {
				var post = posts[i];
				var tradeNumberMatch = post.title.match(/Trade #(\d+)/);
				var tradeNumber = tradeNumberMatch ? parseInt(tradeNumberMatch[1]) : null;
				var tradeDate = new Date(post.date);

				var parsed = parseTradeContent(post.content, tradeDate);
				
				allTrades.push({
					tradeId: tradeNumber,
					date: tradeDate,
					url: post.URL,
					parties: parsed.parties
				});
			}
			page++;
		}
	}

	// Sort by trade number
	allTrades.sort(function(a, b) { 
		return (a.tradeId || 0) - (b.tradeId || 0); 
	});

	return allTrades;
}

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
 * Check if local trades cache exists.
 * 
 * @returns {boolean} True if cache file exists
 */
function checkAvailability() {
	var cacheFile = path.join(TRADES_DIR, 'trades.json');
	return fs.existsSync(cacheFile);
}

/**
 * Load trades data from local cache.
 * 
 * @returns {Array} Array of trade facts from cache, or empty array if not cached
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
 * Save trades data to local cache.
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

/**
 * Fetch all trades and save to local cache.
 * 
 * @returns {Promise<Array>} Array of all trade facts
 */
async function fetchAndCache() {
	var trades = await fetchAll();
	saveCache(trades);
	console.log('    Cached ' + trades.length + ' trades to ' + path.join(TRADES_DIR, 'trades.json'));
	return trades;
}

module.exports = {
	// Network fetching
	parseTradeContent: parseTradeContent,
	fetchAll: fetchAll,
	fetchAndCache: fetchAndCache,
	
	// Local cache
	checkAvailability: checkAvailability,
	loadAll: loadAll,
	saveCache: saveCache,
	
	// Analysis
	getContractStrings: getContractStrings,
	decodeHtmlEntities: decodeHtmlEntities,
	extractEspnId: extractEspnId
};
