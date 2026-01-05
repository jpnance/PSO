var mongoose = require('mongoose');

var Transaction = require('../models/Transaction');
var Contract = require('../models/Contract');
var Roster = require('../models/Roster');
var Pick = require('../models/Pick');
var Player = require('../models/Player');
var Franchise = require('../models/Franchise');
var LeagueConfig = require('../models/LeagueConfig');
var Budget = require('../models/Budget');

/**
 * Compute dead money for a single season if a contract is cut.
 * Contract years get 60%/30%/15% for year 1/2/3 of contract.
 * 
 * @param {number} salary - Contract salary
 * @param {number} startYear - Contract start year (null for FA = single-year)
 * @param {number} endYear - Contract end year
 * @param {number} cutYear - Season when the cut occurs
 * @param {number} targetSeason - Season to calculate dead money for
 * @returns {number} Dead money amount for targetSeason (0 if not applicable)
 */
function computeDeadMoneyForSeason(salary, startYear, endYear, cutYear, targetSeason) {
	var percentages = [0.60, 0.30, 0.15];
	
	// For FA contracts (single year), startYear === endYear
	if (startYear === null) {
		startYear = endYear;
	}
	
	// Target season must be within contract and >= cut year
	if (targetSeason < cutYear || targetSeason < startYear || targetSeason > endYear) {
		return 0;
	}
	
	var contractYearIndex = targetSeason - startYear; // 0, 1, or 2
	if (contractYearIndex >= percentages.length) {
		return 0;
	}
	
	return Math.ceil(salary * percentages[contractYearIndex]);
}

/**
 * Compute total reclaimable budget if a franchise cut all their players.
 * Reclaimable = salary saved - dead money incurred (for a single season).
 * 
 * @param {ObjectId} franchiseId - Franchise to calculate for
 * @param {number} season - Season to calculate for
 * @returns {Promise<number>} Total reclaimable amount
 */
async function computeReclaimable(franchiseId, season) {
	var contracts = await Contract.find({
		franchiseId: franchiseId,
		endYear: { $gte: season },
		startYear: { $lte: season }
	}).lean();
	
	var totalReclaimable = 0;
	
	for (var i = 0; i < contracts.length; i++) {
		var contract = contracts[i];
		var salary = contract.salary || 0;
		var startYear = contract.startYear;
		var endYear = contract.endYear;
		
		// If cut this season, what dead money would we incur for THIS season?
		var deadMoney = computeDeadMoneyForSeason(salary, startYear, endYear, season, season);
		
		// Reclaimable = salary we stop paying - dead money we incur
		var reclaimable = salary - deadMoney;
		totalReclaimable += reclaimable;
	}
	
	return totalReclaimable;
}

/**
 * Validate a budget impact for a single franchise/season.
 * Useful for contract term setting, auction bids, or any single-franchise check.
 * 
 * @param {ObjectId} franchiseId - Franchise to validate
 * @param {number} season - Season to validate
 * @param {number} salaryImpact - Additional salary being committed (positive = more payroll)
 * @param {Object} config - { season: currentSeason, hardCapActive: boolean }
 * @returns {Promise<Object>} { valid: boolean, error?: string, warning?: string }
 */
async function validateBudgetImpact(franchiseId, season, salaryImpact, config) {
	var budget = await Budget.findOne({ franchiseId: franchiseId, season: season });
	
	if (!budget) {
		return { valid: false, error: 'No budget found for season ' + season };
	}
	
	var resultingBudget = budget.available - salaryImpact;
	
	if (resultingBudget >= 0) {
		return { valid: true };
	}
	
	// Negative budget - check cap rules
	if (config.hardCapActive && season === config.season) {
		return { 
			valid: false, 
			error: 'Hard cap violation: would have $' + resultingBudget + ' available' 
		};
	}
	
	// Soft cap - can they cut their way out?
	var reclaimable = await computeReclaimable(franchiseId, season);
	
	if (resultingBudget + reclaimable >= 0) {
		return { 
			valid: true, 
			warning: 'Soft cap: $' + resultingBudget + ' available (could recover by cutting $' + (-resultingBudget) + ' in salary)'
		};
	}
	
	var shortfall = -(resultingBudget + reclaimable);
	return { 
		valid: false, 
		error: 'Cannot recover: would be $' + shortfall + ' short even after cutting all players'
	};
}

