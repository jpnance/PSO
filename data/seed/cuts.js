/**
 * Seed cut transactions from the pre-extracted cuts.json file.
 * 
 * For cuts with existing FA drops in the database (from Sleeper/Fantrax),
 * enriches those drops with contract data (salary, term, buyouts).
 * 
 * For cuts without matching FA drops (offseason cuts, pre-2020 era),
 * creates new cut-only transactions.
 * 
 * Usage:
 *   docker compose run --rm -it web node data/seed/cuts.js
 *   docker compose run --rm -it web node data/seed/cuts.js --dry-run
 *   docker compose run --rm -it web node data/seed/cuts.js --auto-historical-before=2016
 *   docker compose run --rm -it web node data/seed/cuts.js --year=2024
 */

var dotenv = require('dotenv').config({ path: __dirname + '/../../.env' });
var mongoose = require('mongoose');
var readline = require('readline');

var Player = require('../../models/Player');
var Franchise = require('../../models/Franchise');
var Transaction = require('../../models/Transaction');
var PSO = require('../../config/pso.js');
var resolver = require('../utils/player-resolver');

mongoose.connect(process.env.MONGODB_URI);

// Auction dates (cut day is approximately one week before)
var AUCTION_DATES = {
	2008: new Date('2008-08-18'),
	2009: new Date('2009-08-16'),
	2010: new Date('2010-08-22'),
	2011: new Date('2011-08-20'),
	2012: new Date('2012-08-25'),
	2013: new Date('2013-08-24'),
	2014: new Date('2014-08-23'),
	2015: new Date('2015-08-29'),
	2016: new Date('2016-08-20'),
	2017: new Date('2017-08-19'),
	2018: new Date('2018-08-25'),
	2019: new Date('2019-08-24'),
	2020: new Date('2020-08-29'),
	2021: new Date('2021-08-28'),
	2022: new Date('2022-08-27'),
	2023: new Date('2023-08-26'),
	2024: new Date('2024-08-24'),
	2025: new Date('2025-08-23')
};

// First in-season cut row (1-indexed) for historical years.
// Cuts before this row are offseason (cut day timestamp).
// Cuts at or after this row are in-season (late-season timestamp).
// 0 means all cuts are in-season for that year.
var IN_SEASON_BOUNDARY = {
	2009: 0,
	2010: 40,
	2011: 30,
	2012: 38,
	2013: 35,
	2014: 41, // Celek/Bray still on Schex's team suggests he held on cut day
	2015: 30, // Kenbrell Thompkins not in Daniel's contracts email
	2016: 59,
	2017: 33,
	2018: 42,
	2019: 58
};

/**
 * Get the conventional cut day timestamp for a given year.
 * Cut day is one week before the auction, at 12:00:00 AM ET (midnight).
 * Uses :00 seconds since this is a known date, not an uncertain inference.
 */
function getCutDayTimestamp(year) {
	var auctionDate = AUCTION_DATES[year];
	if (auctionDate) {
		// One week before auction
		var cutDay = new Date(auctionDate);
		cutDay.setDate(cutDay.getDate() - 7);
		// Set to 12:00:00 AM ET (05:00:00 UTC in EST, 04:00:00 UTC in EDT)
		// August is EDT (UTC-4)
		return new Date(Date.UTC(cutDay.getFullYear(), cutDay.getMonth(), cutDay.getDate(), 4, 0, 0));
	}
	// Fallback: mid-August
	return new Date(Date.UTC(year, 7, 15, 4, 0, 0));
}

/**
 * Get the conventional late-season timestamp for in-season cuts.
 * Uses December 15 at 12:00:33 PM ET as a conventional date.
 */
function getLateSeasonTimestamp(year) {
	// December 15 at 12:00:33 PM ET (17:00:33 UTC, EST not DST)
	return new Date(Date.UTC(year, 11, 15, 17, 0, 33));
}

/**
 * Get timestamp just before a given date (same day, but at midnight ET).
 * Used for cuts that must precede an FA pickup.
 */
function getTimestampJustBefore(date) {
	// Same day at 00:00:33 ET
	// If date is in DST (Apr-Nov), ET = UTC-4, so 04:00:33 UTC
	// If date is in EST (Nov-Mar), ET = UTC-5, so 05:00:33 UTC
	// September is DST
	var d = new Date(date);
	return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 4, 0, 33));
}

/**
 * Check if a cut row is in-season based on the boundary.
 * @param {number} year - The cut year
 * @param {number} rowIndex - 0-based row index within the year's cuts
 * @returns {boolean} True if in-season, false if offseason
 */
