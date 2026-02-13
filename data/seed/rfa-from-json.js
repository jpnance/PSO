/**
 * Seed RFA transactions from rfa.json
 * 
 * Creates transactions for:
 *   - rfa-rights-conversion: contract expired, RFA rights conveyed to franchise
 *   - contract-expiry: contract expired, player becomes UFA
 *   - rfa-unknown: player was cut mid-season, end-of-season status unknown
 * 
 * Timestamps: January 15 of the following year (postseason)
 * 
 * Usage:
 *   docker compose run --rm -it web node data/seed/rfa-from-json.js
 *   docker compose run --rm -it web node data/seed/rfa-from-json.js --dry-run
 * 
 * Note: Always clears existing RFA transactions before seeding (except in dry-run mode).
 */

require('dotenv').config({ path: __dirname + '/../../.env' });

var mongoose = require('mongoose');
var fs = require('fs');
var path = require('path');

var Franchise = require('../../models/Franchise');
var Player = require('../../models/Player');
var Transaction = require('../../models/Transaction');
var playerUpsert = require('../utils/player-upsert');

mongoose.connect(process.env.MONGODB_URI);

var RFA_FILE = path.join(__dirname, '../rfa/rfa.json');

// Parse command line arguments
var args = {
	dryRun: process.argv.includes('--dry-run')
};

// Stats
var stats = {
	rfaConversions: 0,
	contractExpiries: 0,
	rfaUnknown: 0,
	skipped: 0,
	errors: []
};

// Caches
var franchiseByRosterId = {};
var playersBySleeperId = {};
var playersByName = {};
var upsert = null; // Initialized in seed()

/**
 * Map source string to Transaction.source enum value
 * Both postseason snapshots and approximated data are derived from snapshots
 */
function mapSource(source) {
	// Valid enum values: wordpress, sleeper, fantrax, manual, snapshot, cuts
	return 'snapshot';
}

async function seed() {
	console.log('Seeding RFA transactions from rfa.json...');
	if (args.dryRun) console.log('[DRY RUN]');
	console.log('');
	
	// Always clear existing RFA transactions (orchestrator clears all, but standalone needs this)
	if (!args.dryRun) {
		console.log('Clearing existing RFA transactions...');
		var result = await Transaction.deleteMany({ 
			type: { $in: ['rfa-rights-conversion', 'contract-expiry', 'rfa-unknown'] } 
		});
		console.log('  Deleted ' + result.deletedCount + ' RFA transactions');
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
		// Cache historical players separately
		var cacheKey = p.sleeperId ? p.name.toLowerCase() : p.name.toLowerCase() + '|historical';
		playersByName[cacheKey] = p;
	});
	console.log('Loaded ' + allPlayers.length + ' players');
	
	// Initialize player upsert helper (handles position backfilling)
	upsert = playerUpsert.create({
		Player: Player,
		playersBySleeperId: playersBySleeperId,
		playersByName: playersByName,
		dryRun: args.dryRun
	});
	
	// Load rfa.json
	var rfaRecords = JSON.parse(fs.readFileSync(RFA_FILE, 'utf8'));
	console.log('Loaded ' + rfaRecords.length + ' RFA entries');
	console.log('');
	
	// Group by season for progress reporting
	var seasons = {};
	rfaRecords.forEach(function(r) {
		if (!seasons[r.season]) seasons[r.season] = [];
		seasons[r.season].push(r);
	});
	
	var seasonYears = Object.keys(seasons).map(Number).sort(function(a, b) { return a - b; });
	
	for (var si = 0; si < seasonYears.length; si++) {
		var season = seasonYears[si];
		var seasonRecords = seasons[season];
		
		var seasonConversions = 0;
		var seasonExpiries = 0;
		var seasonUnknown = 0;
		
		for (var ri = 0; ri < seasonRecords.length; ri++) {
			var entry = seasonRecords[ri];
			
			// Validate required fields
			if (!entry.rosterId) {
				stats.errors.push(season + ' ' + entry.playerName + ': Missing rosterId');
				stats.skipped++;
				continue;
			}
			
			var franchise = franchiseByRosterId[entry.rosterId];
			if (!franchise) {
				stats.errors.push(season + ' ' + entry.playerName + ': Unknown franchise ' + entry.rosterId);
				stats.skipped++;
				continue;
			}
			
			// Find or create player
			var player = await upsert.findOrCreate(entry);
			if (!player && !args.dryRun) {
				stats.errors.push(season + ' ' + entry.playerName + ': Could not resolve player');
				stats.skipped++;
				continue;
			}
			
			if (args.dryRun) {
				if (entry.type === 'rfa-rights-conversion') seasonConversions++;
				else if (entry.type === 'contract-expiry') seasonExpiries++;
				else if (entry.type === 'rfa-unknown') seasonUnknown++;
				continue;
			}
			
			try {
				// Use index offset to maintain ordering within the same timestamp
				var timestamp = new Date(entry.timestamp);
				var adjustedTimestamp = new Date(timestamp.getTime() + (ri * 1000));
				
				await Transaction.create({
					type: entry.type,
					timestamp: adjustedTimestamp,
					source: mapSource(entry.source),
					franchiseId: franchise._id,
					playerId: player._id,
					salary: entry.salary,
					startYear: entry.startYear,
					endYear: entry.endYear
				});
				
				if (entry.type === 'rfa-rights-conversion') {
					seasonConversions++;
					stats.rfaConversions++;
				} else if (entry.type === 'contract-expiry') {
					seasonExpiries++;
					stats.contractExpiries++;
				} else if (entry.type === 'rfa-unknown') {
					seasonUnknown++;
					stats.rfaUnknown++;
				}
			} catch (err) {
				if (err.code === 11000) {
					stats.errors.push(season + ' ' + entry.playerName + ': Duplicate');
					stats.skipped++;
				} else {
					throw err;
				}
			}
		}
		
		console.log(season + ': ' + seasonConversions + ' conversions, ' + seasonExpiries + ' expiries, ' + seasonUnknown + ' unknown');
	}
	
	console.log('');
	console.log('Done!');
	console.log('  RFA conversions: ' + stats.rfaConversions);
	console.log('  Contract expiries: ' + stats.contractExpiries);
	console.log('  RFA unknown: ' + stats.rfaUnknown);
	console.log('  Players created: ' + upsert.stats.created);
	console.log('  Positions updated: ' + upsert.stats.positionsUpdated);
	console.log('  Skipped: ' + stats.skipped);
	
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
