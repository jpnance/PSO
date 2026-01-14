// Shared view helpers - available in all Pug templates via app.locals

var formatPickHelpers = require('./formatPick');

/**
 * Format a number as currency with $ sign
 * @param {number} n
 * @param {Object} options
 * @param {string} options.sign - '+' for explicit plus, '-' for explicit minus, 'auto' for value-based
 * @returns {string} e.g. "$1,234", "+$500", "-$163"
 */
function formatMoney(n, options) {
	if (n == null) return '';
	var absValue = Math.abs(n).toLocaleString();
	
	if (!options || !options.sign) {
		return '$' + absValue;
	}
	
	if (options.sign === '+') {
		return '+$' + absValue;
	}
	
	if (options.sign === '-') {
		return '-$' + absValue;
	}
	
	if (options.sign === 'auto') {
		if (n > 0) return '+$' + absValue;
		if (n < 0) return '-$' + absValue;
		return '$0';
	}
	
	return '$' + absValue;
}

/**
 * Format a win-loss-tie record
 * @param {number} w - wins
 * @param {number} l - losses
 * @param {number} t - ties (optional)
 * @returns {string} e.g. "10-5" or "10-5-1"
 */
function formatRecord(w, l, t) {
	if (t && t > 0) {
		return w + '-' + l + '-' + t;
	}
	return w + '-' + l;
}

/**
 * Format points with 2 decimal places
 * @param {number} n
 * @returns {string} e.g. "1,234.56"
 */
