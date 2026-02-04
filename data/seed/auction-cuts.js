/**
 * Seed Auction Wins from Cuts Data
 * 
 * Infers auction wins for players who were cut with same-year contracts
 * but don't appear in the contracts snapshot with that contract.
 * 
 * If someone cut a player with startYear === cutYear, and that player
 * wasn't traded to them, they must have won the player at auction.
 * 
 * Usage:
 *   node data/seed/auction-cuts.js [--dry-run] [--year=YYYY]
 */

var dotenv = require('dotenv').config({ path: __dirname + '/../../.env' });
var mongoose = require('mongoose');
var path = require('path');

var Player = require('../../models/Player');
var Franchise = require('../../models/Franchise');
var Transaction = require('../../models/Transaction');
var Regime = require('../../models/Regime');
var cutFacts = require('../facts/cut-facts');
var tradeFacts = require('../facts/trade-facts');
var snapshotFacts = require('../facts/snapshot-facts');
var resolver = require('../utils/player-resolver');

mongoose.connect(process.env.MONGODB_URI);

var FIRST_YEAR = 2009;
var LAST_YEAR = 2019;

// Auction dates by year
var AUCTION_DATES = {
	2008: '2008-08-18', 2009: '2009-08-16', 2010: '2010-08-22', 2011: '2011-08-20',
	2012: '2012-08-25', 2013: '2013-08-24', 2014: '2014-08-23', 2015: '2015-08-29',
	2016: '2016-08-20', 2017: '2017-08-19', 2018: '2018-08-25', 2019: '2019-08-24'
};

/**
 * Get auction timestamp for a year (9:00:33 AM ET on auction day)
 */
function getAuctionTimestamp(year) {
	var dateStr = AUCTION_DATES[year];
	if (!dateStr) return null;
	
	var parts = dateStr.split('-');
	var y = parseInt(parts[0]);
	var m = parseInt(parts[1]) - 1;
	var d = parseInt(parts[2]);
	
	// August is during DST, so ET = UTC-4
	// 9:00:33 AM ET = 13:00:33 UTC
	return new Date(Date.UTC(y, m, d, 13, 0, 33));
}

/**
 * Build owner map for a season using 2025 regime names
 */
function buildOwnerMap(regimes, franchises) {
	var ownerMap = cutFacts.buildOwnerMap(regimes, franchises);
	return ownerMap;
}

/**
 * Get historical regime name for a franchise in a given year
 */
function getHistoricalRegime(regimes, franchiseId, year) {
	var regime = regimes.find(function(r) {
		return r.tenures && r.tenures.some(function(t) {
			return t.franchiseId.toString() === franchiseId.toString() &&
				t.startSeason <= year &&
				(t.endSeason === null || t.endSeason >= year);
		});
	});
	return regime ? regime.displayName : null;
}

/**
 * Build set of players traded to each owner in a season
 */
function getTradedToOwner(trades, year, ownerMap) {
	var tradedTo = {}; // franchiseId -> Set of player names (lowercase)
	
	trades.forEach(function(trade) {
		if (trade.date.getFullYear() !== year) return;
		
		trade.parties.forEach(function(party) {
			var franchiseId = ownerMap[party.owner.toLowerCase()];
			if (!franchiseId) return;
			
			var key = franchiseId.toString();
			if (!tradedTo[key]) tradedTo[key] = new Set();
			
			party.players.forEach(function(player) {
				tradedTo[key].add(player.name.toLowerCase());
			});
		});
	});
	
	return tradedTo;
}

