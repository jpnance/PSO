/**
 * Seed FA Pickups from extracted-all.csv
 * 
 * Processes early-year roster data from spreadsheets and XML files that were
 * extracted into extracted-all.csv. Creates FA pickup transactions for players
 * with Start=FA who have an owner.
 * 
 * This captures FA pickups from 2008 that aren't in contracts-2008.txt.
 * 
 * Usage:
 *   docker compose run --rm -it web node data/seed/fa-extracted.js
 *   docker compose run --rm -it web node data/seed/fa-extracted.js --dry-run
 *   docker compose run --rm -it web node data/seed/fa-extracted.js --dry-run --skip-ambiguous
 *   docker compose run --rm -it web node data/seed/fa-extracted.js --clear
 *   docker compose run --rm -it web node data/seed/fa-extracted.js --year=2008
 *   docker compose run --rm -it web node data/seed/fa-extracted.js --source=teams.xls
 */

var dotenv = require('dotenv').config({ path: __dirname + '/../../.env' });
var mongoose = require('mongoose');
var readline = require('readline');

var Player = require('../../models/Player');
var Franchise = require('../../models/Franchise');
var Regime = require('../../models/Regime');
var Transaction = require('../../models/Transaction');
var snapshotFacts = require('../facts/snapshot-facts');
var resolver = require('../utils/player-resolver');

mongoose.connect(process.env.MONGODB_URI);

// Global state for player resolution
var playersByNormalizedName = {};
var rl = null;

/**
 * Build player lookup cache
 */
async function buildPlayerCache() {
	var players = await Player.find({}).lean();
	players.forEach(function(p) {
		var normalized = resolver.normalizePlayerName(p.name);
		if (!playersByNormalizedName[normalized]) {
			playersByNormalizedName[normalized] = [];
		}
		playersByNormalizedName[normalized].push(p);
	});
	return players.length;
}

/**
 * Resolve a player by name, auto-creating historical players for early years
 */
async function resolvePlayer(playerName, context, season, position) {
	var normalizedName = resolver.normalizePlayerName(playerName);
	var candidates = playersByNormalizedName[normalizedName] || [];
	
	// Check cache first
	var cached = resolver.lookup(playerName, context);
	if (cached && cached.sleeperId) {
		var player = await Player.findOne({ sleeperId: cached.sleeperId });
		if (player) return player;
	}
	if (cached && cached.name) {
		var player = await Player.findOne({ name: cached.name, sleeperId: null });
		if (player) return player;
	}
	
	// Filter by position if we have it
	var filteredCandidates = candidates;
	if (position && candidates.length > 1) {
		var posFiltered = candidates.filter(function(c) {
			if (!c.positions || c.positions.length === 0) return true;
			return c.positions.some(function(p) {
				return position.split('/').includes(p);
			});
		});
		if (posFiltered.length > 0) {
			filteredCandidates = posFiltered;
		}
	}
	
	// Single non-ambiguous match
	if (filteredCandidates.length === 1 && !resolver.isAmbiguous(normalizedName)) {
		return filteredCandidates[0];
	}
	
	// Auto-create historical players for early years (before 2016)
	// Skip if there's already a cached resolution (don't overwrite manual fixes)
	if (candidates.length === 0 && season < 2016 && !cached) {
		var existing = await Player.findOne({ name: playerName, sleeperId: null });
		if (existing) {
			resolver.addResolution(playerName, null, playerName, context);
			resolver.save();
			// Add to cache
			if (!playersByNormalizedName[normalizedName]) {
				playersByNormalizedName[normalizedName] = [];
			}
			playersByNormalizedName[normalizedName].push(existing);
			return existing;
		}
		
		console.log('    Auto-creating historical: ' + playerName);
		var player = await Player.create({
			name: playerName,
			positions: position ? position.split('/') : [],
			sleeperId: null
		});
		if (!playersByNormalizedName[normalizedName]) {
			playersByNormalizedName[normalizedName] = [];
		}
		playersByNormalizedName[normalizedName].push(player);
		resolver.addResolution(playerName, null, playerName, context);
		resolver.save();
		return player;
	}
	
	// Interactive resolution if rl is available
	if (rl) {
		var result = await resolver.promptForPlayer({
			name: playerName,
			context: context,
			position: position,
			candidates: filteredCandidates,
			Player: Player,
			rl: rl,
			playerCache: playersByNormalizedName
		});
		
		if (result.action === 'quit') {
			return { quit: true };
		}
		
		return result.player || null;
	}
	
	// Skip if no interactive mode
	return null;
}

