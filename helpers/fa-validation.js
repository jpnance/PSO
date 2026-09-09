var Transaction = require('../models/Transaction');
var Contract = require('../models/Contract');
var Budget = require('../models/Budget');

// Lazy require to avoid circular dependency
var _transactionService = null;
function getTransactionService() {
	if (!_transactionService) {
		_transactionService = require('../services/transaction');
	}
	return _transactionService;
}

/**
 * Find the most recent drop transaction for a player.
 * 
 * @param {ObjectId} playerId - The player to look up
 * @returns {Promise<{franchiseId, timestamp}|null>}
 */
async function findLastDrop(playerId) {
	var transaction = await Transaction.findOne({
		type: 'fa',
		'drops.playerId': playerId
	}).sort({ timestamp: -1 }).lean();
	
	if (!transaction) return null;
	
	return {
		franchiseId: transaction.franchiseId,
		timestamp: transaction.timestamp
	};
}

/**
 * Check if a player pickup violates cooldown rules.
 * 
 * Rules:
 * 1. 24-hour rule: A dropped player can't be picked up by anyone for 24 hours
 * 2. 1-week own-drop rule (FAAB only): If you drop a player, you can't pick
 *    them back up via FAAB for 1 week
 * 
 * @param {ObjectId} playerId - The player being picked up
 * @param {ObjectId} franchiseId - The franchise picking them up
 * @param {Date} pickupTime - When the pickup is happening
 * @param {string} transactionType - 'waiver' or 'free_agent'
 * @returns {Promise<{valid: boolean, reason?: string}>}
 */
async function checkCooldown(playerId, franchiseId, pickupTime, transactionType) {
	var lastDrop = await findLastDrop(playerId);
	
	if (!lastDrop) {
		// Player was never dropped, no cooldown applies
		return { valid: true };
	}
	
	var hoursSinceDrop = (pickupTime - lastDrop.timestamp) / (1000 * 60 * 60);
	var daysSinceDrop = hoursSinceDrop / 24;
	var sameOwner = lastDrop.franchiseId.toString() === franchiseId.toString();
	
	// 24-hour rule - applies to everyone
	if (hoursSinceDrop < 24) {
		return {
			valid: false,
			reason: 'Player was dropped less than 24 hours ago (dropped ' + 
				Math.round(hoursSinceDrop) + ' hours ago)'
		};
	}
	
	// 1-week own-drop rule - only for waiver (FAAB) type
	if (transactionType === 'waiver' && sameOwner && daysSinceDrop < 7) {
		return {
			valid: false,
			reason: 'Cannot pick up own drop via FAAB within 1 week (dropped ' +
				daysSinceDrop.toFixed(1) + ' days ago)'
		};
	}
	
	return { valid: true };
}

/**
 * Check if a franchise can afford a FAAB bid, accounting for any drops
 * that would happen as part of the same transaction.
 * 
 * @param {ObjectId} franchiseId - The franchise making the bid
 * @param {number} season - The current season
 * @param {number} bidAmount - The FAAB bid amount
 * @param {Array<ObjectId>} [dropPlayerIds] - Players being dropped in same transaction
 * @returns {Promise<{valid: boolean, reason?: string, available?: number, effectiveAvailable?: number}>}
 */
async function checkBudget(franchiseId, season, bidAmount, dropPlayerIds) {
	dropPlayerIds = dropPlayerIds || [];
	
	var budget = await Budget.findOne({ franchiseId: franchiseId, season: season }).lean();
	if (!budget) {
		return { valid: false, reason: 'No budget found for franchise' };
	}
	
	var available = budget.available;
	var recoveryFromDrops = 0;
	
	// Calculate cap recovery from drops
	for (var i = 0; i < dropPlayerIds.length; i++) {
		var contract = await Contract.findOne({
			playerId: dropPlayerIds[i],
			franchiseId: franchiseId,
			endYear: { $gte: season }
		}).lean();
		
		if (contract) {
			var salary = contract.salary || 0;
			var startYear = contract.startYear;
			var endYear = contract.endYear;
			
			// Calculate buyout for current season
			var buyout = getTransactionService().computeBuyOutForSeason(salary, startYear, endYear, season, season);
			
			// Recovery = salary - buyout
			recoveryFromDrops += (salary - buyout);
		}
	}
	
	var effectiveAvailable = available + recoveryFromDrops;
	
	if (bidAmount > effectiveAvailable) {
		return {
			valid: false,
			reason: 'Insufficient budget: bid $' + bidAmount + ', available $' + 
				available + ' + $' + recoveryFromDrops + ' from drops = $' + effectiveAvailable,
			available: available,
			effectiveAvailable: effectiveAvailable
		};
	}
	
	return {
		valid: true,
		available: available,
		effectiveAvailable: effectiveAvailable
	};
}

