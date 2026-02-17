var mongoose = require('mongoose');

var Transaction = require('../models/Transaction');
var Contract = require('../models/Contract');
var Pick = require('../models/Pick');
var Player = require('../models/Player');
var Franchise = require('../models/Franchise');
var Regime = require('../models/Regime');
var LeagueConfig = require('../models/LeagueConfig');
var Budget = require('../models/Budget');
var Game = require('../models/Game');
var budgetHelper = require('../helpers/budget');

var computeRecoverableForContract = budgetHelper.computeRecoverableForContract;

// First-round rookie salaries by year and position
var rookieSalaries = {
	'2026': { 'DB': 2, 'DL': 2, 'K': 1, 'LB': 1, 'QB': 40, 'RB': 20, 'TE': 11, 'WR': 17 },
	'2025': { 'DB': 2, 'DL': 2, 'K': 1, 'LB': 1, 'QB': 44, 'RB': 21, 'TE': 9, 'WR': 16 },
	'2024': { 'DB': 2, 'DL': 2, 'K': 1, 'LB': 1, 'QB': 40, 'RB': 23, 'TE': 9, 'WR': 16 },
	'2023': { 'DB': 2, 'DL': 2, 'K': 2, 'LB': 1, 'QB': 30, 'RB': 25, 'TE': 14, 'WR': 16 },
	'2022': { 'DB': 1, 'DL': 2, 'K': 2, 'LB': 1, 'QB': 37, 'RB': 25, 'TE': 8, 'WR': 16 },
	'2021': { 'DB': 1, 'DL': 2, 'K': 1, 'LB': 1, 'QB': 29, 'RB': 25, 'TE': 5, 'WR': 16 },
	'2020': { 'DB': 2, 'DL': 1, 'K': 1, 'LB': 1, 'QB': 32, 'RB': 25, 'TE': 7, 'WR': 16 },
	'2019': { 'DB': 1, 'DL': 2, 'K': 1, 'LB': 1, 'QB': 38, 'RB': 25, 'TE': 10, 'WR': 16 },
	'2018': { 'DB': 2, 'DL': 3, 'K': 2, 'LB': 2, 'QB': 28, 'RB': 25, 'TE': 14, 'WR': 18 },
	'2017': { 'DB': 2, 'DL': 2, 'K': 2, 'LB': 1, 'QB': 31, 'RB': 24, 'TE': 17, 'WR': 18 },
	'2016': { 'DB': 2, 'DL': 3, 'K': 1, 'LB': 2, 'QB': 32, 'RB': 25, 'TE': 15, 'WR': 17 },
	'2015': { 'DB': 2, 'DL': 3, 'K': 1, 'LB': 1, 'QB': 24, 'RB': 27, 'TE': 15, 'WR': 17 },
	'2014': { 'DB': 2, 'DL': 2, 'K': 2, 'LB': 1, 'QB': 19, 'RB': 24, 'TE': 28, 'WR': 19 },
	'2013': { 'DB': 2, 'DL': 3, 'K': 1, 'LB': 2, 'QB': 17, 'RB': 26, 'TE': 18, 'WR': 18 },
	'2012': { 'DB': 1, 'DL': 1, 'K': 1, 'LB': 1, 'QB': 25, 'RB': 25, 'TE': 7, 'WR': 16 },
	'2011': { 'DB': 1, 'DL': 1, 'K': 1, 'LB': 2, 'QB': 25, 'RB': 25, 'TE': 3, 'WR': 26 },
	'2010': { 'DB': 1, 'DL': 2, 'K': 1, 'LB': 2, 'QB': 24, 'RB': 28, 'TE': 4, 'WR': 15 },
	'2009': { 'DB': 12.4, 'DL': 13.4, 'K': 2.2, 'LB': 14, 'QB': 124.5, 'RB': 270.2, 'TE': 53, 'WR': 137.3 }
};

