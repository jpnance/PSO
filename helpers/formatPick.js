// Shared pick formatting utilities

function formatRound(round) {
	if (round === 1) return '1st';
	if (round === 2) return '2nd';
	if (round === 3) return '3rd';
	return round + 'th';
}

function formatPickNumber(pickNumber, teamsPerRound) {
	// Convert overall pick number to round.pick format (e.g., 2.04)
	teamsPerRound = teamsPerRound || 12;
	var round = Math.ceil(pickNumber / teamsPerRound);
	var pickInRound = ((pickNumber - 1) % teamsPerRound) + 1;
	return round + '.' + pickInRound.toString().padStart(2, '0');
}

/**
 * Format a pick for display
 * @param {Object} pick - Pick object with round, pickNumber, season, origin/fromName
 * @param {Object} options - Optional settings
 * @param {boolean} options.showPickNumber - Whether to show pick number if known (default: true)
 * @returns {string} Formatted pick string like "Pick 1.04 in 2025 (Keyon)" or "3rd round pick in 2027 (Schexes)"
 */
function formatPickDisplay(pick, options) {
	options = options || {};
	var showPickNumber = options.showPickNumber !== false;
	
	var origin = pick.origin || pick.fromName || 'Unknown';
	var season = pick.season;
	var round = pick.round;
	var pickNumber = pick.pickNumber;
	
	var text;
	if (showPickNumber && pickNumber) {
		var teamsPerRound = (season <= 2011) ? 10 : 12;
		text = 'Pick ' + formatPickNumber(pickNumber, teamsPerRound);
	} else {
		text = formatRound(round) + ' round pick';
	}
	
	text += ' in ' + season + ' (' + origin + ')';
	return text;
}

module.exports = {
	formatRound: formatRound,
	formatPickNumber: formatPickNumber,
	formatPickDisplay: formatPickDisplay
};