/**
 * Validate cash in a trade.
 * Returns { valid: boolean, errors: string[], warnings: string[] }
 */
async function validateTradeCash(tradeDetails, config) {
	var errors = [];
	var warnings = [];
	var currentSeason = config.season;
	var hardCapActive = config.hardCapActive;
	
	// Collect all cash movements by franchise and season
	var cashBySeason = {}; // { franchiseId: { season: netAmount } }
	
	for (var i = 0; i < tradeDetails.parties.length; i++) {
		var party = tradeDetails.parties[i];
		var franchiseId = party.franchiseId.toString();
		var receives = party.receives || {};
		
		if (!cashBySeason[franchiseId]) {
			cashBySeason[franchiseId] = {};
		}
		
		// Cash this party receives (positive for them)
		(receives.cash || []).forEach(function(c) {
			if (!cashBySeason[franchiseId][c.season]) {
				cashBySeason[franchiseId][c.season] = 0;
			}
			cashBySeason[franchiseId][c.season] += c.amount;
			
			// Track the sender's outgoing cash
			var fromId = c.fromFranchiseId.toString();
			if (!cashBySeason[fromId]) {
				cashBySeason[fromId] = {};
			}
			if (!cashBySeason[fromId][c.season]) {
				cashBySeason[fromId][c.season] = 0;
			}
			cashBySeason[fromId][c.season] -= c.amount;
		});
	}
	
	// Also account for salary changes from players moving
	for (var i = 0; i < tradeDetails.parties.length; i++) {
		var party = tradeDetails.parties[i];
		var franchiseId = party.franchiseId.toString();
		var receives = party.receives || {};
		
		// Players this party receives = salary added
		for (var j = 0; j < (receives.players || []).length; j++) {
			var playerInfo = receives.players[j];
			var salary = playerInfo.salary || 0;
			var endYear = playerInfo.endYear;
			
			// This player's salary affects all seasons through endYear
			for (var season = currentSeason; season <= endYear && season <= currentSeason + 2; season++) {
				if (!cashBySeason[franchiseId]) cashBySeason[franchiseId] = {};
				if (!cashBySeason[franchiseId][season]) cashBySeason[franchiseId][season] = 0;
				cashBySeason[franchiseId][season] -= salary; // Adding a player = less available
			}
		}
	}
	
	// Find players being sent away (freeing up salary)
	for (var i = 0; i < tradeDetails.parties.length; i++) {
		var party = tradeDetails.parties[i];
		var receives = party.receives || {};
		
		for (var j = 0; j < (receives.players || []).length; j++) {
			var playerInfo = receives.players[j];
			
			// Find which party is losing this player
			var contract = await Contract.findOne({ playerId: playerInfo.playerId }).lean();
			if (!contract) continue;
			
			var senderId = contract.franchiseId.toString();
			var salary = contract.salary || 0;
			var endYear = contract.endYear;
			
			// Sending away a player = salary freed up
			for (var season = currentSeason; season <= endYear && season <= currentSeason + 2; season++) {
				if (!cashBySeason[senderId]) cashBySeason[senderId] = {};
				if (!cashBySeason[senderId][season]) cashBySeason[senderId][season] = 0;
				cashBySeason[senderId][season] += salary; // Losing a player = more available
			}
		}
	}
	
	// Now validate each franchise's resulting budget
	var franchiseIds = Object.keys(cashBySeason);
	
	for (var i = 0; i < franchiseIds.length; i++) {
		var franchiseId = franchiseIds[i];
		var seasons = Object.keys(cashBySeason[franchiseId]);
		
		var franchise = await Franchise.findById(franchiseId).lean();
		var franchiseName = franchise ? franchise.sleeperRosterId : franchiseId;
		
		for (var j = 0; j < seasons.length; j++) {
			var season = parseInt(seasons[j]);
			var netChange = cashBySeason[franchiseId][season];
			
			// Check season is within allowed range
			if (season > currentSeason + 2) {
				errors.push('Cannot trade cash for season ' + season + ' (max is ' + (currentSeason + 2) + ')');
				continue;
			}
			
			if (season < currentSeason) {
				errors.push('Cannot trade cash for past season ' + season);
				continue;
			}
			
			// Look up current available budget
			var budget = await Budget.findOne({ franchiseId: mongoose.Types.ObjectId(franchiseId), season: season });
			if (!budget) {
				errors.push('No budget found for franchise ' + franchiseName + ' season ' + season);
				continue;
			}
			var resultingBudget = budget.available + netChange;
			
			if (resultingBudget < 0) {
				var message = 'Franchise ' + franchiseName + ' would have $' + resultingBudget + ' available for ' + season;
				
				// Hard cap for current season after cut day - no way out
				if (season === currentSeason && hardCapActive) {
					errors.push(message + ' (hard cap violation)');
				} else {
					// Soft cap - check if they could cut their way out
					var reclaimable = await computeReclaimable(mongoose.Types.ObjectId(franchiseId), season);
					
					if (resultingBudget + reclaimable >= 0) {
						// They could cut their way back to $0 or better
						warnings.push(message + ' (soft cap - could recover by cutting $' + (-resultingBudget) + ' in salary)');
					} else {
						// Even cutting everyone wouldn't save them
						var shortfall = -(resultingBudget + reclaimable);
						errors.push(message + ' (would be $' + shortfall + ' short even after cutting all players)');
					}
				}
			}
		}
	}
	
	return {
		valid: errors.length === 0,
		errors: errors,
		warnings: warnings
	};
}

