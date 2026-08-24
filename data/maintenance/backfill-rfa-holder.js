/**
 * Backfill rfaHolderId on auction-rfa-matched and auction-rfa-unmatched transactions.
 * 
 * This is a one-time backfill for historical data that was seeded without this field.
 * The field tracks who held RFA rights at auction time (and either matched or declined).
 * 
 * Usage:
 *   runt backfill-rfa-holder --dry-run   # Preview changes
 *   runt backfill-rfa-holder             # Apply changes
 */

var dotenv = require('dotenv').config({ path: __dirname + '/../../.env' });
var mongoose = require('mongoose');

var Transaction = require('../../models/Transaction');

mongoose.connect(process.env.MONGODB_URI);

var args = {
	dryRun: process.argv.includes('--dry-run')
};

var LeagueConfig = require('../../models/LeagueConfig');

/**
 * Find who holds RFA rights for a player at auction time.
 * Returns { holderId, conversionTx } or null if no RFA rights exist.
 * 
 * Uses the computed dead period of the prior season as the lower bound,
 * since that's when RFA rights conversions occur.
 */
async function findRfaHolder(playerId, auctionTimestamp) {
	var auctionYear = auctionTimestamp.getUTCFullYear();
	
	// RFA conversions happen at the dead period of the prior season
	var priorSeasonDefaults = LeagueConfig.computeDefaultDates(auctionYear - 1);
	var lowerBound = priorSeasonDefaults.deadPeriod;
	
	var conversion = await Transaction.findOne({
		$or: [
			{ type: 'rfa-rights-conversion' },
			{ type: 'expansion-draft-select', rfaRights: true }
		],
		playerId: playerId,
		timestamp: {
			$gte: lowerBound,
			$lt: auctionTimestamp
		}
	}).sort({ timestamp: -1 });
	
	if (!conversion) {
		return null;
	}
	
	var currentHolder = conversion.franchiseId;
	
	var trades = await Transaction.find({
		type: 'trade',
		'parties.receives.rfaRights.playerId': playerId,
		timestamp: {
			$gt: conversion.timestamp,
			$lt: auctionTimestamp
		}
	}).sort({ timestamp: 1 });
	
	for (var i = 0; i < trades.length; i++) {
		var trade = trades[i];
		for (var j = 0; j < trade.parties.length; j++) {
			var party = trade.parties[j];
			var hasRfaRights = party.receives.rfaRights && party.receives.rfaRights.some(function(r) {
				return r.playerId.toString() === playerId.toString();
			});
			if (hasRfaRights) {
				currentHolder = party.franchiseId;
				break;
			}
		}
	}
	
	return {
		holderId: currentHolder,
		conversionTx: conversion
	};
}

async function run() {
	console.log('Backfilling rfaHolderId on RFA auction transactions...');
	if (args.dryRun) {
		console.log('(DRY RUN - no changes will be made)\n');
	} else {
		console.log('');
	}
	
	var transactions = await Transaction.find({
		type: { $in: ['auction-rfa-matched', 'auction-rfa-unmatched'] },
		rfaHolderId: { $exists: false }
	}).sort({ timestamp: 1 });
	
	console.log('Found ' + transactions.length + ' transactions missing rfaHolderId\n');
	
	var stats = {
		updated: 0,
		notFound: 0,
		byYear: {}
	};
	
	for (var i = 0; i < transactions.length; i++) {
		var tx = transactions[i];
		var year = tx.timestamp.getUTCFullYear();
		
		if (!stats.byYear[year]) {
			stats.byYear[year] = { updated: 0, notFound: 0 };
		}
		
		var rfaInfo = await findRfaHolder(tx.playerId, tx.timestamp);
		
		if (rfaInfo && rfaInfo.holderId) {
			if (!args.dryRun) {
				await Transaction.updateOne(
					{ _id: tx._id },
					{ $set: { rfaHolderId: rfaInfo.holderId } }
				);
			}
			stats.updated++;
			stats.byYear[year].updated++;
		} else {
			stats.notFound++;
			stats.byYear[year].notFound++;
		}
	}
	
	console.log('Results:');
	console.log('  Updated: ' + stats.updated);
	console.log('  RFA holder not found: ' + stats.notFound);
	console.log('');
	console.log('By year:');
	
	var years = Object.keys(stats.byYear).sort();
	for (var j = 0; j < years.length; j++) {
		var y = years[j];
		var s = stats.byYear[y];
		console.log('  ' + y + ': ' + s.updated + ' updated, ' + s.notFound + ' not found');
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