function formatPoints(n) {
	if (n == null) return '';
	return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Format a score (alias for formatPoints, for semantic clarity)
 * @param {number} score
 * @returns {string}
 */
function formatScore(score) {
	if (score == null) return '';
	return score.toFixed(2);
}

/**
 * Get ordinal suffix for a number
 * @param {number} n
 * @returns {string} e.g. "1st", "2nd", "3rd", "4th"
 */
function ordinal(n) {
	var s = ['th', 'st', 'nd', 'rd'];
	var v = n % 100;
	return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/**
 * Format contract years display (zero-padded)
 * @param {number} start - start year (e.g. 2023)
 * @param {number} end - end year (e.g. 2026)
 * @returns {string} e.g. "23/26", "FA/26", or "unsigned" if no end year
 */
function formatContractYears(start, end) {
	if (!end) {
		return 'unsigned';
	}
	if (start) {
		return String(start % 100).padStart(2, '0') + '/' + String(end % 100).padStart(2, '0');
	}
	return 'FA/' + String(end % 100).padStart(2, '0');
}

/**
 * Format full contract display with salary and years
 * @param {number} salary - salary amount
 * @param {number} start - start year (e.g. 2023)
 * @param {number} end - end year (e.g. 2026)
 * @returns {string} e.g. "$45 · 24/26"
 */
function formatContractDisplay(salary, start, end) {
	var years = formatContractYears(start, end);
	return formatMoney(salary) + ' · ' + years;
}

/**
 * Format a date as YYYY-MM-DD (for form inputs)
 * @param {Date|string} d
 * @returns {string}
 */
function formatDateISO(d) {
	if (!d) return '';
	var date = new Date(d);
	return date.toISOString().split('T')[0];
}

/**
 * Get CSS class for a budget delta (positive = good, negative = bad)
 * @param {number} delta
 * @returns {string} 'text-success', 'text-danger', or 'text-muted'
 */
function deltaClass(delta) {
	if (delta > 0) return 'text-success';
	if (delta < 0) return 'text-danger';
	return 'text-muted';
}

/**
 * Standard position order for sorting
 */
var POSITION_ORDER = ['QB', 'RB', 'WR', 'TE', 'DL', 'LB', 'DB', 'K'];

/**
 * Sort positions according to standard order
 * @param {string[]} positions
 * @returns {string[]}
 */
function sortedPositions(positions) {
	return positions.slice().sort(function(a, b) {
		var idxA = POSITION_ORDER.indexOf(a);
		var idxB = POSITION_ORDER.indexOf(b);
		return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB);
	});
}

/**
 * Get the minimum position index for sorting players by position
 * @param {string[]} positions
 * @returns {number} Index in POSITION_ORDER (999 if not found or empty)
 */
function getPositionIndex(positions) {
	if (!positions || positions.length === 0) return 999;
	return Math.min.apply(null, positions.map(function(p) {
		var idx = POSITION_ORDER.indexOf(p);
		return idx === -1 ? 999 : idx;
	}));
}

/**
 * Get a player's position key for grouping (e.g. "WR" or "RB/WR")
 * @param {Object} player - player with positions array
 * @returns {string}
 */
function getPositionKey(player) {
	if (!player.positions || player.positions.length === 0) return '';
	return sortedPositions(player.positions).join('/');
}

/**
 * Shorten a player name to first initial + last name
 * @param {string} name - Full name like "Ja'Marr Chase"
 * @returns {string} - Shortened like "J. Chase"
 */
function shortenPlayerName(name) {
	if (!name) return '';
	var parts = name.trim().split(/\s+/);
	if (parts.length === 1) return name;
	var firstInitial = parts[0].charAt(0) + '.';
	var lastName = parts[parts.length - 1];
	return firstInitial + ' ' + lastName;
}

/**
 * Format a list with commas (terse, no "and")
 * @param {string[]} items - Array of strings
 * @returns {string} - "A, B, C"
 */
function oxfordJoin(items) {
	if (!items || items.length === 0) return '';
	if (items.length === 1) return items[0];
	if (items.length === 2) return items[0] + ' and ' + items[1];
	return items.slice(0, -1).join(', ') + ', and ' + items[items.length - 1];
}

/**
 * Convert number to word for small quantities
 * @param {number} n
 * @returns {string}
 */
function numberToWord(n) {
	var words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
	return n <= 10 ? words[n] : String(n);
}

/**
 * Group picks by round and format as "two 1sts" or "1st, 2nd, and 3rd"
 * @param {Object[]} picks - Array of pick objects with round info
 * @returns {string} - Formatted pick summary
 */
function formatPicksGrouped(picks) {
	if (!picks || picks.length === 0) return '';
	
	// Extract round numbers from picks
	var rounds = [];
	for (var i = 0; i < picks.length; i++) {
		var round = null;
		// Try to extract round from pickMain like "1st round pick" or "Pick 2.04"
		if (picks[i].pickMain) {
			var match = picks[i].pickMain.match(/(\d+)(?:st|nd|rd|th)/i);
			if (match) {
				round = parseInt(match[1], 10);
			} else {
				// Try "Pick X.XX" format
				match = picks[i].pickMain.match(/Pick\s+(\d+)\./i);
				if (match) {
					round = parseInt(match[1], 10);
				}
			}
		}
		if (round) rounds.push(round);
	}
	
	if (rounds.length === 0) {
		// Fallback: just count picks
		return picks.length === 1 ? 'a pick' : numberToWord(picks.length) + ' picks';
	}
	
	// Count picks per round
	var roundCounts = {};
	for (var i = 0; i < rounds.length; i++) {
		var r = rounds[i];
		roundCounts[r] = (roundCounts[r] || 0) + 1;
	}
	
	var roundNums = Object.keys(roundCounts).map(Number).sort(function(a, b) { return a - b; });
	
	// Check if all picks are same round
	if (roundNums.length === 1) {
		var count = roundCounts[roundNums[0]];
		var ord = ordinal(roundNums[0]);
		// "1st" or "two 1sts"
		if (count === 1) {
			return ord;
		}
		return numberToWord(count) + ' ' + ord + 's';
	}
	
	// Check if all counts are 1 (can list individually)
	var allSingles = roundNums.every(function(r) { return roundCounts[r] === 1; });
	if (allSingles) {
		// "1st, 2nd, 3rd"
		var ordinals = roundNums.map(function(r) { return ordinal(r); });
		return ordinals.join(', ');
	}
	
	// Mixed: "two 1sts, 2nd, three 3rds"
	var parts = [];
	for (var i = 0; i < roundNums.length; i++) {
		var r = roundNums[i];
		var count = roundCounts[r];
		var ord = ordinal(r);
		if (count === 1) {
			parts.push(ord);
		} else {
			parts.push(numberToWord(count) + ' ' + ord + 's');
		}
	}
	return parts.join(', ');
}

/**
 * Generate OG description for a single party's assets
 * @param {Object} party - party object with assets array and franchiseName
 * @param {Object} options - { shorten: boolean } to use shortened player names
 * @returns {string} e.g. "Will Levis, two 1sts, and $15 in 2025"
 */
function formatPartyAssets(party, options) {
	options = options || {};
	if (!party || !party.assets || party.assets.length === 0) {
		return 'Nothing';
	}
	
	var players = [];
	var rfas = [];
	var picks = [];
	var cashItems = [];
	
	for (var i = 0; i < party.assets.length; i++) {
		var asset = party.assets[i];
		
		if (asset.type === 'nothing') {
			return 'Nothing';
		} else if (asset.type === 'player') {
			var name = options.shorten ? shortenPlayerName(asset.playerName) : asset.playerName;
			players.push(name);
		} else if (asset.type === 'rfa') {
			var name = options.shorten ? shortenPlayerName(asset.playerName) : asset.playerName;
			rfas.push(name + ' (RFA)');
		} else if (asset.type === 'pick') {
			picks.push(asset);
		} else if (asset.type === 'cash') {
			// Format as "$500 in 2025"
			var cashText = asset.cashMain || '';
			if (asset.cashContext) {
				var seasonMatch = asset.cashContext.match(/in\s+(\d{4})/);
				if (seasonMatch) {
					cashText += ' in ' + seasonMatch[1];
				}
			}
			cashItems.push(cashText);
		}
	}
	
	var items = [];
	
	// Add players
	items = items.concat(players);
	
	// Add RFAs
	items = items.concat(rfas);
	
	// Add picks (grouped)
	if (picks.length > 0) {
		items.push(formatPicksGrouped(picks));
	}
	
	// Add cash
	items = items.concat(cashItems);
	
	return oxfordJoin(items) || 'Nothing';
}

/**
 * Generate full OG description for a trade
 * Format: "Patrick: Will Levis, two 1sts, and $15 in 2025 • Schexes: Ja'Marr Chase and one 3rd"
 * @param {Array} parties - array of party objects with franchiseName and assets
 * @param {Object} options - { maxLength: number } for truncation with fallback
 * @returns {string}
 */
function tradeOgDescription(parties, options) {
	options = options || {};
	var maxLength = options.maxLength || 155;
	
	if (!parties || parties.length === 0) {
		return 'Trade on Primetime Soap Operas';
	}
	
	// Try full names first
	var parts = [];
	for (var i = 0; i < parties.length; i++) {
		var party = parties[i];
		var assets = formatPartyAssets(party, { shorten: false });
		parts.push(party.franchiseName + ': ' + assets);
	}
	var result = parts.join(' ↔ ');
	
	// If too long, try shortened player names
	if (result.length > maxLength) {
		parts = [];
		for (var i = 0; i < parties.length; i++) {
			var party = parties[i];
			var assets = formatPartyAssets(party, { shorten: true });
			parts.push(party.franchiseName + ': ' + assets);
		}
		result = parts.join(' ↔ ');
	}
	
	return result;
}

/**
 * Generate a summary of trade assets for a party (simple version for backward compat)
 * @param {Object} party - party object with assets array
 * @returns {string} e.g. "Josh Allen, 1st round pick" or "Nothing"
 */
function summarizeTradeAssets(party) {
	return formatPartyAssets(party, { shorten: false });
}

/**
 * Extract last name from a full name
 * @param {string} name - full name like "Josh Allen" or "Amon-Ra St. Brown"
 * @returns {string} last name
 */
function getLastName(name) {
	if (!name) return 'Unknown';
	var parts = name.trim().split(/\s+/);
	if (parts.length === 1) return parts[0];
	// Return everything after the first name (handles "St. Brown", "Jones Jr.", etc.)
	return parts.slice(1).join(' ');
}

/**
 * Collect qualifying assets from a party for OG title
 * Includes: all players (last name), 1st/2nd round picks (grouped), summed cash
 * If party has only one asset, always include it regardless of type
 * @param {Object} party - party object with assets array
 * @param {number} auctionSeason - the season for current/next auction (for cash filtering)
 * @param {number} tradeYear - the year the trade was made (for pick number display)
 * @returns {Array} array of formatted strings
 */
function collectTitleAssets(party, auctionSeason, tradeYear) {
	if (!party || !party.assets || party.assets.length === 0) return ['Nothing'];
	
	// If only one asset, always include it
	var forceInclude = party.assets.length === 1;
	
	var players = [];
	var picks = []; // { round, season, pickNumber }
	var cashTotal = 0;
	var hasNothing = false;
	
	for (var i = 0; i < party.assets.length; i++) {
		var asset = party.assets[i];
		
		if (asset.type === 'player' || asset.type === 'rfa') {
			players.push({ name: getLastName(asset.playerName), salary: asset.salary || 0 });
		} else if (asset.type === 'pick') {
			if (forceInclude || asset.round <= 2) {
				picks.push({ round: asset.round || 1, season: asset.season, pickNumber: asset.pickNumber });
			}
		} else if (asset.type === 'cash') {
			var season = asset.season || auctionSeason;
			if (forceInclude || season >= auctionSeason) {
				cashTotal += asset.amount || 0;
			}
		} else if (asset.type === 'nothing') {
			hasNothing = true;
		}
	}
	
	var items = [];
	
	// Players sorted by salary desc
	players.sort(function(a, b) { return b.salary - a.salary; });
	for (var i = 0; i < players.length; i++) {
		items.push(players[i].name);
	}
	
	// Picks - use pickNumber format for same-year picks with known numbers
	// Separate numbered picks from grouped picks
	var numberedPicks = [];
	var picksByRound = {};
	for (var i = 0; i < picks.length; i++) {
		var pick = picks[i];
		// Use "1.04" format if pick is for same year as trade and pickNumber is known
		if (pick.season === tradeYear && pick.pickNumber) {
			numberedPicks.push(pick);
		} else {
			picksByRound[pick.round] = (picksByRound[pick.round] || 0) + 1;
		}
	}
	
	// Sort numbered picks by pickNumber
	numberedPicks.sort(function(a, b) { return a.pickNumber - b.pickNumber; });
	for (var i = 0; i < numberedPicks.length; i++) {
		var pick = numberedPicks[i];
		var teamsPerRound = (pick.season <= 2011) ? 10 : 12;
		items.push(formatPickHelpers.formatPickNumber(pick.pickNumber, teamsPerRound));
	}
	
	// Add grouped picks (sorted by round)
	var rounds = Object.keys(picksByRound).map(Number).sort(function(a, b) { return a - b; });
	for (var i = 0; i < rounds.length; i++) {
		var round = rounds[i];
		var count = picksByRound[round];
		var roundOrd = ordinal(round);
		if (count === 1) {
			items.push(roundOrd);
		} else {
			items.push(numberToWord(count) + ' ' + roundOrd + 's');
		}
	}
	
	// Summed cash
	if (cashTotal > 0) {
		items.push('$' + cashTotal);
	}
	
	// Handle nothing
	if (hasNothing && items.length === 0) {
		items.push('Nothing');
	}
	
	return items.length > 0 ? items : ['Nothing'];
}

/**
 * Generate OG title for a trade
 * Two-party: "Allen and Brown for Smith, a 1st, and $50"
 * Multi-party: lists each party's assets separated by commas
 * For draft status, prefix with "Fake Trade: "
 * @param {Array} parties - array of party objects with assets
 * @param {Object} options - { status, auctionSeason }
 * @returns {string}
 */
function tradeOgTitle(parties, options) {
	options = options || {};
	var auctionSeason = options.auctionSeason || new Date().getFullYear();
	var tradeYear = options.tradeYear || auctionSeason;
	var status = options.status || 'pending';
	
	if (!parties || parties.length < 2) {
		return status === 'draft' ? 'Fake Trade' : 'Trade';
	}
	
	var title;
	
	if (parties.length === 2) {
		// Two-party trade ordering:
		// 1. Cash-only side always goes second
		// 2. Fewer notable assets goes first
		// 3. Tie-breaker: side with players goes first
		var items0 = collectTitleAssets(parties[0], auctionSeason, tradeYear);
		var items1 = collectTitleAssets(parties[1], auctionSeason, tradeYear);
		
		// Check if all items are cash (start with $) or nothing
		function isCashOnly(items) {
			if (!items || items.length === 0) return false;
			return items.every(function(item) { return item.startsWith('$'); });
		}
		
		function isNothing(items) {
			return items && items.length === 1 && items[0] === 'Nothing';
		}
		
		// Check if items contain a player (not cash, not picks, not nothing)
		function hasPlayer(items) {
			if (!items || items.length === 0) return false;
			return items.some(function(item) {
				// Exclude: Nothing, cash ($...), ordinals (1st, 2nd, etc.), grouped picks (two 1sts, etc.)
				return item !== 'Nothing' && 
					!item.startsWith('$') && 
					!/^\d+(st|nd|rd|th)$/.test(item) &&
					!/^[a-z]+ \d+(st|nd|rd|th)s$/.test(item);
			});
		}
		
		var nothing0 = isNothing(items0);
		var nothing1 = isNothing(items1);
		var cashOnly0 = isCashOnly(items0);
		var cashOnly1 = isCashOnly(items1);
		var hasPlayer0 = hasPlayer(items0);
		var hasPlayer1 = hasPlayer(items1);
		
		var firstItems, secondItems;
		
		// Nothing always goes second
		if (nothing0 && !nothing1) {
			firstItems = items1;
			secondItems = items0;
		} else if (nothing1 && !nothing0) {
			firstItems = items0;
			secondItems = items1;
		// Cash-only sides go second
		} else if (cashOnly0 && !cashOnly1) {
			firstItems = items1;
			secondItems = items0;
		} else if (cashOnly1 && !cashOnly0) {
			firstItems = items0;
			secondItems = items1;
		} else if (items0.length < items1.length) {
			// Fewer assets first
			firstItems = items0;
			secondItems = items1;
		} else if (items1.length < items0.length) {
			firstItems = items1;
			secondItems = items0;
		} else {
			// Same count - prefer side with player
			if (hasPlayer0 && !hasPlayer1) {
				firstItems = items0;
				secondItems = items1;
			} else if (hasPlayer1 && !hasPlayer0) {
				firstItems = items1;
				secondItems = items0;
			} else {
				// Both have players or neither - keep original order
				firstItems = items0;
				secondItems = items1;
			}
		}
		
		title = oxfordJoin(firstItems) + ' for ' + oxfordJoin(secondItems);
	} else {
		// Multi-party trade: list each party's assets
		var partySummaries = [];
		for (var i = 0; i < parties.length; i++) {
			var items = collectTitleAssets(parties[i], auctionSeason, tradeYear);
			partySummaries.push(oxfordJoin(items));
		}
		title = partySummaries.join(', ');
	}
	
	if (status === 'draft') {
		title = 'Fake Trade: ' + title;
	} else {
		// Capitalize first letter
		title = title.charAt(0).toUpperCase() + title.slice(1);
	}
	
	return title;
}

/**
 * Collect assets for plain English description (full player names, picks with "a Xth round pick", cash with year)
 * @param {Object} party - party object with assets array
 * @param {number} auctionSeason - for filtering cash
 * @param {number} tradeYear - for pick number display
 * @returns {Object} { items: Array of formatted strings, hasPlayer: boolean, isCashOnly: boolean, isNothing: boolean }
 */
function collectDescriptionAssets(party, auctionSeason, tradeYear) {
	if (!party || !party.assets || party.assets.length === 0) {
		return { items: ['nothing'], hasPlayer: false, isCashOnly: false, isNothing: true };
	}
	
	// If only one asset, always include it
	var forceInclude = party.assets.length === 1;
	
	var players = [];
	var picks = [];
	var cashItems = []; // { amount, season }
	var hasNothing = false;
	
	for (var i = 0; i < party.assets.length; i++) {
		var asset = party.assets[i];
		
		if (asset.type === 'player' || asset.type === 'rfa') {
			players.push({ name: asset.playerName, salary: asset.salary || 0 });
		} else if (asset.type === 'pick') {
			if (forceInclude || asset.round <= 2) {
				picks.push({ round: asset.round || 1, season: asset.season, pickNumber: asset.pickNumber });
			}
		} else if (asset.type === 'cash') {
			var season = asset.season || auctionSeason;
			if (forceInclude || season >= auctionSeason) {
				cashItems.push({ amount: asset.amount || 0, season: season });
			}
		} else if (asset.type === 'nothing') {
			hasNothing = true;
		}
	}
	
	var items = [];
	
	// Players sorted by salary desc - full names
	players.sort(function(a, b) { return b.salary - a.salary; });
	for (var i = 0; i < players.length; i++) {
		items.push(players[i].name);
	}
	
	// Picks formatted as "a 1st round pick" (or "1.04" for same-year with known number)
	var numberedPicks = [];
	var picksByRound = {};
	for (var i = 0; i < picks.length; i++) {
		var pick = picks[i];
		if (pick.season === tradeYear && pick.pickNumber) {
			numberedPicks.push(pick);
		} else {
			picksByRound[pick.round] = (picksByRound[pick.round] || 0) + 1;
		}
	}
	
	// Add numbered picks (e.g., "1.04")
	numberedPicks.sort(function(a, b) { return a.pickNumber - b.pickNumber; });
	for (var i = 0; i < numberedPicks.length; i++) {
		var pick = numberedPicks[i];
		var teamsPerRound = (pick.season <= 2011) ? 10 : 12;
		items.push('pick ' + formatPickHelpers.formatPickNumber(pick.pickNumber, teamsPerRound));
	}
	
	// Add grouped picks as "a 1st round pick" or "two 1st round picks"
	var rounds = Object.keys(picksByRound).map(Number).sort(function(a, b) { return a - b; });
	for (var i = 0; i < rounds.length; i++) {
		var round = rounds[i];
		var count = picksByRound[round];
		var roundOrd = ordinal(round);
		if (count === 1) {
			items.push('a ' + roundOrd + ' round pick');
		} else {
			items.push(numberToWord(count) + ' ' + roundOrd + ' round picks');
		}
	}
	
	// Cash with year (grouped by season)
	var cashBySeason = {};
	for (var i = 0; i < cashItems.length; i++) {
		var c = cashItems[i];
		cashBySeason[c.season] = (cashBySeason[c.season] || 0) + c.amount;
	}
	var cashSeasons = Object.keys(cashBySeason).map(Number).sort(function(a, b) { return a - b; });
	for (var i = 0; i < cashSeasons.length; i++) {
		var season = cashSeasons[i];
		items.push('$' + cashBySeason[season] + ' in ' + season);
	}
	
	// Handle nothing
	if (hasNothing && items.length === 0) {
		items.push('nothing');
	}
	
	// If still no items, it's nothing
	if (items.length === 0) {
		items.push('nothing');
	}
	
	var isCashOnly = items.every(function(item) { return item.startsWith('$'); });
	var isNothing = items.length === 1 && items[0] === 'nothing';
	
	return {
		items: items,
		hasPlayer: players.length > 0,
		isCashOnly: isCashOnly,
		isNothing: isNothing
	};
}

/**
 * Generate plain English trade description
 * e.g., "Schexes traded Marcus Mariota to Koci for $38 in 2026"
 * @param {Array} parties - array of party objects with franchiseName, assets
 * @param {Object} options - { auctionSeason, tradeYear }
 * @returns {string} plain English description
 */
function tradeOgPlainEnglish(parties, options) {
	options = options || {};
	var auctionSeason = options.auctionSeason || new Date().getFullYear();
	var tradeYear = options.tradeYear || auctionSeason;
	
	if (!parties || parties.length < 2) {
		return 'Trade on Primetime Soap Operas';
	}
	
	if (parties.length !== 2) {
		// Multi-party trades - simplified format
		var parts = [];
		for (var i = 0; i < parties.length; i++) {
			var p = parties[i];
			var collected = collectDescriptionAssets(p, auctionSeason, tradeYear);
			parts.push(p.franchiseName + ' receives ' + oxfordJoin(collected.items));
		}
		return parts.join('. ') + '.';
	}
	
	// Two-party trade
	var collected0 = collectDescriptionAssets(parties[0], auctionSeason, tradeYear);
	var collected1 = collectDescriptionAssets(parties[1], auctionSeason, tradeYear);
	
	// Apply the same ordering logic as tradeOgTitle
	var giverIndex, receiverIndex, givenItems, receivedItems;
	
	// Determine order: first side assets come from the party that gives them away
	// Party 0 RECEIVES items0, so Party 1 GIVES items0
	// Party 1 RECEIVES items1, so Party 0 GIVES items1
	// If we want items0 to go first, the giver is Party 1
	
	var items0 = collected0.items;
	var items1 = collected1.items;
	
	// Use same ordering logic as tradeOgTitle
	var nothing0 = collected0.isNothing;
	var nothing1 = collected1.isNothing;
	var cashOnly0 = collected0.isCashOnly;
	var cashOnly1 = collected1.isCashOnly;
	var hasPlayer0 = collected0.hasPlayer;
	var hasPlayer1 = collected1.hasPlayer;
	
	// Determine which side's assets go first
	var firstIsParty0Assets = true; // Does party 0's received assets go first in display?
	
	// Nothing always goes second
	if (nothing0 && !nothing1) {
		firstIsParty0Assets = false;
	} else if (nothing1 && !nothing0) {
		firstIsParty0Assets = true;
	// Cash-only sides go second
	} else if (cashOnly0 && !cashOnly1) {
		firstIsParty0Assets = false;
	} else if (cashOnly1 && !cashOnly0) {
		firstIsParty0Assets = true;
	} else if (items0.length < items1.length) {
		// Fewer assets first
		firstIsParty0Assets = true;
	} else if (items1.length < items0.length) {
		firstIsParty0Assets = false;
	} else {
		// Same count - prefer side with player
		if (hasPlayer0 && !hasPlayer1) {
			firstIsParty0Assets = true;
		} else if (hasPlayer1 && !hasPlayer0) {
			firstIsParty0Assets = false;
		}
		// Both have players or neither - keep original order
	}
	
	var giverName, receiverName, firstAssets, secondAssets;
	
	if (firstIsParty0Assets) {
		// Party 0 receives first assets, so Party 1 gave them
		// Description: Party 1 traded first assets to Party 0 for second assets
		giverName = parties[1].franchiseName;
		receiverName = parties[0].franchiseName;
		firstAssets = items0;
		secondAssets = items1;
	} else {
		// Party 1 receives first assets, so Party 0 gave them
		giverName = parties[0].franchiseName;
		receiverName = parties[1].franchiseName;
		firstAssets = items1;
		secondAssets = items0;
	}
	
	// Build the sentence: "[Giver] traded [first assets] to [Receiver] for [second assets]."
	return giverName + ' traded ' + oxfordJoin(firstAssets) + ' to ' + receiverName + ' for ' + oxfordJoin(secondAssets) + '.';
}

module.exports = {
	formatMoney: formatMoney,
	formatRecord: formatRecord,
	formatPoints: formatPoints,
	formatScore: formatScore,
	ordinal: ordinal,
	formatContractYears: formatContractYears,
	formatContractDisplay: formatContractDisplay,
	formatDateISO: formatDateISO,
	deltaClass: deltaClass,
	sortedPositions: sortedPositions,
	getPositionIndex: getPositionIndex,
	getPositionKey: getPositionKey,
	shortenPlayerName: shortenPlayerName,
	oxfordJoin: oxfordJoin,
	formatPicksGrouped: formatPicksGrouped,
	formatPartyAssets: formatPartyAssets,
	summarizeTradeAssets: summarizeTradeAssets,
	tradeOgTitle: tradeOgTitle,
	tradeOgDescription: tradeOgDescription,
	tradeOgPlainEnglish: tradeOgPlainEnglish,
	POSITION_ORDER: POSITION_ORDER
};
