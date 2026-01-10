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

/**
 * Recalculate cashIn/cashOut for specified budgets by scanning all trades.
 * Call this after modifying trade cash entries.
 * 
 * @param {ObjectId[]} franchiseIds - Franchises to recalculate
 * @param {number[]} seasons - Seasons to recalculate
 */
async function recalculateCashForBudgets(franchiseIds, seasons) {
	var Budget = require('../models/Budget');
	var Transaction = require('../models/Transaction');
	
	// Load all trades (we need to scan them all to get accurate totals)
	var trades = await Transaction.find({ type: 'trade' }).lean();
	
	for (var i = 0; i < franchiseIds.length; i++) {
		var franchiseId = franchiseIds[i];
		
		for (var j = 0; j < seasons.length; j++) {
			var season = seasons[j];
			
			// Calculate cash in/out from all trades
			var cashIn = 0;
			var cashOut = 0;
			
			trades.forEach(function(trade) {
				if (!trade.parties) return;
				trade.parties.forEach(function(party) {
					if (!party.receives || !party.receives.cash) return;
					party.receives.cash.forEach(function(c) {
						if (c.season !== season) return;
						if (party.franchiseId.equals(franchiseId)) {
							cashIn += c.amount || 0;
						}
						if (c.fromFranchiseId && c.fromFranchiseId.equals(franchiseId)) {
							cashOut += c.amount || 0;
						}
					});
				});
			});
			
			// Update the budget
			var budget = await Budget.findOne({ franchiseId: franchiseId, season: season });
			if (budget) {
				var oldAvailable = budget.available;
				budget.cashIn = cashIn;
				budget.cashOut = cashOut;
				budget.available = budget.baseAmount - budget.payroll - budget.buyOuts + cashIn - cashOut;
				await budget.save();
			}
		}
	}
}

module.exports = {
	BUYOUT_PERCENTAGES: BUYOUT_PERCENTAGES,
	computeBuyOutIfCut: computeBuyOutIfCut,
	computeRecoverableForContract: computeRecoverableForContract,
	recalculateCashForBudgets: recalculateCashForBudgets
};
