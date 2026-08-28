// Contract state predicates and utilities
//
// A Contract document is always in exactly one of three mutually exclusive states:
//   - RFA rights:  salary is null (franchise holds rights, no active contract)
//   - Pending:     salary is set but endYear is not (acquired, term not yet chosen)
//   - Signed:      salary, startYear, and endYear are all set (fully specified contract)

/**
 * Franchise holds rights to the player but there is no active contract.
 * No cap impact, doesn't count toward roster limit.
 */
function isRfaRights(contract) {
	return contract.salary === null;
}

/**
 * Player was acquired (draft/auction) and has a salary, but the owner
 * hasn't chosen the contract term (1/2/3 years) yet.
 */
function isPending(contract) {
	return contract.salary !== null && !contract.endYear;
}

/**
 * Fully specified contract with salary, start year, and end year.
 */
function isSigned(contract) {
	return contract.salary !== null && !!contract.endYear;
}

/**
 * Signed contract in its final year — will expire at rollover.
 */
function isExpiring(contract, season) {
	return isSigned(contract) && contract.endYear === season;
}

/**
 * Signed contract whose term has already ended. Should have been
 * cleaned up at rollover; finding one mid-season indicates a problem.
 */
function isExpired(contract, season) {
	return isSigned(contract) && contract.endYear < season;
}

/**
 * Check if a contract affects a given season's budget.
 * RFA rights have no cap impact. Pending contracts only affect the current season.
 */
function affectsBudget(contract, season, currentSeason) {
	if (isRfaRights(contract)) return false;
	if (isExpired(contract, season)) return false;
	if (isPending(contract) && season !== currentSeason) return false;
	return true;
}

/**
 * Get the effective year range for a contract's budget impact.
 * For pending contracts, returns currentSeason for both start and end.
 */
function getEffectiveYears(contract, currentSeason) {
	return {
		startYear: contract.startYear || currentSeason,
		endYear: contract.endYear || currentSeason
	};
}

/**
 * Resolve the effective end year for a contract.
 * Uses pendingEndYear (owner's pre-deadline choice) if set, otherwise endYear.
 */
function getEffectiveEndYear(contract) {
	return contract.pendingEndYear || contract.endYear || null;
}

module.exports = {
	isRfaRights: isRfaRights,
	isPending: isPending,
	isSigned: isSigned,
	isExpiring: isExpiring,
	isExpired: isExpired,
	affectsBudget: affectsBudget,
	getEffectiveYears: getEffectiveYears,
	getEffectiveEndYear: getEffectiveEndYear
};