// Calculate rookie salary for a given season, round, and positions
// Takes the max salary across all eligible positions
function getRookieSalary(season, round, positions) {
	var yearSalaries = rookieSalaries[String(season)];
	if (!yearSalaries || !positions || positions.length === 0) return null;
	
	var maxBase = 0;
	for (var i = 0; i < positions.length; i++) {
		var pos = positions[i];
		var base = yearSalaries[pos] || 0;
		if (base > maxBase) maxBase = base;
	}
	
	if (maxBase === 0) return null;
	
	// 2009 uses linear decay: 100% in round 1 down to 10% in round 10
	// 2010+ uses exponential halving: value / 2^(round-1)
	if (season <= 2009) {
		return Math.ceil(maxBase * (11 - round) / 10);
	} else {
		return Math.ceil(maxBase / Math.pow(2, round - 1));
	}
}

// Format a dollar amount with sign before $ (e.g., -$163, +$50)
function formatDollars(amount, showPlus) {
	if (amount < 0) {
		return '-$' + Math.abs(amount);
	} else if (showPlus && amount > 0) {
		return '+$' + amount;
	} else {
		return '$' + amount;
	}
}

// Get display name for a franchise
async function getFranchiseDisplayName(franchiseId, season) {
	return await Regime.getDisplayName(franchiseId, season);
}

/**
 * Compute buy-out for a single season if a contract is cut.
 * Contract years get 60%/30%/15% for year 1/2/3 of contract.
 * 
 * @param {number} salary - Contract salary
 * @param {number} startYear - Contract start year (null for FA = single-year)
 * @param {number} endYear - Contract end year
 * @param {number} cutYear - Season when the cut occurs
 * @param {number} targetSeason - Season to calculate buy-out for
 * @returns {number} Buyout amount for targetSeason (0 if not applicable)
 */
