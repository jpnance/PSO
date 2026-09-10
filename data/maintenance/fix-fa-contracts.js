#!/usr/bin/env node

/**
 * Fix FA contracts that were created with startYear/endYear backwards.
 * 
 * Bad contracts have:
 *   startYear: currentSeason, endYear: null
 * 
 * Should be:
 *   startYear: null, endYear: currentSeason
 * 
 * Usage:
 *   runt fix-fa-contracts --dry-run
 *   runt fix-fa-contracts
 */

var dotenv = require('dotenv').config({ path: __dirname + '/../../.env' });
var mongoose = require('mongoose');

var Contract = require('../../models/Contract');
var Transaction = require('../../models/Transaction');
var Player = require('../../models/Player');
var PSO = require('../../config/pso');
var LeagueConfig = require('../../models/LeagueConfig');

var DRY_RUN = process.argv.includes('--dry-run');

async function main() {
	await mongoose.connect(process.env.MONGODB_URI);
	console.log('Connected to MongoDB\n');
	
	var config = await LeagueConfig.findById('pso');
	var season = config ? config.season : PSO.season;
	
	console.log('Season: ' + season);
	if (DRY_RUN) {
		console.log('DRY RUN - no changes will be made\n');
	}
	
	// Find FA transactions from Sleeper that added players
	var faTransactions = await Transaction.find({
		type: 'fa',
		source: 'sleeper',
		'adds.0': { $exists: true }
	}).lean();
	
	console.log('Found ' + faTransactions.length + ' Sleeper FA transactions with adds\n');
	
	// Get player IDs that were added
	var addedPlayerIds = [];
	faTransactions.forEach(function(tx) {
		tx.adds.forEach(function(add) {
			addedPlayerIds.push(add.playerId.toString());
		});
	});
	
	// Find contracts that look wrong (startYear = season, endYear = null)
	var badContracts = await Contract.find({
		playerId: { $in: addedPlayerIds },
		startYear: season,
		endYear: null,
		salary: { $ne: null }
	}).populate('playerId').lean();
	
	console.log('Found ' + badContracts.length + ' contracts to fix\n');
	
	if (badContracts.length === 0) {
		console.log('Nothing to fix.');
		await mongoose.disconnect();
		return;
	}
	
	for (var i = 0; i < badContracts.length; i++) {
		var contract = badContracts[i];
		var playerName = contract.playerId ? contract.playerId.name : 'Unknown';
		
		console.log(playerName + ': $' + contract.salary + ' ' + season + '/null -> null/' + season);
		
		if (!DRY_RUN) {
			await Contract.updateOne(
				{ _id: contract._id },
				{ $set: { startYear: null, endYear: season } }
			);
		}
	}
	
	console.log('\n' + (DRY_RUN ? 'Would fix' : 'Fixed') + ' ' + badContracts.length + ' contracts.');
	
	await mongoose.disconnect();
}

main().catch(function(err) {
	console.error('Error:', err);
	process.exit(1);
});
