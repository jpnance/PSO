// Contract helper utilities

/**
 * Check if a contract represents an unsigned player.
 * Unsigned = has salary but no endYear (drafted/won at auction, term not yet assigned).
 * 
 * @param {Object} contract - Contract document or plain object
 * @returns {boolean}
 */
function isUnsigned(contract) {
	return contract.salary !== null && !contract.endYear;
}

/**
 * Check if a contract affects a given season's budget.
 * Handles RFA rights, expired contracts, not-yet-started contracts, and unsigned players.
 * 
 * @param {Object} contract - Contract document or plain object
 * @param {number} season - Season to check
 * @param {number} currentSeason - Current season (needed for unsigned player logic)
 * @returns {boolean}
 */
function contractAffectsSeason(contract, season, currentSeason) {
	if (contract.salary === null) return false; // RFA rights don't affect budget
	if (contract.startYear && contract.startYear > season) return false; // Not started yet
	if (contract.endYear && contract.endYear < season) return false; // Already expired
	if (!contract.endYear && season !== currentSeason) return false; // Unsigned only affects current season
	return true;
}

/**
 * Get the effective year range for a contract's budget impact.
 * For unsigned players, returns currentSeason for both start and end.
 * 
 * @param {Object} contract - Contract document or plain object (needs startYear, endYear)
 * @param {number} currentSeason - Current season
 * @returns {{ startYear: number, endYear: number }}
 */
function getEffectiveYears(contract, currentSeason) {
	return {
		startYear: contract.startYear || currentSeason,
		endYear: contract.endYear || currentSeason
	};
}

module.exports = {
	isUnsigned: isUnsigned,
	contractAffectsSeason: contractAffectsSeason,
	getEffectiveYears: getEffectiveYears
};
