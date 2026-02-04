/**
 * Seed FA Pickups from Snapshot Differences
 * 
 * For 2014-2019, compares contracts-YYYY.txt (post-auction state) to
 * postseason-YYYY.txt (end-of-season state) to find FA acquisitions.
 * 
 * A player is inferred as an FA pickup if:
 *   1. They appear in postseason with an owner and startYear=null (FA contract)
 *   2. They weren't on that owner's roster in the pre-season snapshot
 *   3. They weren't acquired via trade during the season
 * 
 * Usage:
 *   node data/seed/fa-snapshot.js [--clear] [--dry-run] [--year=YYYY]
 */

var mongoose = require('mongoose');
var Player = require('../../models/Player');
var Franchise = require('../../models/Franchise');
var Transaction = require('../../models/Transaction');
var Regime = require('../../models/Regime');
var snapshotFacts = require('../facts/snapshot-facts');
var tradeFacts = require('../facts/trade-facts');
var resolver = require('../utils/player-resolver');

var readline = require('readline');

var FIRST_YEAR = 2014;
var LAST_YEAR = 2019;

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
}

/**
 * Resolve a player by name, auto-creating historical players if needed
 */
async function resolvePlayer(playerName, context, season, position) {
	var normalizedName = resolver.normalizePlayerName(playerName);
	var candidates = playersByNormalizedName[normalizedName] || [];
	
	// Check cache
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
			return c.positions.includes(position);
		});
		if (posFiltered.length > 0) {
			filteredCandidates = posFiltered;
		}
	}
	
	// Single non-ambiguous match after position filtering
	if (filteredCandidates.length === 1 && !resolver.isAmbiguous(normalizedName)) {
		return filteredCandidates[0];
	}
	
	// Auto-create for historical years (before 2016)
	if (candidates.length === 0 && season < 2016) {
		var existing = await Player.findOne({ name: playerName, sleeperId: null });
		if (existing) {
			resolver.addResolution(playerName, null, playerName, context);
			resolver.save();
			return existing;
		}
		
		console.log('    Auto-creating historical: ' + playerName);
		var player = await Player.create({
			name: playerName,
			positions: position ? [position] : [],
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
 * Get Labor Day for a given year (first Monday of September)
 */
function getLaborDay(year) {
	var sept1 = new Date(year, 8, 1);
	var dayOfWeek = sept1.getDay();
	var daysToMonday = dayOfWeek === 0 ? 1 : (dayOfWeek === 1 ? 0 : 8 - dayOfWeek);
	return new Date(year, 8, 1 + daysToMonday);
}

/**
 * Get first Thursday after Labor Day
 */
function getFirstThursdayAfterLaborDay(year) {
	var laborDay = getLaborDay(year);
	var daysToThursday = (4 - laborDay.getDay() + 7) % 7 || 7;
	return new Date(year, 8, laborDay.getDate() + daysToThursday);
}

/**
 * Get conventional FA timestamp: first Thursday after Labor Day, 12:00:33 ET
 * 
 * September is during DST, so ET = UTC-4
 */
function getConventionalFaTimestamp(year) {
	var firstThursday = getFirstThursdayAfterLaborDay(year);
	return new Date(Date.UTC(
		firstThursday.getFullYear(),
		firstThursday.getMonth(),
		firstThursday.getDate(),
		16, 0, 33  // 12:00:33 ET during DST = 16:00:33 UTC
	));
}

/**
 * Normalize owner name for comparison
 */
function normalizeOwner(owner) {
	if (!owner) return null;
	return owner.toLowerCase().replace(/\s+/g, '');
}

/**
 * Build a set of players traded to each owner during a season
 */
function getTradedInPlayers(trades, season) {
	var tradedIn = {};
	
	trades.forEach(function(trade) {
		var tradeYear = trade.date.getFullYear();
		if (tradeYear !== season) return;
		
		trade.parties.forEach(function(party) {
			var owner = party.owner;
			if (!owner) return;
			
			party.players.forEach(function(player) {
				var key = normalizeOwner(owner);
				if (!tradedIn[key]) tradedIn[key] = new Set();
				tradedIn[key].add(player.name.toLowerCase());
			});
		});
	});
	
	return tradedIn;
}

/**
 * Build a map of owner name -> franchise ID for a given season
 * Uses the regime that was in charge of each franchise that season
 */
function buildOwnerMap(regimes, franchises, season) {
	var ownerToFranchise = {};
	
	// For each franchise, find who owned it in this season
	franchises.forEach(function(franchise) {
		// Find the regime with a tenure for this franchise in this season
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
 * Get franchise ID for an owner name in a given season
 */
function getFranchiseId(ownerName, ownerMap) {
	if (!ownerName) return null;
	return ownerMap[ownerName.toLowerCase()] || null;
}

/**
 * Infer FA pickups for a single season
 */
function inferFaPickups(season, allTrades) {
	var preseason = snapshotFacts.loadSeason(season);
	var postseason = snapshotFacts.loadPostseason(season);
	
	if (postseason.length === 0) {
		return [];
	}
	
	// Build pre-season roster map: owner -> Set of player names
	var preseasonRosters = {};
	preseason.forEach(function(c) {
		if (!c.owner) return;
		var ownerKey = normalizeOwner(c.owner);
		if (!preseasonRosters[ownerKey]) preseasonRosters[ownerKey] = new Set();
		preseasonRosters[ownerKey].add(c.playerName.toLowerCase());
	});
	
	// Get players traded in during the season
	var tradedIn = getTradedInPlayers(allTrades, season);
	
	// Find FA pickups in postseason
	var faPickups = [];
	
	postseason.forEach(function(c) {
		// Must have owner and be an FA contract (startYear = null)
		if (!c.owner || c.startYear !== null) return;
		
		var ownerKey = normalizeOwner(c.owner);
		var playerKey = c.playerName.toLowerCase();
		
		// Check if player was already on this owner's pre-season roster
		if (preseasonRosters[ownerKey] && preseasonRosters[ownerKey].has(playerKey)) {
			return;
		}
		
		// Check if player was traded in
		if (tradedIn[ownerKey] && tradedIn[ownerKey].has(playerKey)) {
			return;
		}
		
		faPickups.push({
			season: season,
			owner: c.owner,
			playerName: c.playerName,
			position: c.position,
			salary: c.salary,
			endYear: c.endYear,
			espnId: c.espnId
		});
	});
	
	return faPickups;
}

async function run() {
	var args = process.argv.slice(2);
	var dryRun = args.includes('--dry-run');
	var clearFirst = args.includes('--clear');
	var yearArg = args.find(function(a) { return a.startsWith('--year='); });
	var targetYear = yearArg ? parseInt(yearArg.split('=')[1]) : null;
	
	if (dryRun) {
		console.log('=== DRY RUN MODE ===\n');
	}
	
	await mongoose.connect(process.env.MONGODB_URI || 'mongodb://mongo:27017/pso');
	
	// Build player cache
	await buildPlayerCache();
	console.log('Loaded ' + resolver.count() + ' cached player resolutions');
	
	// Set up readline for interactive resolution
	rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout
	});
	
	// Load regimes and franchises for owner -> franchise mapping
	var regimes = await Regime.find({}).lean();
	var franchises = await Franchise.find({}).lean();
	
	// Load all trades once
	var allTrades = tradeFacts.loadAll();
	
	var startYear = targetYear || FIRST_YEAR;
	var endYear = targetYear || LAST_YEAR;
	
	// Clear existing snapshot-sourced FA transactions if requested
	if (clearFirst && !dryRun) {
		var clearQuery = {
			type: 'fa',
			source: 'snapshot',
			timestamp: {
				$gte: new Date(startYear + '-01-01'),
				$lt: new Date((endYear + 1) + '-01-01')
			}
		};
		var deleted = await Transaction.deleteMany(clearQuery);
		console.log('Cleared ' + deleted.deletedCount + ' existing snapshot FA transactions\n');
	}
	
	var totalCreated = 0;
	var totalSkipped = 0;
	var totalErrors = 0;
	var userQuit = false;
	
	for (var year = startYear; year <= endYear; year++) {
		if (userQuit) break;
		var pickups = inferFaPickups(year, allTrades);
		
		if (pickups.length === 0) {
			console.log(year + ': No postseason data or no FA pickups');
			continue;
		}
		
		console.log(year + ': ' + pickups.length + ' FA pickups inferred');
		
		// Build owner -> franchise map for this season
		var ownerMap = buildOwnerMap(regimes, franchises, year);
		
		var timestamp = getConventionalFaTimestamp(year);
		var yearCreated = 0;
		
		for (var i = 0; i < pickups.length; i++) {
			var pickup = pickups[i];
			
			// Resolve player
			var context = { year: year, type: 'fa', franchise: pickup.owner };
			var player = await resolvePlayer(pickup.playerName, context, year, pickup.position);
			
			// User requested quit
			if (player && player.quit) {
				console.log('\nUser quit. Saving progress...');
				userQuit = true;
				break;
			}
			
			if (!player) {
				console.log('  ✗ Could not resolve: ' + pickup.playerName);
				totalSkipped++;
				continue;
			}
			
			// Get franchise
			var franchiseId = getFranchiseId(pickup.owner, ownerMap);
			if (!franchiseId) {
				console.log('  ✗ Could not find franchise for: ' + pickup.owner + ' in ' + year);
				totalErrors++;
				continue;
			}
			
			if (dryRun) {
				console.log('  Would create: ' + pickup.playerName + ' -> ' + pickup.owner);
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
							salary: pickup.salary || null,
							startYear: null,
							endYear: pickup.endYear || year
						}]
					});
					yearCreated++;
				} catch (err) {
					console.log('  ✗ Error creating transaction for ' + pickup.playerName + ': ' + err.message);
					totalErrors++;
				}
			}
		}
		
		totalCreated += yearCreated;
		console.log('  Created: ' + yearCreated);
	}
	
	console.log('\n=== Summary ===');
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
