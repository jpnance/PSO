/**
 * Backfill timestamps on rfa-rights-conversion and contract-expiry transactions.
 * 
 * These transactions were seeded at 00:00Z UTC (7/8pm ET the prior day), which
 * is not semantically meaningful. They should be at the computed dead period
 * date at midnight ET, which is when these events conceptually occur.
 * 
 * Usage:
 *   runt backfill-conversion-timestamps --dry-run   # Preview changes
 *   runt backfill-conversion-timestamps             # Apply changes
 */

var dotenv = require('dotenv').config({ path: __dirname + '/../../.env' });
var mongoose = require('mongoose');

var Transaction = require('../../models/Transaction');
var LeagueConfig = require('../../models/LeagueConfig');

mongoose.connect(process.env.MONGODB_URI);

var args = {
	dryRun: process.argv.includes('--dry-run')
};

async function run() {
	console.log('Backfilling timestamps on conversion/expiry transactions...');
	if (args.dryRun) {
		console.log('(DRY RUN - no changes will be made)\n');
	} else {
		console.log('');
	}
	
	var transactions = await Transaction.find({
		type: { $in: ['rfa-rights-conversion', 'contract-expiry'] }
	}).sort({ timestamp: 1 });
	
	console.log('Found ' + transactions.length + ' transactions total\n');
	
	var stats = {
		updated: 0,
		skipped: 0,
		byType: {
			'rfa-rights-conversion': { updated: 0, skipped: 0 },
			'contract-expiry': { updated: 0, skipped: 0 }
		},
		byYear: {}
	};
	
	for (var i = 0; i < transactions.length; i++) {
		var tx = transactions[i];
		var currentTimestamp = tx.timestamp;
		var timestampYear = currentTimestamp.getUTCFullYear();
		
		// These transactions are for the NEXT season's auction/rights
		// e.g., a Jan 2010 timestamp means 2010 auction, so compute 2009 dead period
		var deadPeriodSeason = timestampYear - 1;
		
		// Handle edge case: if timestamp is in December, it's already in the correct year
		if (currentTimestamp.getUTCMonth() === 11) {
			deadPeriodSeason = timestampYear;
		}
		
		var defaults = LeagueConfig.computeDefaultDates(deadPeriodSeason);
		var targetTimestamp = defaults.deadPeriod;
		
		if (!targetTimestamp) {
			console.log('  SKIP: No dead period computed for season ' + deadPeriodSeason);
			stats.skipped++;
			stats.byType[tx.type].skipped++;
			continue;
		}
		
		// Check if already at the correct timestamp
		if (currentTimestamp.getTime() === targetTimestamp.getTime()) {
			stats.skipped++;
			stats.byType[tx.type].skipped++;
			continue;
		}
		
		var yearKey = deadPeriodSeason;
		if (!stats.byYear[yearKey]) {
			stats.byYear[yearKey] = { updated: 0, from: null, to: null };
		}
		
		if (!stats.byYear[yearKey].from) {
			stats.byYear[yearKey].from = currentTimestamp.toISOString();
			stats.byYear[yearKey].to = targetTimestamp.toISOString();
		}
		
		if (!args.dryRun) {
			await Transaction.updateOne(
				{ _id: tx._id },
				{ $set: { timestamp: targetTimestamp } }
			);
		}
		
		stats.updated++;
		stats.byType[tx.type].updated++;
		stats.byYear[yearKey].updated++;
	}
	
	console.log('Results:');
	console.log('  Updated: ' + stats.updated);
	console.log('  Skipped (already correct): ' + stats.skipped);
	console.log('');
	console.log('By type:');
	console.log('  rfa-rights-conversion: ' + stats.byType['rfa-rights-conversion'].updated + ' updated');
	console.log('  contract-expiry: ' + stats.byType['contract-expiry'].updated + ' updated');
	console.log('');
	console.log('By dead period season:');
	
	var years = Object.keys(stats.byYear).sort();
	for (var j = 0; j < years.length; j++) {
		var y = years[j];
		var s = stats.byYear[y];
		console.log('  ' + y + ': ' + s.updated + ' transactions');
		console.log('    ' + s.from + ' → ' + s.to);
	}
	
	if (args.dryRun) {
		console.log('\n(DRY RUN - no changes were made)');
	}
	
	await mongoose.disconnect();
}

run().catch(function(err) {
	console.error('Error:', err);
	process.exit(1);
});