function isInSeasonCut(year, rowIndex) {
	var boundary = IN_SEASON_BOUNDARY[year];
	if (boundary === undefined) {
		// Years not in the boundary list (2020+) use modern data sources
		// that have accurate timestamps, so this shouldn't be called
		return false;
	}
	if (boundary === 0) {
		// All cuts are in-season
		return true;
	}
	// boundary is 1-indexed, rowIndex is 0-indexed
	return rowIndex >= (boundary - 1);
}

// Global state
var rl = null;
var playersByNormalizedName = {};
var franchiseByRosterId = {};
var autoHistoricalThreshold = null;

/**
 * Parse command line arguments.
 */
function parseArgs() {
	var args = {
		dryRun: process.argv.includes('--dry-run'),
		clear: process.argv.includes('--clear'),
		yearStart: null,
		yearEnd: null,
		autoHistoricalBefore: null
	};
	
	// Single year filter
	var yearArg = process.argv.find(function(a) { return a.startsWith('--year='); });
	if (yearArg) {
		var year = parseInt(yearArg.split('=')[1]);
		args.yearStart = year;
		args.yearEnd = year;
	}
	
	// Auto-historical threshold
	var autoHistArg = process.argv.find(function(a) { return a.startsWith('--auto-historical-before='); });
	if (autoHistArg) {
		args.autoHistoricalBefore = parseInt(autoHistArg.split('=')[1]);
	}
	
	return args;
}

/**
 * Load cuts from the JSON file (extracted from Sheets).
 */
function loadCuts(yearStart, yearEnd) {
	var allCuts = require('../cuts/cuts.json');
	
	if (yearStart === null && yearEnd === null) {
		return allCuts;
	}
	
	return allCuts.filter(function(c) {
		if (yearStart !== null && c.cutYear < yearStart) return false;
		if (yearEnd !== null && c.cutYear > yearEnd) return false;
		return true;
	});
}

/**
 * Compute buy-outs for a cut.
 * Contract years get 60%/30%/15% for year 1/2/3 of contract.
 * Only years >= cutYear incur buy-outs.
 */
function computeBuyOuts(salary, startYear, endYear, cutYear) {
	var buyOuts = [];
	var percentages = [0.60, 0.30, 0.15];
	
	if (startYear === null) {
		startYear = endYear;
	}
	
	for (var year = startYear; year <= endYear; year++) {
		var contractYearIndex = year - startYear;
		if (contractYearIndex >= percentages.length) break;
		
		if (year >= cutYear) {
			var amount = Math.ceil(salary * percentages[contractYearIndex]);
			if (amount > 0) {
				buyOuts.push({ season: year, amount: amount });
			}
		}
	}
	
	return buyOuts;
}

/**
 * Resolve a player using the unified prompt system.
 * Supports auto-historical creation for old years.
 */
async function resolvePlayer(cut) {
	var context = {
		year: cut.cutYear,
		type: 'cut',
		franchise: cut.owner
	};
	
	var lookupName = cut.hint ? cut.rawName : cut.name;
	var normalizedName = resolver.normalizePlayerName(lookupName);
	var candidates = playersByNormalizedName[normalizedName] || [];
	
	// Also try without hint if no candidates found
	if (candidates.length === 0 && cut.hint) {
		var plainNormalized = resolver.normalizePlayerName(cut.name);
		candidates = playersByNormalizedName[plainNormalized] || [];
	}
	
	// Check cache first
	var cached = resolver.lookup(lookupName, context);
	if (cached && cached.sleeperId) {
		var player = await Player.findOne({ sleeperId: cached.sleeperId });
		if (player) return { playerId: player._id };
	}
	if (cached && cached.name) {
		var player = await Player.findOne({ name: cached.name, sleeperId: null });
		if (player) return { playerId: player._id };
	}
	
	// Single non-ambiguous match
	if (candidates.length === 1 && !resolver.isAmbiguous(normalizedName)) {
		return { playerId: candidates[0]._id };
	}
	
	// Auto-historical for old years with no candidates
	// Skip if there's already a cached resolution (don't overwrite manual fixes)
	if (autoHistoricalThreshold && cut.cutYear < autoHistoricalThreshold && candidates.length === 0 && !cached) {
		// Check if historical player already exists
		var existing = await Player.findOne({ name: cut.name, sleeperId: null });
		if (existing) {
			resolver.addResolution(lookupName, null, cut.name, context);
			return { playerId: existing._id };
		}
		
		// Create historical player
		console.log('  Auto-creating historical: ' + cut.name + ' (' + cut.position + ')');
		var player = await Player.create({
			name: cut.name,
			positions: cut.position ? [cut.position] : [],
			sleeperId: null
		});
		
		// Add to cache for future lookups
		if (!playersByNormalizedName[normalizedName]) {
			playersByNormalizedName[normalizedName] = [];
		}
		playersByNormalizedName[normalizedName].push(player);
		
		resolver.addResolution(lookupName, null, cut.name, context);
		return { playerId: player._id };
	}
	
	// Need interactive resolution
	if (candidates.length > 1 || candidates.length === 0 || resolver.isAmbiguous(normalizedName)) {
		var result = await resolver.promptForPlayer({
			name: lookupName,
			context: context,
			candidates: candidates,
			position: cut.position,
			Player: Player,
			rl: rl,
			playerCache: playersByNormalizedName,
			autoHistorical: autoHistoricalThreshold && cut.cutYear < autoHistoricalThreshold
		});
		
		if (result.action === 'quit') {
			throw new Error('User quit');
		}
		
		if (result.player) {
			return { playerId: result.player._id };
		}
	}
	
	return { playerId: null };
}