/**
 * Check if a franchise actually owns a player (for drop validation).
 * 
 * @param {ObjectId} franchiseId - The franchise
 * @param {ObjectId} playerId - The player
 * @param {number} season - The current season
 * @returns {Promise<{valid: boolean, reason?: string}>}
 */
async function checkOwnership(franchiseId, playerId, season) {
	var contract = await Contract.findOne({
		playerId: playerId,
		franchiseId: franchiseId,
		endYear: { $gte: season }
	}).lean();
	
	if (!contract) {
		return {
			valid: false,
			reason: 'Franchise does not own this player'
		};
	}
	
	return { valid: true, contract: contract };
}

/**
 * Check if a franchise has roster space for an add.
 * 
 * @param {ObjectId} franchiseId - The franchise
 * @param {number} season - The current season
 * @param {number} [dropCount=0] - Number of players being dropped in same transaction
 * @returns {Promise<{valid: boolean, reason?: string, currentSize?: number}>}
 */
async function checkRosterSpace(franchiseId, season, dropCount) {
	dropCount = dropCount || 0;
	var LeagueConfig = require('../models/LeagueConfig');
	var ROSTER_LIMIT = LeagueConfig.ROSTER_LIMIT;
	
	var currentRosterSize = await Contract.countDocuments({
		franchiseId: franchiseId,
		endYear: { $gte: season }
	});
	
	var effectiveSize = currentRosterSize - dropCount;
	
	if (effectiveSize >= ROSTER_LIMIT) {
		return {
			valid: false,
			reason: 'Roster is full (' + currentRosterSize + '/' + ROSTER_LIMIT + 
				', ' + dropCount + ' drops)',
			currentSize: currentRosterSize
		};
	}
	
	return { valid: true, currentSize: currentRosterSize };
}

/**
 * Validate a complete Sleeper transaction before processing.
 * 
 * @param {Object} opts
 * @param {ObjectId} opts.franchiseId - The franchise
 * @param {number} opts.season - Current season
 * @param {Array<{playerId}>} [opts.adds] - Players being added
 * @param {Array<{playerId}>} [opts.drops] - Players being dropped  
 * @param {number} [opts.bidAmount] - FAAB bid (for waiver type)
 * @param {string} opts.transactionType - 'waiver' or 'free_agent'
 * @param {Date} opts.timestamp - Transaction timestamp
 * @returns {Promise<{valid: boolean, errors: string[]}>}
 */
async function validateTransaction(opts) {
	var errors = [];
	var adds = opts.adds || [];
	var drops = opts.drops || [];
	
	// Check ownership for all drops
	for (var i = 0; i < drops.length; i++) {
		var ownership = await checkOwnership(opts.franchiseId, drops[i].playerId, opts.season);
		if (!ownership.valid) {
			errors.push('Drop validation failed: ' + ownership.reason);
		}
	}
	
	// Check roster space for adds
	if (adds.length > 0) {
		var rosterCheck = await checkRosterSpace(opts.franchiseId, opts.season, drops.length);
		if (!rosterCheck.valid) {
			errors.push('Roster space: ' + rosterCheck.reason);
		}
	}
	
	// Check budget for FAAB bids
	if (opts.transactionType === 'waiver' && opts.bidAmount > 0) {
		var dropPlayerIds = drops.map(function(d) { return d.playerId; });
		var budgetCheck = await checkBudget(opts.franchiseId, opts.season, opts.bidAmount, dropPlayerIds);
		if (!budgetCheck.valid) {
			errors.push('Budget: ' + budgetCheck.reason);
		}
	}
	
	// Check cooldowns for adds
	for (var i = 0; i < adds.length; i++) {
		var cooldownCheck = await checkCooldown(
			adds[i].playerId,
			opts.franchiseId,
			opts.timestamp,
			opts.transactionType
		);
		if (!cooldownCheck.valid) {
			errors.push('Cooldown violation for pickup: ' + cooldownCheck.reason);
		}
	}
	
	return {
		valid: errors.length === 0,
		errors: errors
	};
}

module.exports = {
	findLastDrop: findLastDrop,
	checkCooldown: checkCooldown,
	checkBudget: checkBudget,
	checkOwnership: checkOwnership,
	checkRosterSpace: checkRosterSpace,
	validateTransaction: validateTransaction
};
