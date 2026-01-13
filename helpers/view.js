// Shared view helpers - available in all Pug templates via app.locals

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
	return items.join(', ');
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
 * Generate OG title for a trade
 * @param {Array} parties - array of party objects with franchiseName
 * @returns {string} e.g. "Schex ↔ Koci Trade"
 */
function tradeOgTitle(parties) {
	if (!parties || parties.length === 0) {
		return 'Trade';
	}
	
	var names = parties.map(function(p) { return p.franchiseName; });
	
	if (names.length === 2) {
		return names[0] + ' ↔ ' + names[1] + ' Trade';
	}
	
	// For 3+ party trades
	return names.slice(0, -1).join(', ') + ' & ' + names[names.length - 1] + ' Trade';
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
	POSITION_ORDER: POSITION_ORDER
};
