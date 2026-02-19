/**
 * Seed draft picks and draft transactions from drafts.json
 * 
 * Creates:
 *   - Pick records (with status 'used' or 'passed')
 *   - draft-select transactions (when player was selected)
 *   - draft-pass transactions (when pick was passed)
 * 
 * Usage:
 *   docker compose run --rm -it web node data/seed/drafts-from-json.js
 *   docker compose run --rm -it web node data/seed/drafts-from-json.js --clear
 *   docker compose run --rm -it web node data/seed/drafts-from-json.js --dry-run
 */

require('dotenv').config({ path: __dirname + '/../../.env' });

var mongoose = require('mongoose');
var fs = require('fs');
var path = require('path');

var Franchise = require('../../models/Franchise');
var Pick = require('../../models/Pick');
var Player = require('../../models/Player');
var Transaction = require('../../models/Transaction');
var leagueDates = require('../../config/dates.js');
var playerUpsert = require('../utils/player-upsert');

mongoose.connect(process.env.MONGODB_URI);

var DRAFTS_FILE = path.join(__dirname, '../drafts/drafts.json');

// Parse command line arguments
var args = {
	clear: process.argv.includes('--clear'),
	dryRun: process.argv.includes('--dry-run')
};

// Stats
var stats = {
	picksCreated: 0,
	picksSkipped: 0,
	selectionsCreated: 0,
	passesCreated: 0,
	errors: []
};

// Caches
var franchiseByRosterId = {};
var playersBySleeperId = {};
var playersByName = {};
var upsert = null; // Initialized in seed()

/**
 * Get the draft timestamp for a given season.
 * Falls back to August 15 at noon if no date configured.
 */
function getDraftTimestamp(season) {
	var date = leagueDates.getDraftDate(season);
	if (date) return date;
	// Fallback
	return new Date(Date.UTC(season, 7, 15, 16, 0, 0));
}

async function seed() {
	console.log('Seeding drafts from drafts.json...');
	if (args.dryRun) console.log('[DRY RUN]');
	console.log('');
	
	// Clear existing data if requested
	if (args.clear && !args.dryRun) {
		console.log('Clearing existing picks...');
		var pickResult = await Pick.deleteMany({});
		console.log('  Deleted ' + pickResult.deletedCount + ' picks');
		
		console.log('Clearing existing draft transactions...');
		var txResult = await Transaction.deleteMany({ 
			type: { $in: ['draft-select', 'draft-pass'] } 
		});
		console.log('  Deleted ' + txResult.deletedCount + ' transactions');
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
	
	// Load drafts.json
	var drafts = JSON.parse(fs.readFileSync(DRAFTS_FILE, 'utf8'));
	console.log('Loaded ' + drafts.length + ' draft entries');
	console.log('');
	
	// Group by season for progress reporting
	var seasons = {};
	drafts.forEach(function(d) {
		if (!seasons[d.season]) seasons[d.season] = [];
		seasons[d.season].push(d);
	});
	
	var seasonYears = Object.keys(seasons).map(Number).sort(function(a, b) { return a - b; });
	
	for (var si = 0; si < seasonYears.length; si++) {
		var season = seasonYears[si];
		var seasonDrafts = seasons[season];
		var draftTimestamp = getDraftTimestamp(season);
		
		var seasonPicks = 0;
		var seasonSelections = 0;
		var seasonPasses = 0;
		
		for (var di = 0; di < seasonDrafts.length; di++) {
			var entry = seasonDrafts[di];
			
			// Validate required fields
			if (!entry.ownerFranchiseId) {
				stats.errors.push(season + ' R' + entry.round + ' #' + entry.pickNumber + ': Missing ownerFranchiseId');
				stats.picksSkipped++;
				continue;
			}
			if (!entry.originFranchiseId) {
				stats.errors.push(season + ' R' + entry.round + ' #' + entry.pickNumber + ': Missing originFranchiseId');
				stats.picksSkipped++;
				continue;
			}
			
			var currentFranchise = franchiseByRosterId[entry.ownerFranchiseId];
			var originalFranchise = franchiseByRosterId[entry.originFranchiseId];
			
			if (!currentFranchise) {
				stats.errors.push(season + ' R' + entry.round + ' #' + entry.pickNumber + ': Unknown franchise ' + entry.ownerFranchiseId);
				stats.picksSkipped++;
				continue;
			}
			if (!originalFranchise) {
				stats.errors.push(season + ' R' + entry.round + ' #' + entry.pickNumber + ': Unknown franchise ' + entry.originFranchiseId);
				stats.picksSkipped++;
				continue;
			}
			
			var isPassed = entry.passed === true;
			var hasPlayer = entry.playerName || entry.sleeperId;
			
			// Determine transaction type and player
			var transactionType = isPassed ? 'draft-pass' : 'draft-select';
			var player = null;
			
			if (hasPlayer && !isPassed) {
				player = await upsert.findOrCreate(entry);
				if (!player && !args.dryRun) {
					stats.errors.push(season + ' R' + entry.round + ' #' + entry.pickNumber + ': Could not resolve player ' + entry.playerName);
					stats.picksSkipped++;
					continue;
				}
			}
			
			// Calculate timestamp with offset to maintain pick order
			// Add 1 second per pick to ensure ordering
			var pickTimestamp = new Date(draftTimestamp.getTime() + (entry.pickNumber * 1000));
			
			if (args.dryRun) {
				seasonPicks++;
				if (isPassed) {
					seasonPasses++;
				} else if (player) {
					seasonSelections++;
				}
				continue;
			}
			
			try {
				// Create Pick record
				var pick = await Pick.create({
					pickNumber: entry.pickNumber,
					round: entry.round,
					season: season,
					originalFranchiseId: originalFranchise._id,
					currentFranchiseId: currentFranchise._id,
					status: isPassed ? 'passed' : 'used'
				});
				seasonPicks++;
				stats.picksCreated++;
				
				// Create transaction
				var txData = {
					type: transactionType,
					timestamp: pickTimestamp,
					source: 'snapshot',
					franchiseId: currentFranchise._id,
					pickId: pick._id
				};
				
				if (player) {
					txData.playerId = player._id;
					
					// Use positions and salary from enriched JSON if available
					if (entry.positions && entry.positions.length > 0) {
						txData.draftedPositions = entry.positions;
					}
					if (entry.salary) {
						txData.salary = entry.salary;
					}
				}
				
				var transaction = await Transaction.create(txData);
				
				// Link pick to transaction
				await Pick.updateOne({ _id: pick._id }, { transactionId: transaction._id });
				
				if (isPassed) {
					seasonPasses++;
					stats.passesCreated++;
				} else {
					seasonSelections++;
					stats.selectionsCreated++;
				}
			} catch (err) {
				if (err.code === 11000) {
					stats.errors.push(season + ' R' + entry.round + ' #' + entry.pickNumber + ': Duplicate');
					stats.picksSkipped++;
				} else {
					throw err;
				}
			}
		}
		
		console.log(season + ': ' + seasonPicks + ' picks, ' + seasonSelections + ' selections, ' + seasonPasses + ' passes');
	}
	
	console.log('');
	console.log('Done!');
	console.log('  Picks created: ' + stats.picksCreated);
	console.log('  Picks skipped: ' + stats.picksSkipped);
	console.log('  Selections created: ' + stats.selectionsCreated);
	console.log('  Passes created: ' + stats.passesCreated);
	console.log('  Players created: ' + upsert.stats.created);
	console.log('  Positions updated: ' + upsert.stats.positionsUpdated);
	
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
