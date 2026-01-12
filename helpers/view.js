// Shared view helpers - available in all Pug templates via app.locals

/**
 * Format a number as currency without $ sign
 * @param {number} n
 * @returns {string} e.g. "1,234,567"
 */
function formatMoney(n) {
	if (n == null) return '';
	return n.toLocaleString();
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
 * Get a player's position key for grouping (e.g. "WR" or "RB/WR")
 * @param {Object} player - player with positions array
 * @returns {string}
 */
function getPositionKey(player) {
	if (!player.positions || player.positions.length === 0) return '';
	return sortedPositions(player.positions).join('/');
}

module.exports = {
	formatMoney: formatMoney,
	formatRecord: formatRecord,
	formatPoints: formatPoints,
	formatScore: formatScore,
	ordinal: ordinal,
	formatContractYears: formatContractYears,
	formatDateISO: formatDateISO,
	sortedPositions: sortedPositions,
	getPositionKey: getPositionKey,
	POSITION_ORDER: POSITION_ORDER
};