/**
 * Get conventional FA timestamp for a season.
 * Uses first Thursday after Labor Day, 12:00:33 ET.
 */
function getConventionalFaTimestamp(year) {
	// Labor Day = first Monday of September
	var sept1 = new Date(year, 8, 1);
	var dayOfWeek = sept1.getDay();
	var daysToMonday = dayOfWeek === 0 ? 1 : (dayOfWeek === 1 ? 0 : 8 - dayOfWeek);
	var laborDay = new Date(year, 8, 1 + daysToMonday);
	
	// First Thursday after Labor Day
	var daysToThursday = (4 - laborDay.getDay() + 7) % 7 || 7;
	var firstThursday = new Date(year, 8, laborDay.getDate() + daysToThursday);
	
	// 12:00:33 ET during DST (September) = 16:00:33 UTC
	return new Date(Date.UTC(
		firstThursday.getFullYear(),
		firstThursday.getMonth(),
		firstThursday.getDate(),
		16, 0, 33
	));
}

/**
 * Build a map of owner name -> franchise ID for a given season
 */
function buildOwnerMap(regimes, franchises, season) {
	var ownerToFranchise = {};
	
	franchises.forEach(function(franchise) {
		for (var i = 0; i < regimes.length; i++) {
			var regime = regimes[i];
			for (var j = 0; j < regime.tenures.length; j++) {
				var tenure = regime.tenures[j];
				if (tenure.franchiseId.equals(franchise._id) &&
					tenure.startSeason <= season &&
					(tenure.endSeason === null || tenure.endSeason >= season)) {
					// Map display name to franchise
					ownerToFranchise[regime.displayName.toLowerCase()] = franchise._id;
					
					// Also map individual parts of slash-separated names
					var parts = regime.displayName.split('/');
					parts.forEach(function(part) {
						ownerToFranchise[part.toLowerCase().trim()] = franchise._id;
					});
				}
			}
		}
	});
	
	return ownerToFranchise;
}

/**
 * Get franchise ID for an owner name
 */
function getFranchiseId(ownerName, ownerMap) {
	if (!ownerName) return null;
	return ownerMap[ownerName.toLowerCase()] || null;
}

