/**
 * Seed FA transactions (pickups and drops) from fa.json
 * 
 * Creates:
 *   - type: 'fa' transactions with adds[] and drops[] arrays
 * 
 * Usage:
 *   docker compose run --rm -it web node data/seed/fa-from-json.js
 *   docker compose run --rm -it web node data/seed/fa-from-json.js --clear
 *   docker compose run --rm -it web node data/seed/fa-from-json.js --dry-run
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

var FA_FILE = path.join(__dirname, '../fa/fa.json');

// Parse command line arguments
var args = {
	clear: process.argv.includes('--clear'),
	dryRun: process.argv.includes('--dry-run')
};

// Stats
var stats = {
	transactionsCreated: 0,
	skipped: 0,
	errors: []
};

// Caches
var franchiseByRosterId = {};
var playersBySleeperId = {};
var playersByName = {};
var upsert = null; // Initialized in seed()

/**
 * Map source field to Transaction source enum.
 */
function mapSource(faSource) {
	switch (faSource) {
		case 'sleeper':
			return 'sleeper';
		case 'fantrax':
			return 'fantrax';
		case 'cuts':
			return 'cuts';
		case 'inferred':
		default:
			return 'snapshot';
	}
}

async function seed() {
	console.log('Seeding FA transactions from fa.json...');
	if (args.dryRun) console.log('[DRY RUN]');
	console.log('');
	
	// Clear existing data if requested
	if (args.clear && !args.dryRun) {
		console.log('Clearing existing FA transactions...');
		var result = await Transaction.deleteMany({ type: 'fa' });
		console.log('  Deleted ' + result.deletedCount + ' transactions');
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
	
	// Initialize player upsert helper (handles position backfilling)
	upsert = playerUpsert.create({
		Player: Player,
		playersBySleeperId: playersBySleeperId,
		playersByName: playersByName,
		dryRun: args.dryRun
	});
	
	// Load fa.json
	var faTransactions = JSON.parse(fs.readFileSync(FA_FILE, 'utf8'));
	console.log('Loaded ' + faTransactions.length + ' FA transaction entries');
	console.log('');
	
	// Group by season for progress reporting
	var seasons = {};
	faTransactions.forEach(function(t) {
		if (!seasons[t.season]) seasons[t.season] = [];
		seasons[t.season].push(t);
	});
	
	var seasonYears = Object.keys(seasons).map(Number).sort(function(a, b) { return a - b; });
	
	for (var si = 0; si < seasonYears.length; si++) {
		var season = seasonYears[si];
		var seasonTx = seasons[season];
		var seasonCreated = 0;
		
		for (var ti = 0; ti < seasonTx.length; ti++) {
			var entry = seasonTx[ti];
			
			// Validate required fields
			if (!entry.rosterId) {
				stats.errors.push(season + ' tx ' + ti + ': Missing rosterId');
				stats.skipped++;
				continue;
			}
			
			var franchise = franchiseByRosterId[entry.rosterId];
			if (!franchise) {
				stats.errors.push(season + ' tx ' + ti + ': Unknown franchise ' + entry.rosterId);
				stats.skipped++;
				continue;
			}
			
			// Process adds
			var adds = [];
			var addErrors = [];
			for (var ai = 0; ai < (entry.adds || []).length; ai++) {
				var addEntry = entry.adds[ai];
				var player = await upsert.findOrCreate(addEntry);
				if (!player && !args.dryRun) {
					addErrors.push('Could not resolve add: ' + addEntry.name);
					continue;
				}
				if (player) {
					adds.push({
						playerId: player._id,
						salary: addEntry.salary || null,
						startYear: addEntry.startYear || null,
						endYear: addEntry.endYear || null
					});
				}
			}
			
			// Process drops
			var drops = [];
			var dropErrors = [];
			for (var di = 0; di < (entry.drops || []).length; di++) {
				var dropEntry = entry.drops[di];
				var player = await upsert.findOrCreate(dropEntry);
				if (!player && !args.dryRun) {
					dropErrors.push('Could not resolve drop: ' + dropEntry.name);
					continue;
				}
				if (player) {
					drops.push({
						playerId: player._id,
						salary: dropEntry.salary || null,
						startYear: dropEntry.startYear || null,
						endYear: dropEntry.endYear || null
					});
				}
			}
			
			// Skip if we have no adds or drops resolved
			if (adds.length === 0 && drops.length === 0) {
				if (addErrors.length > 0 || dropErrors.length > 0) {
					stats.errors = stats.errors.concat(addErrors).concat(dropErrors);
				}
				stats.skipped++;
				continue;
			}
			
			if (args.dryRun) {
				seasonCreated++;
				continue;
			}
			
			try {
				var timestamp = entry.timestamp ? new Date(entry.timestamp) : new Date(Date.UTC(season, 9, 1, 12, 0, 0));
				
				await Transaction.create({
					type: 'fa',
					timestamp: timestamp,
					source: mapSource(entry.source),
					franchiseId: franchise._id,
					adds: adds,
					drops: drops
				});
				seasonCreated++;
				stats.transactionsCreated++;
				
				// Log any partial errors
				if (addErrors.length > 0 || dropErrors.length > 0) {
					stats.errors = stats.errors.concat(addErrors).concat(dropErrors);
				}
			} catch (err) {
				if (err.code === 11000) {
					stats.errors.push(season + ' tx ' + ti + ': Duplicate');
					stats.skipped++;
				} else {
					throw err;
				}
			}
		}
		
		console.log(season + ': ' + seasonCreated + ' transactions');
	}
	
	console.log('');
	console.log('Done!');
	console.log('  Transactions created: ' + stats.transactionsCreated);
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
