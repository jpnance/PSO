// Budget calculation utilities

var BUYOUT_PERCENTAGES = [0.60, 0.30, 0.15];

/**
 * Calculate budget impact for a proposed trade.
 * Returns structured data including deltas and resulting budgets.
 * 
 * @param {Object} deal - Trade deal object with franchiseId keys
 *   { franchiseId: { players: [{id, ...}], picks: [...], cash: [{amount, from, season}] } }
 * @param {number} currentSeason - Current season year
 * @returns {Promise<Object>} { franchises: [...], seasons: [...], isCashNeutral: boolean }
 */
async function calculateTradeImpact(deal, currentSeason) {
	var Contract = require('../models/Contract');
	var Budget = require('../models/Budget');
	var Regime = require('../models/Regime');
	
	var franchiseIds = Object.keys(deal);
	var seasons = [currentSeason, currentSeason + 1, currentSeason + 2];
	
	if (franchiseIds.length < 2) {
		return { franchises: [], seasons: seasons, isCashNeutral: true };
	}
	
	// Get display names for all franchises
	var franchiseNames = {};
	for (var i = 0; i < franchiseIds.length; i++) {
		var fId = franchiseIds[i];
		var regime = await Regime.findOne({
			franchiseId: fId,
			startSeason: { $lte: currentSeason },
			$or: [{ endSeason: null }, { endSeason: { $gte: currentSeason } }]
		});
		franchiseNames[fId] = regime ? regime.displayName : 'Unknown';
	}
	
	// Sort franchise IDs alphabetically by name
	franchiseIds.sort(function(a, b) {
		return franchiseNames[a].localeCompare(franchiseNames[b]);
	});
	
	// Collect all player IDs from the deal
	var allPlayerIds = [];
	franchiseIds.forEach(function(fId) {
		var bucket = deal[fId];
		if (bucket && bucket.players) {
			bucket.players.forEach(function(p) {
				if (p.id) allPlayerIds.push(p.id);
			});
		}
	});
	
	// Look up contracts for all players
	var contracts = await Contract.find({ playerId: { $in: allPlayerIds } }).lean();
	var contractMap = {};
	contracts.forEach(function(c) {
		contractMap[c.playerId.toString()] = c;
	});
	
	// Look up current budgets for all franchises/seasons
	var budgetLookups = [];
	franchiseIds.forEach(function(fId) {
		seasons.forEach(function(s) {
			budgetLookups.push({ franchiseId: fId, season: s });
		});
	});
	var budgets = await Budget.find({ $or: budgetLookups }).lean();
	var budgetMap = {};
	budgets.forEach(function(b) {
		budgetMap[b.franchiseId.toString() + ':' + b.season] = b;
	});
	
	// Initialize impact structure
	var impact = {};
	franchiseIds.forEach(function(fId) {
		impact[fId] = {};
		seasons.forEach(function(s) {
			impact[fId][s] = 0;
		});
	});
	
	// Process players - salary affects budget for years the contract covers
	franchiseIds.forEach(function(receivingId) {
		var bucket = deal[receivingId];
		if (!bucket || !bucket.players) return;
		
		bucket.players.forEach(function(player) {
			var contract = contractMap[player.id];
			if (!contract || contract.salary === null) return; // Skip RFA rights
			
			var salary = contract.salary || 0;
			var endYear = contract.endYear;
			var sendingId = contract.franchiseId.toString();
			
			seasons.forEach(function(season) {
				if (endYear && season <= endYear) {
					// Receiver takes on salary (negative = cap burden)
					impact[receivingId][season] -= salary;
					// Sender loses salary obligation (positive = cap relief)
					if (impact[sendingId]) {
						impact[sendingId][season] += salary;
					}
				}
			});
		});
	});
	
	// Process cash - only affects the specific season
	franchiseIds.forEach(function(receivingId) {
		var bucket = deal[receivingId];
		if (!bucket || !bucket.cash) return;
		
		bucket.cash.forEach(function(c) {
			var season = c.season;
			var amount = c.amount || 0;
			var sendingId = c.from;
			
			if (impact[receivingId] && impact[receivingId][season] !== undefined) {
				// Receiver gains cash (improves budget)
				impact[receivingId][season] += amount;
			}
			if (sendingId && impact[sendingId] && impact[sendingId][season] !== undefined) {
				// Sender loses cash
				impact[sendingId][season] -= amount;
			}
		});
	});
	
	// Check if cash-neutral for current season
	var isCashNeutral = franchiseIds.every(function(fId) {
		return impact[fId][currentSeason] === 0;
	});
	
	// Build result structure for rendering
	var franchises = franchiseIds.map(function(fId) {
		var seasonData = seasons.map(function(s) {
			var budget = budgetMap[fId + ':' + s];
			var available = budget ? budget.available : null;
			var delta = impact[fId][s];
			var resulting = available !== null ? available + delta : null;
			
			return {
				season: s,
				delta: delta,
				available: available,
				resulting: resulting
			};
		});
		
		return {
			franchiseId: fId,
			franchiseName: franchiseNames[fId],
			seasons: seasonData
		};
	});
	
	return {
		franchises: franchises,
		seasons: seasons,
		isCashNeutral: isCashNeutral
	};
}

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
	recalculateCashForBudgets: recalculateCashForBudgets,
	calculateTradeImpact: calculateTradeImpact
};