/**
 * Find a matching FA drop in the database.
 * Match by: playerId + franchiseId + year (drop timestamp year = cutYear)
 */
async function findMatchingDrop(playerId, franchiseId, cutYear) {
	// Find FA transactions with drops for this player+franchise in this year
	var yearStart = new Date(Date.UTC(cutYear, 0, 1));
	var yearEnd = new Date(Date.UTC(cutYear + 1, 0, 1));
	
	var txs = await Transaction.find({
		type: 'fa',
		franchiseId: franchiseId,
		'drops.playerId': playerId,
		timestamp: { $gte: yearStart, $lt: yearEnd }
	});
	
	if (txs.length === 0) {
		return null;
	}
	
	if (txs.length === 1) {
		return txs[0];
	}
	
	// Multiple matches - return the one with the latest timestamp
	txs.sort(function(a, b) { return b.timestamp - a.timestamp; });
	return txs[0];
}

/**
 * Main run function.
 */
async function run() {
	var args = parseArgs();
	autoHistoricalThreshold = args.autoHistoricalBefore;
	
	console.log('Seeding cuts from cuts.json');
	if (args.yearStart || args.yearEnd) {
		console.log('Years:', args.yearStart || 'all', '-', args.yearEnd || 'all');
	} else {
		console.log('Years: all');
	}
	if (args.autoHistoricalBefore) {
		console.log('Auto-creating historical players for cuts before', args.autoHistoricalBefore);
	}
	if (args.dryRun) console.log('[DRY RUN]');
	console.log('');
	
	console.log('Loaded', resolver.count(), 'cached player resolutions');
	
	// Create readline interface
	rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout
	});
	
	// Load all players and build lookup
	var allPlayers = await Player.find({});
	allPlayers.forEach(function(p) {
		var normalized = resolver.normalizePlayerName(p.name);
		if (!playersByNormalizedName[normalized]) {
			playersByNormalizedName[normalized] = [];
		}
		playersByNormalizedName[normalized].push(p);
	});
	console.log('Loaded', allPlayers.length, 'players from database');
	
	// Load franchises
	var franchises = await Franchise.find({});
	franchises.forEach(function(f) {
		if (f.rosterId) {
			franchiseByRosterId[f.rosterId] = f._id;
		}
	});
	console.log('Loaded', franchises.length, 'franchises');
	
	// Load cuts
	var cuts = loadCuts(args.yearStart, args.yearEnd);
	console.log('Loaded', cuts.length, 'cuts from cuts.json');
	
	// Load FA pickups for timestamp cross-referencing
	// Build a map: playerId -> [{ franchiseId, timestamp }]
	var faPickups = await Transaction.find({
		type: 'fa',
		'adds.0': { $exists: true }  // Has at least one add (pickup)
	}).populate('adds.playerId', 'name');
	
	var faPickupsByPlayer = {};
	faPickups.forEach(function(tx) {
		tx.adds.forEach(function(add) {
			if (!add.playerId) return;
			var playerId = add.playerId._id.toString();
			var year = tx.timestamp.getFullYear();
			var key = playerId + '|' + year;
			if (!faPickupsByPlayer[key]) {
				faPickupsByPlayer[key] = [];
			}
			faPickupsByPlayer[key].push({
				franchiseId: tx.franchiseId.toString(),
				timestamp: tx.timestamp
			});
		});
	});
	console.log('Loaded FA pickups for', Object.keys(faPickupsByPlayer).length, 'player-years');
	console.log('');
	
	// Clear existing if requested
	if (args.clear && !args.dryRun) {
		console.log('Clearing existing snapshot-sourced FA transactions...');
		var deleted = await Transaction.deleteMany({ type: 'fa', source: 'snapshot' });
		console.log('  Deleted', deleted.deletedCount, 'transactions');
		console.log('');
	}
	
	// Stats
	var enriched = 0;
	var created = 0;
	var skipped = 0;
	var errors = [];
	
	// Track row index within each year for boundary detection
	var currentYear = null;
	var rowInYear = 0;
	
	for (var i = 0; i < cuts.length; i++) {
		var cut = cuts[i];
		
		// Track row within year (increment first, so rowInYear is 0-indexed position)
		if (cut.cutYear !== currentYear) {
			currentYear = cut.cutYear;
			rowInYear = 0;
		} else {
			rowInYear++;
		}
		
		// Compute buy-outs
		var buyOuts = computeBuyOuts(cut.salary, cut.startYear, cut.endYear, cut.cutYear);
		
		// Resolve franchise
		var rosterId = PSO.franchiseIds[cut.owner];
		if (!rosterId) {
			errors.push({ player: cut.name, reason: 'Unknown owner: ' + cut.owner });
			skipped++;
			continue;
		}
		
		var franchiseId = franchiseByRosterId[rosterId];
		if (!franchiseId) {
			errors.push({ player: cut.name, reason: 'No franchise for rosterId: ' + rosterId });
			skipped++;
			continue;
		}
		
		// Resolve player
		var resolution;
		try {
			resolution = await resolvePlayer(cut);
		} catch (err) {
			if (err.message === 'User quit') {
				console.log('\nQuitting...');
				break;
			}
			throw err;
		}
		
		if (!resolution.playerId) {
			errors.push({ player: cut.name, reason: 'Could not resolve player' });
			skipped++;
			continue;
		}
		
		var playerId = resolution.playerId;
		
		// Try to find matching FA drop (only for years with platform data)
		var matchingTx = null;
		if (cut.cutYear >= 2020) {
			matchingTx = await findMatchingDrop(playerId, franchiseId, cut.cutYear);
		}
		
		if (matchingTx) {
			// Enrich the existing drop with contract info
			var dropIndex = matchingTx.drops.findIndex(function(d) {
				return d.playerId.toString() === playerId.toString();
			});
			
			if (dropIndex >= 0) {
				if (!args.dryRun) {
					matchingTx.drops[dropIndex].salary = cut.salary;
					matchingTx.drops[dropIndex].startYear = cut.startYear;
					matchingTx.drops[dropIndex].endYear = cut.endYear;
					matchingTx.drops[dropIndex].buyOuts = buyOuts;
					await matchingTx.save();
				}
				enriched++;
			}
		} else {
			// Determine timestamp based on in-season boundary and FA pickup cross-reference
			var timestamp;
			if (!isInSeasonCut(cut.cutYear, rowInYear)) {
				// Offseason cut: use cut day
				timestamp = getCutDayTimestamp(cut.cutYear);
			} else {
				// In-season cut: check for FA pickup by a different owner
				var faKey = playerId.toString() + '|' + cut.cutYear;
				var pickups = faPickupsByPlayer[faKey] || [];
				var franchiseIdStr = franchiseId.toString();
				
				// Find a pickup by a DIFFERENT owner
				var pickupByOther = pickups.find(function(p) {
					return p.franchiseId !== franchiseIdStr;
				});
				
				if (pickupByOther) {
					// This cut enabled an FA pickup by someone else
					// Timestamp just before the pickup
					timestamp = getTimestampJustBefore(pickupByOther.timestamp);
				} else {
					// No pickup by another owner, use late season
					timestamp = getLateSeasonTimestamp(cut.cutYear);
				}
			}
			
			// Create new cut-only transaction
			if (!args.dryRun) {
				await Transaction.create({
					type: 'fa',
					timestamp: timestamp,
					source: 'snapshot',
					franchiseId: franchiseId,
					adds: [],
					drops: [{
						playerId: playerId,
						salary: cut.salary,
						startYear: cut.startYear,
						endYear: cut.endYear,
						buyOuts: buyOuts
					}]
				});
			}
			created++;
		}
		
		// Progress
		if ((i + 1) % 100 === 0) {
			console.log('  Processed', i + 1, '/', cuts.length, '...');
		}
	}
	
	// Save resolutions
	resolver.save();
	
	console.log('\nDone!');
	console.log('  Enriched existing drops:', enriched);
	console.log('  Created new cut transactions:', created);
	console.log('  Skipped:', skipped);
	
	if (errors.length > 0) {
		console.log('\nErrors (first 20):');
		errors.slice(0, 20).forEach(function(e) {
			console.log('  -', e.player + ':', e.reason);
		});
		if (errors.length > 20) {
			console.log('  ... and', errors.length - 20, 'more');
		}
	}
	
	rl.close();
	process.exit(0);
}

run().catch(function(err) {
	console.error('Error:', err);
	if (rl) rl.close();
	process.exit(1);
});