function computeBuyOutForSeason(salary, startYear, endYear, cutYear, targetSeason) {
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
 * Compute total recoverable budget if a franchise cut all their players.
 * Recoverable = salary saved - buy-out incurred (for a single season).
 * 
 * @param {ObjectId} franchiseId - Franchise to calculate for
 * @param {number} season - Season to calculate for
 * @returns {Promise<number>} Total recoverable amount
 */
async function computeRecoverable(franchiseId, season) {
	var contracts = await Contract.find({
		franchiseId: franchiseId,
		endYear: { $gte: season },
		startYear: { $lte: season }
	}).lean();
	
	var totalRecoverable = 0;
	
	for (var i = 0; i < contracts.length; i++) {
		var contract = contracts[i];
		var salary = contract.salary || 0;
		var startYear = contract.startYear;
		var endYear = contract.endYear;
		
		// If cut this season, what buy-out would we incur for THIS season?
		var buyOut = computeBuyOutForSeason(salary, startYear, endYear, season, season);
		
		// Recoverable = salary we stop paying - buy-out we incur
		var recoverable = salary - buyOut;
		totalRecoverable += recoverable;
	}
	
	return totalRecoverable;
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
	var recoverable = await computeRecoverable(franchiseId, season);
	
	if (resultingBudget + recoverable >= 0) {
		var franchiseName = await getFranchiseDisplayName(franchiseId, config.season);
		return { 
			valid: true, 
			warning: franchiseName + ' would be ' + formatDollars(-resultingBudget) + ' over the soft cap in ' + season
		};
	}
	
	var shortfall = -(resultingBudget + recoverable);
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
			
			// Get franchise display name (use current season for regime lookup)
			var franchiseName = await getFranchiseDisplayName(franchiseId, currentSeason);
			
			// Look up current available budget
			var budget = await Budget.findOne({ franchiseId: franchiseId, season: season });
			if (!budget) {
				errors.push('No budget found for ' + franchiseName + ' in ' + season);
				continue;
			}
			var resultingBudget = budget.available + netChange;
			
			if (resultingBudget < 0) {
				var message = franchiseName + ' would have ' + formatDollars(resultingBudget) + ' available in ' + season;
				
				// Hard cap for current season after cut day - no way out
				if (season === currentSeason && hardCapActive) {
					errors.push(message + ' (hard cap violation)');
				} else {
					// Soft cap - check if they could cut their way out
					var recoverable = await computeRecoverable(franchiseId, season);
					
					if (resultingBudget + recoverable >= 0) {
						// They could cut their way back to $0 or better - soft cap
						warnings.push(franchiseName + ' would be ' + formatDollars(-resultingBudget) + ' over the soft cap in ' + season);
					} else {
						// Even cutting everyone wouldn't save them
						var shortfall = -(resultingBudget + recoverable);
						errors.push(message + ' (' + formatDollars(shortfall) + ' short even after cutting all players)');
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
 * @param {number} [tradeDetails.tradeId] - Trade ID (auto-assigned if not provided)
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
	
	// Load config early so we have access to currentSeason for display names
	var config = await LeagueConfig.findById('pso');
	if (!config) {
		config = new LeagueConfig({ 
			_id: 'pso',
			season: new Date().getFullYear()
		});
	}
	var currentSeason = config.season;
	
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
	
	// Build a map of which franchises are giving up players
	var franchisesGivingPlayers = {};
	for (var i = 0; i < tradeDetails.parties.length; i++) {
		var party = tradeDetails.parties[i];
		var receives = party.receives || {};
		var players = receives.players || [];
		
		for (var j = 0; j < players.length; j++) {
			var playerInfo = players[j];
			var contract = await Contract.findOne({ playerId: playerInfo.playerId });
			if (contract) {
				franchisesGivingPlayers[contract.franchiseId.toString()] = true;
			}
		}
	}
	
	// Validate that each party either receives something OR is giving up a player
	for (var i = 0; i < tradeDetails.parties.length; i++) {
		var party = tradeDetails.parties[i];
		var receives = party.receives || {};
		var receivesPlayers = (receives.players || []).length;
		var receivesPicks = (receives.picks || []).length;
		var receivesCash = (receives.cash || []).length;
		var receivesNothing = (receivesPlayers + receivesPicks + receivesCash) === 0;
		
		if (receivesNothing) {
			var isGivingPlayer = franchisesGivingPlayers[party.franchiseId.toString()];
			if (!isGivingPlayer) {
				var franchiseName = await getFranchiseDisplayName(party.franchiseId, currentSeason);
				errors.push(franchiseName + ' must receive something in return (or be trading away a player)');
			}
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
	
	// Check if trades are allowed (warn but don't block for commissioner)
	var phaseWarnings = [];
	if (!config.areTradesEnabled()) {
		phaseWarnings.push('This trade is during the ' + config.getPhase().replace(/-/g, ' ') + ' phase');
	}
	
	var cashValidation = await validateTradeCash(tradeDetails, {
		season: config.season,
		hardCapActive: config.isHardCapActive()
	});
	
	// Combine all warnings
	var allWarnings = phaseWarnings.concat(cashValidation.warnings || []);
	
	if (!cashValidation.valid) {
		return { success: false, errors: cashValidation.errors, warnings: allWarnings };
	}
	
	// Validate roster limits
	// Each franchise's post-trade roster must not exceed the limit
	// RFA rights (salary === null) don't count against roster limit
	for (var i = 0; i < tradeDetails.parties.length; i++) {
		var party = tradeDetails.parties[i];
		var receives = party.receives || {};
		
		// Count current roster (contracts with salary, not RFA rights)
		var currentContracts = await Contract.find({
			franchiseId: party.franchiseId,
			salary: { $ne: null }
		});
		var currentRosterCount = currentContracts.length;
		
		// Count players coming in (excluding RFA rights)
		var playersIn = (receives.players || []).filter(function(p) {
			return p.salary !== null;
		}).length;
		
		// Count players going out (to other parties)
		var playersOut = 0;
		for (var j = 0; j < tradeDetails.parties.length; j++) {
			if (i === j) continue;
			var otherParty = tradeDetails.parties[j];
			var otherReceives = otherParty.receives || {};
			var otherPlayers = otherReceives.players || [];
			
			for (var k = 0; k < otherPlayers.length; k++) {
				var playerInfo = otherPlayers[k];
				// Check if this player is currently on party[i]'s roster
				var contract = currentContracts.find(function(c) {
					return c.playerId.equals(playerInfo.playerId);
				});
				if (contract && contract.salary !== null) {
					playersOut++;
				}
			}
		}
		
		var newRosterCount = currentRosterCount + playersIn - playersOut;
		
		if (newRosterCount > LeagueConfig.ROSTER_LIMIT) {
			var franchiseName = await getFranchiseDisplayName(party.franchiseId, config.season);
			errors.push(franchiseName + ' would have ' + newRosterCount + ' players (limit is ' + LeagueConfig.ROSTER_LIMIT + ')');
		}
	}
	
	if (errors.length > 0) {
		return { success: false, errors: errors };
	}
	
	// Build the transaction document
	var transactionParties = [];
	
	for (var i = 0; i < tradeDetails.parties.length; i++) {
		var party = tradeDetails.parties[i];
		var receives = party.receives || {};
		
		// Look up picks to get denormalized data for transaction storage
		var picksData = [];
		for (var j = 0; j < (receives.picks || []).length; j++) {
			var pickInfo = receives.picks[j];
			var pick = await Pick.findById(pickInfo.pickId).lean();
			if (pick) {
				picksData.push({
					round: pick.round,
					season: pick.season,
					fromFranchiseId: pick.originalFranchiseId
				});
			}
		}
		
		var regimeName = await getFranchiseDisplayName(party.franchiseId, currentSeason);
		
		var txParty = {
			franchiseId: party.franchiseId,
			regimeName: regimeName || null,
			receives: {
				players: (receives.players || []).map(function(p) {
					return {
						playerId: p.playerId,
						salary: p.salary,
						startYear: p.startYear,
						endYear: p.endYear
					};
				}),
				picks: picksData,
				cash: (receives.cash || []).map(function(c) {
					return { 
						amount: c.amount, 
						season: c.season,
						fromFranchiseId: c.fromFranchiseId
					};
				}),
				rfaRights: []
			}
		};
		
		transactionParties.push(txParty);
	}
	
	// If validateOnly, return here without applying changes
	if (tradeDetails.validateOnly) {
		return { 
			success: true, 
			validated: true,
			warnings: allWarnings
		};
	}
	
	// Determine the trade ID
	var tradeId = tradeDetails.tradeId;
	if (!tradeId) {
		// Auto-increment: find the highest existing tradeId and add 1
		var lastTrade = await Transaction.findOne({ type: 'trade', tradeId: { $ne: null } })
			.sort({ tradeId: -1 })
			.lean();
		tradeId = lastTrade && lastTrade.tradeId ? lastTrade.tradeId + 1 : 1;
	}
	
	// Create the transaction
	var transaction = await Transaction.create({
		type: 'trade',
		timestamp: tradeDetails.timestamp || new Date(),
		source: tradeDetails.source || 'manual',
		tradeId: tradeId,
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
			
			// Update Contract.franchiseId and reset cut mark (new owner decides)
			await Contract.updateOne(
				{ playerId: playerInfo.playerId },
				{ franchiseId: party.franchiseId, markedForCut: false, markedForCutAt: null }
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
	var budgetUpdates = {}; // { 'franchiseId:season': { payrollDelta, recoverableDelta, cashInDelta, cashOutDelta } }
	
	function getBudgetKey(franchiseId, season) {
		return franchiseId.toString() + ':' + season;
	}
	
	function ensureBudgetUpdate(franchiseId, season) {
		var key = getBudgetKey(franchiseId, season);
		if (!budgetUpdates[key]) {
			budgetUpdates[key] = { franchiseId: franchiseId, season: season, payrollDelta: 0, recoverableDelta: 0, cashInDelta: 0, cashOutDelta: 0 };
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
			
			// Update payroll and recoverable for seasons this contract covers
			for (var season = Math.max(startYear, currentSeason); season <= endYear && season <= currentSeason + 2; season++) {
				var recoverableAmount = computeRecoverableForContract(salary, startYear, endYear, season);
				
				// Receiving franchise gains payroll and recoverable
				ensureBudgetUpdate(party.franchiseId, season).payrollDelta += salary;
				ensureBudgetUpdate(party.franchiseId, season).recoverableDelta += recoverableAmount;
				
				// Sending franchise (original owner) loses payroll and recoverable
				ensureBudgetUpdate(original.franchiseId, season).payrollDelta -= salary;
				ensureBudgetUpdate(original.franchiseId, season).recoverableDelta -= recoverableAmount;
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
					recoverable: update.recoverableDelta,
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
		warnings: allWarnings
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

/**
 * Process a player cut.
 * 
 * @param {Object} cutDetails
 * @param {ObjectId} cutDetails.franchiseId - Franchise cutting the player
 * @param {ObjectId} cutDetails.playerId - Player being cut
 * @param {Date} [cutDetails.timestamp] - When the cut occurred (defaults to now)
 * @param {string} [cutDetails.source] - 'manual', 'sleeper', etc. (defaults to 'manual')
 * @param {string} [cutDetails.notes] - Optional notes
 * @param {ObjectId} [cutDetails.facilitatedTradeId] - If this cut is part of a trade
 * 
 * @returns {Object} { success: boolean, transaction?: Transaction, errors?: string[] }
 */
async function processCut(cutDetails) {
	var errors = [];
	
	// Validate franchise exists
	var franchise = await Franchise.findById(cutDetails.franchiseId);
	if (!franchise) {
		errors.push('Franchise not found: ' + cutDetails.franchiseId);
		return { success: false, errors: errors };
	}
	
	// Find the player's active contract on this franchise
	var config = await LeagueConfig.findById('pso');
	var currentSeason = config ? config.season : new Date().getFullYear();
	
	// Check if cuts are allowed in the current phase
	// Skip this check for admin/system operations (source !== 'manual')
	if (cutDetails.source === 'manual' && config) {
		var phase = config.getPhase();
		var cutsAllowed = config.areCutsEnabled();
		
		if (!cutsAllowed) {
			errors.push('Cuts are not allowed during the ' + phase.replace(/-/g, ' ') + ' phase');
			return { success: false, errors: errors };
		}
		
		// During playoff-fa, only playoff teams can cut players
		if (phase === 'playoff-fa') {
			var isPlayoffTeam = await Game.exists({
				season: currentSeason,
				type: 'semifinal',
				$or: [
					{ 'away.franchiseId': franchise.rosterId },
					{ 'home.franchiseId': franchise.rosterId }
				]
			});
			
			if (!isPlayoffTeam) {
				errors.push('Only playoff teams can cut players during the playoff FA phase');
				return { success: false, errors: errors };
			}
		}
	}
	
	var contract = await Contract.findOne({
		playerId: cutDetails.playerId,
		franchiseId: cutDetails.franchiseId,
		endYear: { $gte: currentSeason }
	});
	
	if (!contract) {
		var player = await Player.findById(cutDetails.playerId);
		var playerName = player ? player.name : cutDetails.playerId;
		errors.push('No active contract found for ' + playerName + ' on this franchise');
		return { success: false, errors: errors };
	}
	
	// Compute buy-outs for each remaining season
	var buyOutEntries = [];
	var salary = contract.salary || 0;
	var startYear = contract.startYear;
	var endYear = contract.endYear;
	
	for (var season = currentSeason; season <= endYear; season++) {
		var amount = computeBuyOutForSeason(salary, startYear, endYear, currentSeason, season);
		if (amount > 0) {
			buyOutEntries.push({ season: season, amount: amount });
		}
	}
	
	// Update Budget for each affected season
	for (var i = 0; i < buyOutEntries.length; i++) {
		var bo = buyOutEntries[i];
		var recoverableForSeason = computeRecoverableForContract(salary, startYear, endYear, bo.season);
		
		await Budget.updateOne(
			{ franchiseId: cutDetails.franchiseId, season: bo.season },
			{
				$inc: {
					payroll: -salary,
					buyOuts: bo.amount,
					recoverable: -recoverableForSeason,
					available: salary - bo.amount
				}
			}
		);
	}
	
	// Also update future seasons where contract would have been active but no buy-out
	// (salary is freed up entirely)
	for (var season = currentSeason; season <= endYear; season++) {
		var hasBO = buyOutEntries.some(function(bo) { return bo.season === season; });
		if (!hasBO) {
			var recoverableForSeason = computeRecoverableForContract(salary, startYear, endYear, season);
			await Budget.updateOne(
				{ franchiseId: cutDetails.franchiseId, season: season },
				{
					$inc: {
						payroll: -salary,
						recoverable: -recoverableForSeason,
						available: salary
					}
				}
			);
		}
	}
	
	// Delete the Contract
	await Contract.deleteOne({ _id: contract._id });
	
	// Determine if this is an offseason cut (vs in-season release)
	var phase = config ? config.getPhase() : null;
	var offseasonPhases = ['dead-period', 'early-offseason', 'pre-season'];
	var isOffseason = phase && offseasonPhases.includes(phase);
	
	// Create the Transaction
	var transaction = await Transaction.create({
		type: 'fa',
		timestamp: cutDetails.timestamp || new Date(),
		source: cutDetails.source || 'manual',
		notes: cutDetails.notes,
		franchiseId: cutDetails.franchiseId,
		adds: [],
		drops: [{
			playerId: cutDetails.playerId,
			salary: salary,
			startYear: startYear,
			endYear: endYear,
			buyOuts: buyOutEntries,
			isOffseason: isOffseason || undefined
		}],
		facilitatedTradeId: cutDetails.facilitatedTradeId
	});
	
	return {
		success: true,
		transaction: transaction,
		buyOuts: buyOutEntries
	};
}

/**
 * Process a rookie draft selection.
 * Creates a draft-select transaction and updates the Pick record.
 * 
 * @param {Object} details - Draft pick details
 * @param {ObjectId} details.pickId - The Pick being used
 * @param {ObjectId} details.playerId - The Player being selected
 * @param {ObjectId} details.franchiseId - The franchise making the selection
 * @param {Date} [details.timestamp] - When the selection was made (defaults to now)
 * @param {string} [details.source] - Transaction source (defaults to 'manual')
 * @returns {Object} { success: boolean, transaction?, errors? }
 */
async function processDraftPick(details) {
	var errors = [];
	
	// Validate pick exists
	var pick = await Pick.findById(details.pickId);
	if (!pick) {
		errors.push('Pick not found: ' + details.pickId);
		return { success: false, errors: errors };
	}
	
	// Validate pick is available
	if (pick.status === 'used') {
		errors.push('Pick has already been used');
		return { success: false, errors: errors };
	}
	
	// Validate pick is owned by the franchise making the selection
	if (!pick.currentFranchiseId.equals(details.franchiseId)) {
		errors.push('Pick is not owned by this franchise');
		return { success: false, errors: errors };
	}
	
	// Validate player exists
	var player = await Player.findById(details.playerId);
	if (!player) {
		errors.push('Player not found: ' + details.playerId);
		return { success: false, errors: errors };
	}
	
	// Validate franchise exists
	var franchise = await Franchise.findById(details.franchiseId);
	if (!franchise) {
		errors.push('Franchise not found: ' + details.franchiseId);
		return { success: false, errors: errors };
	}
	
	if (errors.length > 0) {
		return { success: false, errors: errors };
	}
	
	// Capture player's current positions and calculate salary
	var draftedPositions = player.positions || [];
	var salary = getRookieSalary(pick.season, pick.round, draftedPositions);
	
	// Create the transaction
	var transaction = await Transaction.create({
		type: 'draft-select',
		timestamp: details.timestamp || new Date(),
		source: details.source || 'manual',
		franchiseId: details.franchiseId,
		playerId: details.playerId,
		pickId: details.pickId,
		draftedPositions: draftedPositions,
		salary: salary
	});
	
	// Update the pick
	pick.status = 'used';
	pick.transactionId = transaction._id;
	await pick.save();
	
	return {
		success: true,
		transaction: transaction
	};
}

module.exports = {
	processTrade: processTrade,
	validateTrade: validateTrade,
	processCut: processCut,
	processDraftPick: processDraftPick,
	validateBudgetImpact: validateBudgetImpact,
	computeBuyOutForSeason: computeBuyOutForSeason,
	computeRecoverable: computeRecoverable,
	computeRecoverableForContract: computeRecoverableForContract,
	getRookieSalary: getRookieSalary
};
