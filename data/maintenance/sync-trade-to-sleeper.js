#!/usr/bin/env node

/**
 * Sync a specific trade to Sleeper.
 * Use this to catch up trades that were processed before the auto-sync was implemented.
 * 
 * Usage:
 *   node data/maintenance/sync-trade-to-sleeper.js <tradeId>
 *   node data/maintenance/sync-trade-to-sleeper.js <tradeId> --dry-run
 */

var dotenv = require('dotenv').config({ path: __dirname + '/../../.env' });
var mongoose = require('mongoose');

var Transaction = require('../../models/Transaction');
var Player = require('../../models/Player');
var Franchise = require('../../models/Franchise');
var Budget = require('../../models/Budget');
var PSO = require('../../config/pso');
var sleeperHelper = require('../../helpers/sleeper');

var DRY_RUN = process.argv.includes('--dry-run');
var IS_PRODUCTION = process.env.NODE_ENV === 'production';

if (!DRY_RUN && !IS_PRODUCTION) {
	console.error('Error: Live runs only allowed in production.');
	console.error('Use --dry-run to preview changes.');
	process.exit(1);
}

var tradeId = parseInt(process.argv[2], 10);
if (!tradeId || isNaN(tradeId)) {
	console.error('Usage: node data/maintenance/sync-trade-to-sleeper.js <tradeId> [--dry-run]');
	process.exit(1);
}

async function main() {
	await mongoose.connect(process.env.MONGODB_URI);
	console.log('Connected to MongoDB\n');

	if (DRY_RUN) {
		console.log('DRY RUN - no changes will be made to Sleeper\n');
	}

	var trade = await Transaction.findOne({ type: 'trade', tradeId: tradeId }).lean();
	if (!trade) {
		console.error('Trade #' + tradeId + ' not found');
		process.exit(1);
	}

	console.log('=== Trade #' + trade.tradeId + ' ===');
	console.log('Date:', trade.timestamp);
	console.log('Parties:', trade.parties.length);
	console.log('');

	// Build player movements
	var allPlayers = [];
	trade.parties.forEach(function(party) {
		var receives = party.receives || {};
		(receives.players || []).forEach(function(p) {
			allPlayers.push({
				playerId: p.playerId,
				toFranchiseId: party.franchiseId
			});
		});
	});

	console.log('Players moved:', allPlayers.length);

	var movements = [];
	var affectedFranchiseIds = new Set();

	for (var i = 0; i < allPlayers.length; i++) {
		var p = allPlayers[i];
		var player = await Player.findById(p.playerId, 'name sleeperId').lean();
		var toFranchise = await Franchise.findById(p.toFranchiseId, 'rosterId').lean();

		// Find the "from" franchise
		var fromFranchiseId = null;
		for (var j = 0; j < trade.parties.length; j++) {
			var otherParty = trade.parties[j];
			if (otherParty.franchiseId.toString() === p.toFranchiseId.toString()) continue;

			var otherReceives = otherParty.receives || {};
			var otherPlayers = (otherReceives.players || []).map(function(op) { return op.playerId.toString(); });
			if (!otherPlayers.includes(p.playerId.toString())) {
				fromFranchiseId = otherParty.franchiseId;
				break;
			}
		}

		var fromFranchise = fromFranchiseId ? await Franchise.findById(fromFranchiseId, 'rosterId').lean() : null;

		var toName = PSO.franchiseNames[toFranchise.rosterId] ? PSO.franchiseNames[toFranchise.rosterId][PSO.season] : 'Roster ' + toFranchise.rosterId;
		var fromName = fromFranchise && PSO.franchiseNames[fromFranchise.rosterId] ? PSO.franchiseNames[fromFranchise.rosterId][PSO.season] : '???';

		console.log('  ' + (player ? player.name : p.playerId) + ': ' + fromName + ' -> ' + toName);

		if (player && player.sleeperId && toFranchise && toFranchise.rosterId && fromFranchise && fromFranchise.rosterId) {
			movements.push({
				sleeperId: player.sleeperId,
				fromRosterId: fromFranchise.rosterId,
				toRosterId: toFranchise.rosterId
			});
		}

		affectedFranchiseIds.add(p.toFranchiseId.toString());
		if (fromFranchiseId) affectedFranchiseIds.add(fromFranchiseId.toString());
	}

	// Sync player movements
	console.log('\n=== Syncing Players to Sleeper ===');
	if (movements.length > 0) {
		if (DRY_RUN) {
			console.log('Would sync ' + movements.length + ' player movement(s)');
			movements.forEach(function(m) {
				console.log('  sleeperId ' + m.sleeperId + ': roster ' + m.fromRosterId + ' -> ' + m.toRosterId);
			});
		} else {
			var result = await sleeperHelper.syncTradeMovements(movements);
			if (result.success) {
				console.log('Successfully synced ' + movements.length + ' player movement(s)');
			} else {
				console.error('Failed to sync players:', result.error);
			}
		}
	} else {
		console.log('No player movements to sync');
	}

	// Sync budgets
	console.log('\n=== Syncing Budgets to Sleeper ===');
	var franchisesForSync = [];
	for (var fid of affectedFranchiseIds) {
		var franchise = await Franchise.findById(fid, 'rosterId').lean();
		var budget = await Budget.findOne({ franchiseId: fid, season: PSO.season }).lean();

		if (franchise && franchise.rosterId && budget) {
			var name = PSO.franchiseNames[franchise.rosterId] ? PSO.franchiseNames[franchise.rosterId][PSO.season] : 'Roster ' + franchise.rosterId;
			console.log('  ' + name + ': $' + budget.available + ' available');
			franchisesForSync.push({
				franchiseId: fid,
				rosterId: franchise.rosterId,
				available: budget.available
			});
		}
	}

	if (franchisesForSync.length > 0) {
		if (DRY_RUN) {
			console.log('\nWould sync budgets for ' + franchisesForSync.length + ' franchise(s)');
		} else {
			var budgetResult = await sleeperHelper.syncBudgets(franchisesForSync);
			console.log('\nBudget sync result: ' + budgetResult.synced + ' synced, ' + budgetResult.skipped + ' skipped');
			if (budgetResult.errors.length > 0) {
				console.error('Errors:', budgetResult.errors);
			}
		}
	}

	console.log('\nDone.');
	await mongoose.disconnect();
}

main().catch(function(err) {
	console.error(err);
	process.exit(1);
});
