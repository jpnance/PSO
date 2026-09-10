#!/usr/bin/env node

/**
 * Fix FA transaction timestamps that used Sleeper's `created` (bid placement time)
 * instead of `status_updated` (when FAAB actually processed).
 * 
 * This script:
 *   1. Finds PSO FA transactions with sleeperTransactionId
 *   2. Fetches the Sleeper transaction to get status_updated
 *   3. Updates the PSO timestamp (anchored to noon ET for waiver types)
 * 
 * Usage:
 *   runt fix-fa-timestamps --dry-run
 *   runt fix-fa-timestamps
 */

var dotenv = require('dotenv').config({ path: __dirname + '/../../.env' });
var mongoose = require('mongoose');

var Transaction = require('../../models/Transaction');
var LeagueConfig = require('../../models/LeagueConfig');
var PSO = require('../../config/pso');
var tz = require('../../helpers/timezone');
var sleeper = require('../../helpers/sleeper');

var DRY_RUN = process.argv.includes('--dry-run');

async function fetchSleeperTransaction(sleeperTxnId, season) {
	// Try weeks 0-18 to find the transaction
	for (var week = 0; week <= 18; week++) {
		try {
			var transactions = await sleeper.fetchTransactions(week, season);
			var match = transactions.find(function(t) {
				return t.transaction_id === sleeperTxnId;
			});
			if (match) return match;
		} catch (err) {
			// Week might not exist, continue
		}
	}
	return null;
}

async function main() {
	await mongoose.connect(process.env.MONGODB_URI);
	console.log('Connected to MongoDB\n');
	
	var config = await LeagueConfig.findById('pso');
	var season = config ? config.season : PSO.season;
	
	console.log('Season: ' + season);
	if (DRY_RUN) {
		console.log('DRY RUN - no changes will be made\n');
	}
	
	// Find FA transactions from Sleeper
	var faTransactions = await Transaction.find({
		type: 'fa',
		source: 'sleeper',
		sleeperTransactionId: { $exists: true, $ne: null }
	}).lean();
	
	console.log('Found ' + faTransactions.length + ' Sleeper FA transactions to check\n');
	
	if (faTransactions.length === 0) {
		console.log('Nothing to fix.');
		await mongoose.disconnect();
		return;
	}
	
	var fixed = 0;
	var skipped = 0;
	var errors = 0;
	
	for (var i = 0; i < faTransactions.length; i++) {
		var tx = faTransactions[i];
		
		// Fetch the Sleeper transaction
		var sleeperTxn = await fetchSleeperTransaction(tx.sleeperTransactionId, season);
		
		if (!sleeperTxn) {
			console.log('Could not find Sleeper txn ' + tx.sleeperTransactionId);
			errors++;
			continue;
		}
		
		// Get the correct timestamp
		var correctTimestamp = new Date(sleeperTxn.status_updated);
		if (sleeperTxn.type === 'waiver') {
			correctTimestamp = tz.anchorToFAABTime(correctTimestamp, config.faab);
		}
		
		var currentTimestamp = new Date(tx.timestamp);
		
		// Check if they differ (more than 1 minute difference)
		var diff = Math.abs(correctTimestamp.getTime() - currentTimestamp.getTime());
		if (diff < 60000) {
			skipped++;
			continue;
		}
		
		console.log(tx.sleeperTransactionId + ':');
		console.log('  Current:  ' + currentTimestamp.toISOString());
		console.log('  Correct:  ' + correctTimestamp.toISOString());
		
		if (!DRY_RUN) {
			await Transaction.updateOne(
				{ _id: tx._id },
				{ $set: { timestamp: correctTimestamp } }
			);
		}
		
		fixed++;
	}
	
	console.log('\n' + (DRY_RUN ? 'Would fix' : 'Fixed') + ' ' + fixed + ' timestamps.');
	console.log('Skipped ' + skipped + ' (already correct).');
	if (errors > 0) {
		console.log('Errors: ' + errors);
	}
	
	await mongoose.disconnect();
}

main().catch(function(err) {
	console.error('Error:', err);
	process.exit(1);
});