/**
 * Process a trade between franchises.
 * 
 * @param {Object} tradeDetails
 * @param {Date} tradeDetails.timestamp - When the trade occurred
 * @param {string} tradeDetails.source - 'manual', 'sleeper', 'wordpress'
 * @param {number} [tradeDetails.wordpressTradeId] - WordPress post ID if imported
 * @param {string} [tradeDetails.notes] - Optional notes
 * @param {Array} tradeDetails.parties - Array of party objects:
 *   {
 *     franchiseId: ObjectId,
 *     receives: {
 *       players: [{ playerId: ObjectId, salary, startYear, endYear }],
 *       picks: [{ pickId: ObjectId }],
 *       cash: [{ amount: Number, season: Number }]
 *     }
 *   }
 * 
 * @returns {Object} { success: boolean, transaction?: Transaction, errors?: string[] }
 */
async function processTrade(tradeDetails) {
	var errors = [];
	
	// Validate parties
	if (!tradeDetails.parties || tradeDetails.parties.length < 2) {
		errors.push('Trade must have at least 2 parties');
		return { success: false, errors: errors };
	}
	
	// Validate all franchises exist
	for (var i = 0; i < tradeDetails.parties.length; i++) {
		var party = tradeDetails.parties[i];
		var franchise = await Franchise.findById(party.franchiseId);
		if (!franchise) {
			errors.push('Franchise not found: ' + party.franchiseId);
		}
	}
	
	if (errors.length > 0) {
		return { success: false, errors: errors };
	}
	
	// Validate all players are on the expected franchises (the other party)
	for (var i = 0; i < tradeDetails.parties.length; i++) {
		var party = tradeDetails.parties[i];
		var receives = party.receives || {};
		var players = receives.players || [];
		
		for (var j = 0; j < players.length; j++) {
			var playerInfo = players[j];
			var contract = await Contract.findOne({ playerId: playerInfo.playerId });
			
			if (!contract) {
				var player = await Player.findById(playerInfo.playerId);
				var playerName = player ? player.name : playerInfo.playerId;
				errors.push('No contract found for player: ' + playerName);
				continue;
			}
			
			// The player should be coming FROM a different party
			var isFromValidParty = tradeDetails.parties.some(function(otherParty) {
				return !otherParty.franchiseId.equals(party.franchiseId) && 
				       contract.franchiseId.equals(otherParty.franchiseId);
			});
			
			if (!isFromValidParty) {
				var player = await Player.findById(playerInfo.playerId);
				var playerName = player ? player.name : playerInfo.playerId;
				errors.push('Player ' + playerName + ' is not on a trading partner\'s roster');
			}
		}
	}
	
	// Validate all picks are owned by the expected franchises
	for (var i = 0; i < tradeDetails.parties.length; i++) {
		var party = tradeDetails.parties[i];
		var receives = party.receives || {};
		var picks = receives.picks || [];
		
		for (var j = 0; j < picks.length; j++) {
			var pickInfo = picks[j];
			var pick = await Pick.findById(pickInfo.pickId);
			
			if (!pick) {
				errors.push('Pick not found: ' + pickInfo.pickId);
				continue;
			}
			
			if (pick.status !== 'available') {
				errors.push('Pick is not available: ' + pick.season + ' R' + pick.round);
				continue;
			}
			
			// The pick should be coming FROM a different party
			var isFromValidParty = tradeDetails.parties.some(function(otherParty) {
				return !otherParty.franchiseId.equals(party.franchiseId) && 
				       pick.currentFranchiseId.equals(otherParty.franchiseId);
			});
			
			if (!isFromValidParty) {
				errors.push('Pick ' + pick.season + ' R' + pick.round + ' is not owned by a trading partner');
			}
		}
	}
	
	if (errors.length > 0) {
		return { success: false, errors: errors };
	}
	
	// Validate cash constraints
	var config = await LeagueConfig.findById('pso');
	if (!config) {
		// Default config if none exists
		config = new LeagueConfig({ 
			_id: 'pso',
			season: parseInt(process.env.SEASON, 10) || new Date().getFullYear()
		});
	}
	
	// Check if trades are allowed
	if (!config.areTradesEnabled()) {
		return { success: false, errors: ['Trades are not allowed during ' + config.getPhase() + ' phase'] };
	}
	
	var cashValidation = await validateTradeCash(tradeDetails, {
		season: config.season,
		hardCapActive: config.isHardCapActive()
	});
	
	if (!cashValidation.valid) {
		return { success: false, errors: cashValidation.errors, warnings: cashValidation.warnings };
	}
	
	// Build the transaction document
	var transactionParties = [];
	
	for (var i = 0; i < tradeDetails.parties.length; i++) {
		var party = tradeDetails.parties[i];
		var receives = party.receives || {};
		
		var txParty = {
			franchiseId: party.franchiseId,
			receives: {
				players: (receives.players || []).map(function(p) {
					return {
						playerId: p.playerId,
						salary: p.salary,
						contractStart: p.startYear,
						contractEnd: p.endYear
					};
				}),
				picks: (receives.picks || []).map(function(p) {
					return { pickId: p.pickId };
				}),
				cash: (receives.cash || []).map(function(c) {
					return { 
						amount: c.amount, 
						season: c.season,
						fromFranchiseId: c.fromFranchiseId
					};
				}),
				rfaRights: []
			},
			drops: party.drops || []
		};
		
		transactionParties.push(txParty);
	}
	
	// Create the transaction
	var transaction = await Transaction.create({
		type: 'trade',
		timestamp: tradeDetails.timestamp || new Date(),
		source: tradeDetails.source || 'manual',
		wordpressTradeId: tradeDetails.wordpressTradeId,
		notes: tradeDetails.notes,
		parties: transactionParties
	});
	
	// Capture original contract ownership BEFORE updating anything
	// This is essential for correctly calculating budget deltas in multi-party trades
	var originalOwners = {}; // { playerId.toString(): { franchiseId, salary, startYear, endYear } }
	
	for (var i = 0; i < tradeDetails.parties.length; i++) {
		var party = tradeDetails.parties[i];
		var receives = party.receives || {};
		
		for (var j = 0; j < (receives.players || []).length; j++) {
			var playerInfo = receives.players[j];
			var playerId = playerInfo.playerId.toString();
			
			if (!originalOwners[playerId]) {
				var contract = await Contract.findOne({ playerId: playerInfo.playerId }).lean();
				if (contract) {
					originalOwners[playerId] = {
						franchiseId: contract.franchiseId,
						salary: contract.salary,
						startYear: contract.startYear,
						endYear: contract.endYear
					};
				}
			}
		}
	}
	
	// Apply the trade: update Contracts and Rosters
	for (var i = 0; i < tradeDetails.parties.length; i++) {
		var party = tradeDetails.parties[i];
		var receives = party.receives || {};
		var players = receives.players || [];
		
		for (var j = 0; j < players.length; j++) {
			var playerInfo = players[j];
			
			// Update Contract.franchiseId
			await Contract.updateOne(
				{ playerId: playerInfo.playerId },
				{ franchiseId: party.franchiseId }
			);
			
			// Update or create Roster entry
			await Roster.updateOne(
				{ playerId: playerInfo.playerId },
				{ 
					franchiseId: party.franchiseId,
					playerId: playerInfo.playerId,
					acquiredVia: transaction._id
				},
				{ upsert: true }
			);
		}
	}
	
	// Apply the trade: update Pick ownership
	for (var i = 0; i < tradeDetails.parties.length; i++) {
		var party = tradeDetails.parties[i];
		var receives = party.receives || {};
		var picks = receives.picks || [];
		
		for (var j = 0; j < picks.length; j++) {
			var pickInfo = picks[j];
			
			await Pick.updateOne(
				{ _id: pickInfo.pickId },
				{ currentFranchiseId: party.franchiseId }
			);
		}
	}
	
	// Update Budget documents for all affected franchises/seasons
	var currentSeason = config.season;
	var budgetUpdates = {}; // { 'franchiseId:season': { payrollDelta, cashInDelta, cashOutDelta } }
	
	function getBudgetKey(franchiseId, season) {
		return franchiseId.toString() + ':' + season;
	}
	
	function ensureBudgetUpdate(franchiseId, season) {
		var key = getBudgetKey(franchiseId, season);
		if (!budgetUpdates[key]) {
			budgetUpdates[key] = { franchiseId: franchiseId, season: season, payrollDelta: 0, cashInDelta: 0, cashOutDelta: 0 };
		}
		return budgetUpdates[key];
	}
	
	// Track salary and cash changes from player and cash movements
	for (var i = 0; i < tradeDetails.parties.length; i++) {
		var party = tradeDetails.parties[i];
		var receives = party.receives || {};
		
		for (var j = 0; j < (receives.players || []).length; j++) {
			var playerInfo = receives.players[j];
			var playerId = playerInfo.playerId.toString();
			var original = originalOwners[playerId];
			
			if (!original) continue; // Shouldn't happen if validation passed
			
			var salary = original.salary || 0;
			var startYear = original.startYear;
			var endYear = original.endYear;
			
			// Update payroll for seasons this contract covers
			for (var season = Math.max(startYear, currentSeason); season <= endYear && season <= currentSeason + 2; season++) {
				// Receiving franchise gains payroll
				ensureBudgetUpdate(party.franchiseId, season).payrollDelta += salary;
				
				// Sending franchise (original owner) loses payroll
				ensureBudgetUpdate(original.franchiseId, season).payrollDelta -= salary;
			}
		}
		
		// Track cash movements
		for (var j = 0; j < (receives.cash || []).length; j++) {
			var cashInfo = receives.cash[j];
			ensureBudgetUpdate(party.franchiseId, cashInfo.season).cashInDelta += cashInfo.amount;
			ensureBudgetUpdate(cashInfo.fromFranchiseId, cashInfo.season).cashOutDelta += cashInfo.amount;
		}
	}
	
	// Apply the budget updates
	var budgetKeys = Object.keys(budgetUpdates);
	for (var i = 0; i < budgetKeys.length; i++) {
		var update = budgetUpdates[budgetKeys[i]];
		
		await Budget.updateOne(
			{ franchiseId: update.franchiseId, season: update.season },
			{
				$inc: {
					payroll: update.payrollDelta,
					cashIn: update.cashInDelta,
					cashOut: update.cashOutDelta,
					available: -update.payrollDelta + update.cashInDelta - update.cashOutDelta
				}
			}
		);
	}
	
	return { 
		success: true, 
		transaction: transaction,
		warnings: cashValidation.warnings || []
	};
}

/**
 * Validate a trade without applying it.
 * Useful for checking legality before committing.
 */
async function validateTrade(tradeDetails) {
	// TODO: Implement budget validation (cap checks)
	// For now, just use processTrade's validation logic
	// We could refactor to share validation code
	
	var result = await processTrade({
		...tradeDetails,
		dryRun: true  // TODO: implement dry run mode
	});
	
	return result;
}

module.exports = {
	processTrade: processTrade,
	validateTrade: validateTrade,
	validateBudgetImpact: validateBudgetImpact,
	computeDeadMoneyForSeason: computeDeadMoneyForSeason,
	computeReclaimable: computeReclaimable
};
