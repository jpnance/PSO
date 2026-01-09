// Budget calculation utilities

var BUYOUT_PERCENTAGES = [0.60, 0.30, 0.15];

// Calculate buyout amount if a player is cut
function computeBuyOutIfCut(salary, startYear, endYear, season) {
	if (startYear === null) startYear = endYear;
	var contractYearIndex = season - startYear;
	if (contractYearIndex >= BUYOUT_PERCENTAGES.length) return 0;
	return Math.ceil(salary * BUYOUT_PERCENTAGES[contractYearIndex]);
}

// Calculate recoverable amount (salary - buyout)
function computeRecoverableForContract(salary, startYear, endYear, season) {
	var buyOut = computeBuyOutIfCut(salary, startYear, endYear, season);
	return salary - buyOut;
}

module.exports = {
	BUYOUT_PERCENTAGES: BUYOUT_PERCENTAGES,
	computeBuyOutIfCut: computeBuyOutIfCut,
	computeRecoverableForContract: computeRecoverableForContract
};
