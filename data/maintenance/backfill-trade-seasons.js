/**
 * Backfill season field on trade transactions.
 * 
 * Season is determined by the trade timestamp:
 * - Trades before the dead period belong to the current calendar year's season
 * - Trades on/after the dead period belong to the next year's season
 * 
 * Usage:
 *   runt backfill-trade-seasons --dry-run   # Preview changes
 *   runt backfill-trade-seasons             # Apply changes
 */

var dotenv = require('dotenv').config({ path: __dirname + '/../../.env' });
var mongoose = require('mongoose');

var Transaction = require('../../models/Transaction');
var LeagueConfig = require('../../models/LeagueConfig');

mongoose.connect(process.env.MONGODB_URI);

var args = {
	dryRun: process.argv.includes('--dry-run')
};

function computeSeason(timestamp) {
	var tradeYear = timestamp.getFullYear();
	
	var defaults = LeagueConfig.computeDefaultDates(tradeYear);
	
	if (defaults.deadPeriod && timestamp >= defaults.deadPeriod) {
		return tradeYear + 1;
	}
	
	return tradeYear;
}

async function run() {
	console.log('Backfilling season on trade transactions...');
	if (args.dryRun) {
		console.log('(DRY RUN - no changes will be made)\n');
	} else {
		console.log('');
	}
	
	var trades = await Transaction.find({ type: 'trade' }).sort({ timestamp: 1 });
	
	console.log('Found ' + trades.length + ' trades\n');
	
	var stats = {
		updated: 0,
		alreadySet: 0,
		bySeason: {}
	};
	
	for (var i = 0; i < trades.length; i++) {
		var tx = trades[i];
		var season = computeSeason(tx.timestamp);
		
		if (!stats.bySeason[season]) {
			stats.bySeason[season] = 0;
		}
		stats.bySeason[season]++;
		
		if (tx.season === season) {
			stats.alreadySet++;
			continue;
		}
		
		var calendarYear = tx.timestamp.getFullYear();
		var isEdgeCase = season !== calendarYear;
		
		if (isEdgeCase || args.dryRun) {
			console.log(
				'Trade #' + tx.tradeId + 
				' (' + tx.timestamp.toISOString().slice(0, 10) + ')' +
				' -> season ' + season +
				(isEdgeCase ? ' (edge case: calendar year ' + calendarYear + ')' : '')
			);
		}
		
		if (!args.dryRun) {
			await Transaction.updateOne(
				{ _id: tx._id },
				{ $set: { season: season } }
			);
		}
		stats.updated++;
	}
	
	console.log('\nResults:');
	console.log('  Updated: ' + stats.updated);
	console.log('  Already set: ' + stats.alreadySet);
	console.log('');
	console.log('By season:');
	
	var seasons = Object.keys(stats.bySeason).sort();
	for (var j = 0; j < seasons.length; j++) {
		var s = seasons[j];
		console.log('  ' + s + ': ' + stats.bySeason[s] + ' trades');
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
