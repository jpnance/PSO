/**
 * Seed contract transactions from contracts.json
 * 
 * Creates contract transactions for ALL signed contracts (drafted, auctioned, FA).
 * 
 * Timestamps: contract due date at noon ET
 * 
 * Usage:
 *   docker compose run --rm -it web node data/seed/contracts-from-json.js
 *   docker compose run --rm -it web node data/seed/contracts-from-json.js --clear
 *   docker compose run --rm -it web node data/seed/contracts-from-json.js --dry-run
 */

require('dotenv').config({ path: __dirname + '/../../.env' });

var mongoose = require('mongoose');
var fs = require('fs');
var path = require('path');

var Franchise = require('../../models/Franchise');
var Player = require('../../models/Player');
var Transaction = require('../../models/Transaction');
var leagueDates = require('../../config/dates.js');
var playerUpsert = require('../utils/player-upsert');

mongoose.connect(process.env.MONGODB_URI);

var CONTRACTS_FILE = path.join(__dirname, '../contracts/contracts.json');

// Parse command line arguments
var args = {
	clear: process.argv.includes('--clear'),
	dryRun: process.argv.includes('--dry-run')
};

// Stats
var stats = {
	contractsCreated: 0,
	skipped: 0,
	errors: []
};

// Caches
var franchiseByRosterId = {};
var playersBySleeperId = {};
var playersByName = {};
var upsert = null; // Initialized in seed()

/**
 * Get the contract due date timestamp for a given season.
 * Falls back to August 31 at noon if no date configured.
 */
function getContractTimestamp(season) {
	var date = leagueDates.getContractDueDate(season);
	if (date) return date;
	// Fallback
	return new Date(Date.UTC(season, 7, 31, 16, 0, 0));
}

async function seed() {
	console.log('Seeding contracts from contracts.json...');
	if (args.dryRun) console.log('[DRY RUN]');
	console.log('');
	
	// Clear existing data if requested
	if (args.clear && !args.dryRun) {
		console.log('Clearing existing contract transactions...');
		var result = await Transaction.deleteMany({ type: 'contract' });
		console.log('  Deleted ' + result.deletedCount + ' contract transactions');
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
	
	// Load contracts.json
	var contracts = JSON.parse(fs.readFileSync(CONTRACTS_FILE, 'utf8'));
	console.log('Loaded ' + contracts.length + ' contract entries');
	console.log('');
	
	// Group by season for progress reporting
	var seasons = {};
	contracts.forEach(function(c) {
		if (!seasons[c.season]) seasons[c.season] = [];
		seasons[c.season].push(c);
	});
	
	var seasonYears = Object.keys(seasons).map(Number).sort(function(a, b) { return a - b; });
	
	for (var si = 0; si < seasonYears.length; si++) {
		var season = seasonYears[si];
		var seasonContracts = seasons[season];
		var contractTimestamp = getContractTimestamp(season);
		
		var seasonContractCount = 0;
		
		for (var ci = 0; ci < seasonContracts.length; ci++) {
			var entry = seasonContracts[ci];
			
			// Validate required fields
			if (!entry.rosterId) {
				stats.errors.push(season + ' ' + entry.name + ': Missing rosterId');
				stats.skipped++;
				continue;
			}
			
			// Skip entries without valid contract terms
			if (!entry.startYear || !entry.endYear) {
				stats.skipped++;
				continue;
			}
			
			var franchise = franchiseByRosterId[entry.rosterId];
			if (!franchise) {
				stats.errors.push(season + ' ' + entry.name + ': Unknown franchise ' + entry.rosterId);
				stats.skipped++;
				continue;
			}
			
			// Find or create player (with position upsert)
			var player = await upsert.findOrCreate(entry);
			if (!player && !args.dryRun) {
				stats.errors.push(season + ' ' + entry.name + ': Could not resolve player');
				stats.skipped++;
				continue;
			}
			
			if (args.dryRun) {
				seasonContractCount++;
				continue;
			}
			
			try {
				// Create contract transaction
				// Use custom timestamp if present (early contract exceptions),
				// otherwise use season's contract due date with index offset
				var contractTs;
				if (entry.timestamp) {
					contractTs = new Date(entry.timestamp);
				} else {
					contractTs = new Date(contractTimestamp.getTime() + (ci * 1000));
				}
				
				await Transaction.create({
					type: 'contract',
					timestamp: contractTs,
					source: entry.source || 'snapshot',
					franchiseId: franchise._id,
					playerId: player._id,
					salary: entry.salary,
					startYear: entry.startYear,
					endYear: entry.endYear
				});
				seasonContractCount++;
				stats.contractsCreated++;
			} catch (err) {
				if (err.code === 11000) {
					stats.errors.push(season + ' ' + entry.name + ': Duplicate');
					stats.skipped++;
				} else {
					throw err;
				}
			}
		}
		
		console.log(season + ': ' + seasonContractCount + ' contracts');
	}
	
	console.log('');
	console.log('Done!');
	console.log('  Contracts created: ' + stats.contractsCreated);
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