async function run() {
	var args = process.argv.slice(2);
	var dryRun = args.includes('--dry-run');
	var yearArg = args.find(function(a) { return a.startsWith('--year='); });
	var targetYear = yearArg ? parseInt(yearArg.split('=')[1]) : null;
	
	if (dryRun) {
		console.log('=== DRY RUN MODE ===\n');
	}
	
	var regimes = await Regime.find({}).lean();
	var franchises = await Franchise.find({}).lean();
	var players = await Player.find({}).lean();
	
	// Build player lookup
	var playersByName = {};
	players.forEach(function(p) {
		var key = resolver.normalizePlayerName(p.name);
		if (!playersByName[key]) playersByName[key] = [];
		playersByName[key].push(p);
	});
	
	// Build owner map (2025 regime names -> franchise IDs)
	var ownerMap = buildOwnerMap(regimes, franchises);
	
	// Load all data
	var allCuts = cutFacts.loadAll();
	var allTrades = tradeFacts.checkAvailability() ? tradeFacts.loadAll() : [];
	
	var startYear = targetYear || FIRST_YEAR;
	var endYear = targetYear || LAST_YEAR;
	
	var totalCreated = 0;
	var totalSkipped = 0;
	
	for (var year = startYear; year <= endYear; year++) {
		var auctionTimestamp = getAuctionTimestamp(year);
		if (!auctionTimestamp) {
			console.log(year + ': No auction date configured');
			continue;
		}
		
		// Load snapshot for this year
		var snapshot = snapshotFacts.loadSeason(year);
		
		// Build set of players in snapshot with same-year contracts
		var inSnapshotWithContract = new Set();
		snapshot.forEach(function(c) {
			if (c.startYear === year) {
				inSnapshotWithContract.add(c.playerName.toLowerCase());
			}
		});
		
		// Get traded-to map for this year
		var tradedTo = getTradedToOwner(allTrades, year, ownerMap);
		
		// Find cuts with same-year contracts not in snapshot
		var yearCuts = allCuts.filter(function(c) {
			return c.cutYear === year && c.startYear === year;
		});
		
		// Filter to cuts where player isn't in snapshot with same-year contract
		var missingAuctions = yearCuts.filter(function(c) {
			return !inSnapshotWithContract.has(c.name.toLowerCase());
		});
		
		if (missingAuctions.length === 0) {
			console.log(year + ': No missing auction wins');
			continue;
		}
		
		console.log(year + ': ' + missingAuctions.length + ' potential missing auction wins');
		
		var yearCreated = 0;
		
		for (var i = 0; i < missingAuctions.length; i++) {
			var cut = missingAuctions[i];
			
			// Get franchise ID for the cutter
			var franchiseId = cutFacts.getFranchiseId(cut.owner, ownerMap);
			if (!franchiseId) {
				console.log('  ✗ Could not find franchise for: ' + cut.owner);
				totalSkipped++;
				continue;
			}
			
			// Check if player was traded to this franchise
			var franchiseKey = franchiseId.toString();
			if (tradedTo[franchiseKey] && tradedTo[franchiseKey].has(cut.name.toLowerCase())) {
				// Player was traded to them, not won at auction
				continue;
			}
			
			// Find player in database
			var normalized = resolver.normalizePlayerName(cut.name);
			var candidates = playersByName[normalized] || [];
			
			var player = null;
			if (candidates.length === 1) {
				player = candidates[0];
			} else if (candidates.length > 1) {
				// Try to match by position
				var posMatch = candidates.find(function(c) {
					return c.positions && c.positions.includes(cut.position);
				});
				player = posMatch || candidates[0];
			}
			
			// Auto-create for historical years (before 2016)
			if (!player && candidates.length === 0 && year < 2016) {
				var existing = await Player.findOne({ name: cut.name, sleeperId: null });
				if (existing) {
					player = existing;
					if (!playersByName[normalized]) playersByName[normalized] = [];
					playersByName[normalized].push(existing);
				} else {
					console.log('  Auto-creating historical: ' + cut.name + ' [' + (cut.position || '?') + ']');
					player = await Player.create({
						name: cut.name,
						positions: cut.position ? [cut.position] : [],
						sleeperId: null
					});
					if (!playersByName[normalized]) playersByName[normalized] = [];
					playersByName[normalized].push(player);
				}
			}
			
			if (!player) {
				console.log('  ✗ Could not find player: ' + cut.name);
				totalSkipped++;
				continue;
			}
			
			// Check if auction transaction already exists
			var existing = await Transaction.findOne({
				type: { $in: ['auction-ufa', 'auction-rfa-matched', 'auction-rfa-unmatched'] },
				playerId: player._id,
				timestamp: {
					$gte: new Date(year, 0, 1),
					$lt: new Date(year + 1, 0, 1)
				}
			});
			
			if (existing) {
				continue;
			}
			
			var historicalName = getHistoricalRegime(regimes, franchiseId, year) || cut.owner;
			
			if (dryRun) {
				console.log('  Would create: ' + cut.name + ' → ' + historicalName + ' ($' + cut.salary + ')');
				yearCreated++;
			} else {
				try {
					await Transaction.create({
						type: 'auction-ufa',
						timestamp: auctionTimestamp,
						source: 'cuts',
						franchiseId: franchiseId,
						playerId: player._id,
						salary: cut.salary
					});
					yearCreated++;
				} catch (err) {
					console.log('  ✗ Error: ' + err.message);
					totalSkipped++;
				}
			}
		}
		
		totalCreated += yearCreated;
		if (yearCreated > 0) {
			console.log('  Created: ' + yearCreated);
		}
	}
	
	console.log('\n=== Summary ===');
	console.log('Created: ' + totalCreated);
	console.log('Skipped: ' + totalSkipped);
	
	await mongoose.disconnect();
}

run().catch(function(err) {
	console.error(err);
	process.exit(1);
});
