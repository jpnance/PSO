/**
 * Seed RFA rights lapsed transactions.
 * 
 * When a player has RFA rights but is not brought up at auction,
 * the rights lapse and the player becomes available.
 * 
 * Logic:
 *   1. Find all rfa-rights-conversion transactions for a given year
 *   2. Check if there's a corresponding auction transaction for that player
 *   3. If not, create an rfa-rights-lapsed transaction at end of auction
 * 
 * Usage:
 *   docker compose run --rm web node data/seed/rfa-lapsed.js
 *   docker compose run --rm web node data/seed/rfa-lapsed.js --year=2018
 *   docker compose run --rm web node data/seed/rfa-lapsed.js --dry-run
 */

var dotenv = require('dotenv').config({ path: __dirname + '/../../.env' });
var mongoose = require('mongoose');

var Transaction = require('../../models/Transaction');
var Player = require('../../models/Player');
var Franchise = require('../../models/Franchise');

mongoose.connect(process.env.MONGODB_URI);

// RFA rights lapse at end of auction
// Convention: September 1 at 12:00:00 PM ET (after auction, before regular season)
function getRfaLapsedTimestamp(year) {
	return new Date(Date.UTC(year, 8, 1, 16, 0, 0));  // Sept 1 at noon ET
}

function parseArgs() {
	var args = {
		dryRun: process.argv.includes('--dry-run'),
		clear: process.argv.includes('--clear'),
		year: null
	};
	
	var yearArg = process.argv.find(function(a) { return a.startsWith('--year='); });
	if (yearArg) {
		args.year = parseInt(yearArg.split('=')[1], 10);
	}
	
	return args;
}

async function run() {
	var args = parseArgs();
	
	console.log('Seeding RFA rights lapsed transactions');
	if (args.year) {
		console.log('Year:', args.year);
	} else {
		console.log('Years: 2009 - 2024');
	}
	if (args.dryRun) console.log('[DRY RUN]');
	console.log('');
	
	// Load player names for display
	var players = await Player.find({}).lean();
	var playerNames = {};
	players.forEach(function(p) {
		playerNames[p._id.toString()] = p.name;
	});
	
	// Load franchise names for display
	var franchises = await Franchise.find({}).lean();
	var franchiseNames = {};
	franchises.forEach(function(f) {
		franchiseNames[f._id.toString()] = f.name || ('Franchise ' + f.rosterId);
	});
	
	// Clear existing if requested
	if (args.clear && !args.dryRun) {
		console.log('Clearing existing rfa-rights-lapsed transactions...');
		var query = { type: 'rfa-rights-lapsed' };
		var deleted = await Transaction.deleteMany(query);
		console.log('  Deleted', deleted.deletedCount, 'transactions');
		console.log('');
	}
	
	var startYear = args.year || 2009;
	var endYear = args.year || 2024;
	
	var stats = {
		created: 0,
		skipped: 0,
		hadAuction: 0
	};
	
	for (var year = startYear; year <= endYear; year++) {
		console.log('=== ' + year + ' ===');
		
		// Find all RFA conversions for this year (happened on Jan 15 of this year)
		var conversionStart = new Date(Date.UTC(year, 0, 1));
		var conversionEnd = new Date(Date.UTC(year, 1, 1));  // Before Feb 1
		
		var rfaConversions = await Transaction.find({
			type: 'rfa-rights-conversion',
			timestamp: { $gte: conversionStart, $lt: conversionEnd }
		}).lean();
		
		console.log('  RFA conversions:', rfaConversions.length);
		
		if (rfaConversions.length === 0) continue;
		
		// Find all auction transactions for this year
		var auctionStart = new Date(Date.UTC(year, 6, 1));  // July 1
		var auctionEnd = new Date(Date.UTC(year, 8, 15));   // Sept 15
		
		var auctions = await Transaction.find({
			type: { $in: ['auction-ufa', 'auction-rfa-matched', 'auction-rfa-unmatched'] },
			timestamp: { $gte: auctionStart, $lt: auctionEnd }
		}).lean();
		
		// Build set of player IDs that went through auction
		var auctionedPlayers = new Set();
		auctions.forEach(function(tx) {
			if (tx.playerId) {
				auctionedPlayers.add(tx.playerId.toString());
			}
		});
		
		console.log('  Players auctioned:', auctionedPlayers.size);
		
		var lapsedTimestamp = getRfaLapsedTimestamp(year);
		var createdThisYear = 0;
		
		for (var i = 0; i < rfaConversions.length; i++) {
			var conversion = rfaConversions[i];
			var playerId = conversion.playerId.toString();
			
			if (auctionedPlayers.has(playerId)) {
				stats.hadAuction++;
				continue;
			}
			
			// Check for existing lapsed transaction
			var existing = await Transaction.findOne({
				type: 'rfa-rights-lapsed',
				playerId: conversion.playerId,
				timestamp: lapsedTimestamp
			});
			
			if (existing) {
				stats.skipped++;
				continue;
			}
			
			var playerName = playerNames[playerId] || 'Unknown';
			var franchiseName = franchiseNames[conversion.franchiseId.toString()] || 'Unknown';
			
			if (!args.dryRun) {
				await Transaction.create({
					type: 'rfa-rights-lapsed',
					timestamp: lapsedTimestamp,
					source: 'snapshot',
					franchiseId: conversion.franchiseId,  // Franchise that held the rights
					playerId: conversion.playerId
				});
			}
			
			console.log('    + ' + playerName + ' (rights held by ' + franchiseName + ')');
			stats.created++;
			createdThisYear++;
		}
		
		console.log('  Created:', createdThisYear);
	}
	
	console.log('');
	console.log('Done!');
	console.log('  Created:', stats.created);
	console.log('  Skipped (existing):', stats.skipped);
	console.log('  Had auction:', stats.hadAuction);
	
	process.exit(0);
}

run().catch(function(err) {
	console.error('Error:', err);
	process.exit(1);
});