async function run() {
	var args = process.argv.slice(2);
	var dryRun = args.includes('--dry-run');
	var clearFirst = args.includes('--clear');
	var skipAmbiguous = args.includes('--skip-ambiguous');
	var yearArg = args.find(function(a) { return a.startsWith('--year='); });
	var sourceArg = args.find(function(a) { return a.startsWith('--source='); });
	var targetYear = yearArg ? parseInt(yearArg.split('=')[1]) : null;
	var targetSource = sourceArg ? sourceArg.split('=')[1] : null;
	
	console.log('=== FA Extracted Seeder ===\n');
	if (dryRun) {
		console.log('DRY RUN MODE\n');
	}
	if (skipAmbiguous) {
		console.log('SKIP AMBIGUOUS MODE\n');
	}
	
	// Build player cache
	var playerCount = await buildPlayerCache();
	console.log('Loaded ' + playerCount + ' players');
	console.log('Loaded ' + resolver.count() + ' cached resolutions\n');
	
	// Set up readline for interactive resolution (unless skipping ambiguous)
	if (!skipAmbiguous) {
		rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout
		});
	}
	
	// Load regimes and franchises for owner -> franchise mapping
	var regimes = await Regime.find({}).lean();
	var franchises = await Franchise.find({}).lean();
	
	// Load extracted-all.csv data
	var allExtracted = snapshotFacts.loadAll(2008, 2012, { 
		includePostseason: false, 
		includeExtracted: true 
	});
	
	// Filter to just extracted sources (source starts with 'extracted:')
	var extracted = allExtracted.filter(function(c) {
		return c.source && c.source.startsWith('extracted:');
	});
	
	console.log('Loaded ' + extracted.length + ' entries from extracted-all.csv');
	
	// Apply filters
	if (targetYear) {
		extracted = extracted.filter(function(c) { return c.season === targetYear; });
		console.log('Filtered to year ' + targetYear + ': ' + extracted.length + ' entries');
	}
	
	if (targetSource) {
		extracted = extracted.filter(function(c) { 
			return c.source === 'extracted:' + targetSource; 
		});
		console.log('Filtered to source ' + targetSource + ': ' + extracted.length + ' entries');
	}
	
	// Filter to FA entries (startYear = null) with owners
	var faEntries = extracted.filter(function(c) {
		return c.startYear === null && c.owner;
	});
	
	console.log('FA entries with owners: ' + faEntries.length + '\n');
	
	if (faEntries.length === 0) {
		console.log('No FA entries to process.');
		rl.close();
		await mongoose.disconnect();
		return;
	}
	
	// Clear existing extracted-sourced FA transactions if requested
	// Note: These use 'snapshot' source since extracted data comes from snapshot sources
	if (clearFirst && !dryRun) {
		var clearQuery = {
			type: 'fa',
			source: 'snapshot'
		};
		if (targetYear) {
			clearQuery.timestamp = {
				$gte: new Date(targetYear + '-01-01'),
				$lt: new Date((targetYear + 1) + '-01-01')
			};
		}
		var deleted = await Transaction.deleteMany(clearQuery);
		console.log('Cleared ' + deleted.deletedCount + ' existing extracted FA transactions\n');
	}
	
	// Group by year for processing
	var byYear = {};
	faEntries.forEach(function(entry) {
		if (!byYear[entry.season]) byYear[entry.season] = [];
		byYear[entry.season].push(entry);
	});
	
	var years = Object.keys(byYear).map(Number).sort();
	var totalCreated = 0;
	var totalSkipped = 0;
	var totalErrors = 0;
	var userQuit = false;
	
	for (var yi = 0; yi < years.length; yi++) {
		if (userQuit) break;
		
		var year = years[yi];
		var entries = byYear[year];
		
		console.log('--- ' + year + ': ' + entries.length + ' FA entries ---');
		
		// Build owner -> franchise map for this season
		var ownerMap = buildOwnerMap(regimes, franchises, year);
		var timestamp = getConventionalFaTimestamp(year);
		var yearCreated = 0;
		
		for (var i = 0; i < entries.length; i++) {
			if (userQuit) break;
			
			var entry = entries[i];
			
			// Resolve player
			var context = { year: year, type: 'fa', franchise: entry.owner };
			var player = await resolvePlayer(entry.playerName, context, year, entry.position);
			
			// User requested quit
			if (player && player.quit) {
				console.log('\nQuitting...');
				resolver.save();
				if (rl) rl.close();
				await mongoose.disconnect();
				process.exit(130); // 130 = interrupted by Ctrl+C convention
			}
			
			if (!player) {
				console.log('  ✗ Could not resolve: ' + entry.playerName);
				totalSkipped++;
				continue;
			}
			
			// Get franchise
			var franchiseId = getFranchiseId(entry.owner, ownerMap);
			if (!franchiseId) {
				console.log('  ✗ Could not find franchise for: ' + entry.owner + ' in ' + year);
				totalErrors++;
				continue;
			}
			
			// Check for existing transaction
			var existing = await Transaction.findOne({
				type: 'fa',
				franchiseId: franchiseId,
				'adds.playerId': player._id,
				timestamp: {
					$gte: new Date(year + '-01-01'),
					$lt: new Date((year + 1) + '-01-01')
				}
			});
			
			if (existing) {
				// Already have this FA pickup
				continue;
			}
			
			if (dryRun) {
				console.log('  Would create: ' + entry.playerName + ' -> ' + entry.owner);
				yearCreated++;
			} else {
				try {
					await Transaction.create({
						type: 'fa',
						franchiseId: franchiseId,
						timestamp: timestamp,
						source: 'snapshot',
						adds: [{
							playerId: player._id,
							salary: entry.salary || null,
							startYear: null,
							endYear: entry.endYear || year
						}]
					});
					yearCreated++;
				} catch (err) {
					console.log('  ✗ Error creating transaction for ' + entry.playerName + ': ' + err.message);
					totalErrors++;
				}
			}
		}
		
		totalCreated += yearCreated;
		console.log('  Created: ' + yearCreated + '\n');
	}
	
	console.log('=== Summary ===');
	console.log('Created: ' + totalCreated);
	console.log('Skipped: ' + totalSkipped);
	console.log('Errors: ' + totalErrors);
	
	// Save any new resolutions
	resolver.save();
	
	if (rl) rl.close();
	await mongoose.disconnect();
}

run().catch(function(err) {
	console.error(err);
	process.exit(1);
});
