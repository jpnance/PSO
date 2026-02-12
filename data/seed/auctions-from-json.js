/**
 * Seed auction transactions from auctions.json
 * 
 * Creates auction-ufa transactions (player won at auction).
 * 
 * Note: auctions.json is already filtered to exclude drafted players and
 * has unrolled unsigned trades to show the original auction winner.
 * 
 * Timestamps: auction day at noon ET
 * 
 * Usage:
 *   docker compose run --rm -it web node data/seed/auctions-from-json.js
 *   docker compose run --rm -it web node data/seed/auctions-from-json.js --clear
 *   docker compose run --rm -it web node data/seed/auctions-from-json.js --dry-run
 */

require('dotenv').config({ path: __dirname + '/../../.env' });

var mongoose = require('mongoose');
var fs = require('fs');
var path = require('path');

var Franchise = require('../../models/Franchise');
var Player = require('../../models/Player');
var Transaction = require('../../models/Transaction');
var leagueDates = require('../../config/dates.js');

mongoose.connect(process.env.MONGODB_URI);

var AUCTIONS_FILE = path.join(__dirname, '../auctions/auctions.json');

// Parse command line arguments
var args = {
	clear: process.argv.includes('--clear'),
	dryRun: process.argv.includes('--dry-run')
};

// Stats
var stats = {
	auctionsCreated: 0,
	playersCreated: 0,
	skipped: 0,
	errors: []
};

// Caches
var franchiseByRosterId = {};
var playersBySleeperId = {};
var playersByName = {};

/**
 * Get the auction timestamp for a given season.
 * Falls back to August 18 at noon if no date configured.
 */
function getAuctionTimestamp(season) {
	var date = leagueDates.getAuctionDate(season);
	if (date) return date;
	// Fallback
	return new Date(Date.UTC(season, 7, 18, 16, 0, 0));
}

/**
 * Find or create a player by sleeperId or name.
 * 
 * Historical players (no sleeperId) are kept separate from modern players
 * with the same name - we use a composite cache key for historical players.
 */
async function findOrCreatePlayer(entry) {
	// Try sleeperId first (modern players)
	if (entry.sleeperId) {
		if (playersBySleeperId[entry.sleeperId]) {
			return playersBySleeperId[entry.sleeperId];
		}
		
		// Player with sleeperId not in cache - look up in DB
		var player = await Player.findOne({ sleeperId: entry.sleeperId });
		if (player) {
			playersBySleeperId[entry.sleeperId] = player;
			return player;
		}
	}
	
	// Historical player (no sleeperId) - use name + "historical" as cache key
	// to keep them separate from modern players with same name
	if (entry.name) {
		var isHistorical = !entry.sleeperId;
		var nameKey = entry.name.toLowerCase();
		var cacheKey = isHistorical ? nameKey + '|historical' : nameKey;
		
		if (playersByName[cacheKey]) {
			return playersByName[cacheKey];
		}
		
		// Look up by name, but for historical players only match those without sleeperId
		var query = { name: entry.name };
		if (isHistorical) {
			query.sleeperId = null;
		}
		
		var player = await Player.findOne(query);
		if (player) {
			playersByName[cacheKey] = player;
			return player;
		}
		
		// Create player (historical or with sleeperId)
		if (!args.dryRun) {
			player = await Player.create({
				name: entry.name,
				sleeperId: entry.sleeperId || null,
				positions: entry.positions || []
			});
			playersByName[cacheKey] = player;
			if (entry.sleeperId) {
				playersBySleeperId[entry.sleeperId] = player;
			}
			stats.playersCreated++;
		}
		return player;
	}
	
	return null;
}

