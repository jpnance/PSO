var Contract = require('../models/Contract');
var Budget = require('../models/Budget');
var Pick = require('../models/Pick');
var Transaction = require('../models/Transaction');
var LeagueConfig = require('../models/LeagueConfig');

var ROLLBACK_ELIGIBLE_TYPES = [
	'auction-ufa',
	'auction-rfa-matched',
	'auction-rfa-unmatched',
	'draft-select',
	'draft-pass'
];

async function rollbackTransaction(transactionId) {
	var tx = await Transaction.findById(transactionId);
	
	if (!tx) {
		return { success: false, error: 'Transaction not found' };
	}
	
	if (!ROLLBACK_ELIGIBLE_TYPES.includes(tx.type)) {
		return { success: false, error: 'Rollback not supported for transaction type: ' + tx.type };
	}
	
	var result;
	
	switch (tx.type) {
		case 'auction-ufa':
		case 'auction-rfa-matched':
		case 'auction-rfa-unmatched':
			result = await rollbackAuction(tx);
			break;
		case 'draft-select':
			result = await rollbackDraftSelect(tx);
			break;
		case 'draft-pass':
			result = await rollbackDraftPass(tx);
			break;
		default:
			return { success: false, error: 'No rollback handler for type: ' + tx.type };
	}
	
	if (!result.success) {
		return result;
	}
	
	await Transaction.deleteOne({ _id: tx._id });
	
	return { success: true, type: tx.type };
}

async function rollbackAuction(tx) {
	var config = await LeagueConfig.findById('pso');
	var season = config ? config.season : new Date().getFullYear();
	
	var contract = await Contract.findOne({
		playerId: tx.playerId,
		franchiseId: tx.franchiseId,
		salary: tx.winningBid
	});
	
	if (!contract) {
		return { success: false, error: 'Contract not found for this auction result' };
	}
	
	if (contract.endYear !== null) {
		return { 
			success: false, 
			error: 'Cannot roll back: contract has already been signed (endYear set)' 
		};
	}
	
	await Contract.deleteOne({ _id: contract._id });
	
	await Budget.updateOne(
		{ franchiseId: tx.franchiseId, season: season },
		{
			$inc: {
				payroll: -tx.winningBid,
				available: tx.winningBid
			}
		}
	);
	
	if ((tx.type === 'auction-rfa-matched' || tx.type === 'auction-rfa-unmatched') && tx.rfaHolderId) {
		await Contract.create({
			playerId: tx.playerId,
			franchiseId: tx.rfaHolderId,
			salary: null,
			startYear: null,
			endYear: null
		});
	}
	
	return { success: true };
}

async function rollbackDraftSelect(tx) {
	var config = await LeagueConfig.findById('pso');
	var season = config ? config.season : new Date().getFullYear();
	
	var contract = await Contract.findOne({
		playerId: tx.playerId,
		franchiseId: tx.franchiseId
	});
	
	if (!contract) {
		return { success: false, error: 'Contract not found for this draft selection' };
	}
	
	if (contract.endYear !== null) {
		return { 
			success: false, 
			error: 'Cannot roll back: contract has already been signed (endYear set)' 
		};
	}
	
	var salary = contract.salary || tx.salary || 0;
	
	await Contract.deleteOne({ _id: contract._id });
	
	await Budget.updateOne(
		{ franchiseId: tx.franchiseId, season: season },
		{
			$inc: {
				payroll: -salary,
				available: salary
			}
		}
	);
	
	if (tx.pickId) {
		await Pick.updateOne(
			{ _id: tx.pickId },
			{
				status: 'available',
				$unset: { transactionId: 1 }
			}
		);
	}
	
	return { success: true };
}

async function rollbackDraftPass(tx) {
	if (tx.pickId) {
		await Pick.updateOne(
			{ _id: tx.pickId },
			{
				status: 'available',
				$unset: { transactionId: 1 }
			}
		);
	}
	
	return { success: true };
}

module.exports = {
	rollbackTransaction: rollbackTransaction,
	ROLLBACK_ELIGIBLE_TYPES: ROLLBACK_ELIGIBLE_TYPES
};