async function seed() {
	console.log('Seeding auctions from auctions.json...');
	if (args.dryRun) console.log('[DRY RUN]');
	console.log('');
	
	// Clear existing data if requested
	if (args.clear && !args.dryRun) {
		console.log('Clearing existing auction transactions...');
		var auctionResult = await Transaction.deleteMany({ 
			type: { $in: ['auction-ufa', 'auction-rfa-matched', 'auction-rfa-unmatched'] } 
		});
		console.log('  Deleted ' + auctionResult.deletedCount + ' auction transactions');
		console.log('');
	}
	
	// Load franchises
	var franchises = await Franchise.find({});
	franchises.forEach(function(f) {
		franchiseByRosterId[f.rosterId] = f;
	});
	console.log('Loaded ' + franchises.length + ' franchises');
	
	// Load existing players into cache
	var allPlayers = await Player.find({});
	allPlayers.forEach(function(p) {
		if (p.sleeperId) {
			playersBySleeperId[p.sleeperId] = p;
		}
		playersByName[p.name.toLowerCase()] = p;
	});
	console.log('Loaded ' + allPlayers.length + ' players');
	
	// Load auctions.json
	var auctions = JSON.parse(fs.readFileSync(AUCTIONS_FILE, 'utf8'));
	console.log('Loaded ' + auctions.length + ' auction entries');
	console.log('');
	
	// Group by season for progress reporting
	var seasons = {};
	auctions.forEach(function(a) {
		if (!seasons[a.season]) seasons[a.season] = [];
		seasons[a.season].push(a);
	});
	
	var seasonYears = Object.keys(seasons).map(Number).sort(function(a, b) { return a - b; });
	
	for (var si = 0; si < seasonYears.length; si++) {
		var season = seasonYears[si];
		var seasonAuctions = seasons[season];
		var auctionTimestamp = getAuctionTimestamp(season);
		
		var seasonAuctionCount = 0;
		
		for (var ai = 0; ai < seasonAuctions.length; ai++) {
			var entry = seasonAuctions[ai];
			
			// Validate required fields
			if (!entry.rosterId) {
				stats.errors.push(season + ' ' + entry.name + ': Missing rosterId');
				stats.skipped++;
				continue;
			}
			
			var franchise = franchiseByRosterId[entry.rosterId];
			if (!franchise) {
				stats.errors.push(season + ' ' + entry.name + ': Unknown franchise ' + entry.rosterId);
				stats.skipped++;
				continue;
			}
			
			// Find or create player
			var player = await findOrCreatePlayer(entry);
			if (!player && !args.dryRun) {
				stats.errors.push(season + ' ' + entry.name + ': Could not resolve player');
				stats.skipped++;
				continue;
			}
			
			if (args.dryRun) {
				seasonAuctionCount++;
				continue;
			}
			
			try {
				// Create auction-ufa transaction
				// Use index offset to maintain some ordering (not critical for auctions)
				var auctionTs = new Date(auctionTimestamp.getTime() + (ai * 1000));
				
				await Transaction.create({
					type: 'auction-ufa',
					timestamp: auctionTs,
					source: 'snapshot',
					franchiseId: franchise._id,
					playerId: player._id,
					winningBid: entry.salary
				});
				seasonAuctionCount++;
				stats.auctionsCreated++;
			} catch (err) {
				if (err.code === 11000) {
					stats.errors.push(season + ' ' + entry.name + ': Duplicate');
					stats.skipped++;
				} else {
					throw err;
				}
			}
		}
		
		console.log(season + ': ' + seasonAuctionCount + ' auctions');
	}
	
	console.log('');
	console.log('Done!');
	console.log('  Auctions created: ' + stats.auctionsCreated);
	console.log('  Players created: ' + stats.playersCreated);
	console.log('  Skipped (errors): ' + stats.skipped);
	
	if (stats.errors.length > 0) {
		console.log('');
		console.log('Errors (' + stats.errors.length + '):');
		stats.errors.slice(0, 20).forEach(function(e) {
			console.log('  - ' + e);
		});
		if (stats.errors.length > 20) {
			console.log('  ... and ' + (stats.errors.length - 20) + ' more');
		}
	}
	
	process.exit(stats.errors.length > 0 ? 1 : 0);
}

seed().catch(function(err) {
	console.error('Error:', err);
	process.exit(1);
});
