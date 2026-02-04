/**
 * Infer cut transactions from year-over-year contract snapshot changes.
 * 
 * A cut is inferred when:
 *   - Player had a multi-year contract (endYear > snapshotYear) in year Y
 *   - In year Y+1, either:
 *     - Player has a new contract (startYear = Y+1), OR
 *     - Player is on a different owner's roster
 * 
 * This catches cuts that weren't explicitly recorded, especially pre-2010.
 * 
 * Usage:
 *   docker compose run --rm -it web node data/seed/infer-cuts.js --dry-run
 *   docker compose run --rm -it web node data/seed/infer-cuts.js --dry-run --year=2009
 *   docker compose run --rm -it web node data/seed/infer-cuts.js
 */

var dotenv = require('dotenv').config({ path: __dirname + '/../../.env' });
var mongoose = require('mongoose');
var readline = require('readline');

var Player = require('../../models/Player');
var Franchise = require('../../models/Franchise');
var Regime = require('../../models/Regime');
var Transaction = require('../../models/Transaction');
var snapshotFacts = require('../facts/snapshot-facts');
var tradeFacts = require('../facts/trade-facts');
var resolver = require('../utils/player-resolver');

mongoose.connect(process.env.MONGODB_URI);

// Trade lookup: normalized player name -> [{ year, fromOwner, toOwner }]
var playerTrades = {};

// Cut timestamps: one week before auction, 12:00:00 ET
var CUT_DATES = {
	2009: '2009-08-09',
	2010: '2010-08-15',
	2011: '2011-08-13',
	2012: '2012-08-18',
	2013: '2013-08-17'
};

// Global state
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
 * Resolve a player by name
 */
async function resolvePlayer(playerName, context, season, position, skipAmbiguous) {
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
	
	// Single non-ambiguous match
	if (candidates.length === 1 && !resolver.isAmbiguous(normalizedName)) {
		return candidates[0];
	}
	
	// Auto-create historical for early years
	if (candidates.length === 0 && season < 2016) {
		var existing = await Player.findOne({ name: playerName, sleeperId: null });
		if (existing) {
			resolver.addResolution(playerName, null, playerName, context);
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
		return player;
	}
	
	// Interactive resolution
	if (rl && !skipAmbiguous) {
		var result = await resolver.promptForPlayer({
			name: playerName,
			context: context,
			position: position,
			candidates: candidates,
			Player: Player,
			rl: rl,
			playerCache: playersByNormalizedName
		});
		
		if (result.action === 'quit') {
			return { quit: true };
		}
		return result.player || null;
	}
	
	return null;
}

/**
 * Build owner -> franchise map for a season
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
					ownerToFranchise[regime.displayName.toLowerCase()] = franchise._id;
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
 * Normalize owner name for comparison
 */
function normalizeOwner(owner) {
	if (!owner) return null;
	return owner.toLowerCase().replace(/\s+/g, '');
}

/**
 * Infer cuts by comparing year Y to year Y+1 snapshots
 */
function inferCutsForYear(yearY, yearY1) {
	var snapshotY = snapshotFacts.loadSeason(yearY);
	var snapshotY1 = snapshotFacts.loadSeason(yearY + 1);
	
	if (snapshotY.length === 0 || snapshotY1.length === 0) {
		return [];
	}
	
	// Build lookup for year Y+1: playerName (normalized) -> contract info
	var y1ByPlayer = {};
	snapshotY1.forEach(function(c) {
		var key = resolver.normalizePlayerName(c.playerName);
		if (!y1ByPlayer[key]) y1ByPlayer[key] = [];
		y1ByPlayer[key].push(c);
	});
	
	var inferredCuts = [];
	
	snapshotY.forEach(function(contractY) {
		// Only look at contracts that should continue (endYear > current year)
		if (!contractY.endYear || contractY.endYear <= yearY) {
			return;
		}
		
		if (!contractY.owner) return;
		
		var playerKey = resolver.normalizePlayerName(contractY.playerName);
		var contractsY1 = y1ByPlayer[playerKey] || [];
		
		// Check if contract continued (same owner, same start year)
		var continuedSameOwner = contractsY1.some(function(c1) {
			var sameOwner = normalizeOwner(c1.owner) === normalizeOwner(contractY.owner);
			var sameContract = c1.startYear === contractY.startYear || 
			                   c1.startYear === null || 
			                   (c1.startYear && c1.startYear < yearY + 1);
			return sameOwner && sameContract;
		});
		
		if (continuedSameOwner) {
			return; // Contract continued normally
		}
		
		// Check if player was TRADED (same contract, different owner)
		var tradedToOther = contractsY1.some(function(c1) {
			// Different owner but same original contract start year
			var differentOwner = normalizeOwner(c1.owner) !== normalizeOwner(contractY.owner);
			var sameContract = c1.startYear === contractY.startYear;
			return differentOwner && sameContract;
		});
		
		if (tradedToOther) {
			return; // Player was traded, not cut
		}
		
		// Player either: disappeared from league, or appears with a NEW contract (was cut then re-signed)
		inferredCuts.push({
			cutYear: yearY + 1,
			playerName: contractY.playerName,
			position: contractY.position,
			owner: contractY.owner,
			originalStart: contractY.startYear,
			originalEnd: contractY.endYear,
			salary: contractY.salary,
			espnId: contractY.espnId,
			// Check what happened to player in Y+1
			newContract: contractsY1.length > 0 ? contractsY1[0] : null
		});
	});
	
	return inferredCuts;
}

/**
 * Get cut timestamp for a year
 */
function getCutTimestamp(year) {
	var dateStr = CUT_DATES[year];
	if (!dateStr) {
		// Default: 7 days before mid-August
		dateStr = year + '-08-15';
	}
	// 12:00:00 ET = 16:00:00 UTC (during DST)
	return new Date(dateStr + 'T16:00:00.000Z');
}

/**
 * Build a lookup of player trades by year.
 * Used to skip inference when a player was traded (new owner is responsible for cut).
 * Uses player-resolver to handle name variations.
 */
function buildTradeLookup() {
	if (!tradeFacts.checkAvailability()) {
		console.log('Warning: Trade facts not available, cannot filter traded players');
		return;
	}
	
	var trades = tradeFacts.loadAll();
	
	trades.forEach(function(trade) {
		var tradeYear = new Date(trade.date).getFullYear();
		
		trade.parties.forEach(function(party) {
			var toOwner = party.owner;
			
			party.players.forEach(function(player) {
				var name = player.name || player.playerName;
				if (!name) return;
				
				// Use player-resolver to get the canonical name
				var context = { year: tradeYear, type: 'trade' };
				var resolution = resolver.lookup(name, context);
				
				// Add entry for both the normalized name and any resolved name
				var keys = [resolver.normalizePlayerName(name)];
				if (resolution && resolution.name) {
					keys.push(resolver.normalizePlayerName(resolution.name));
				}
				
				keys.forEach(function(key) {
					if (!playerTrades[key]) playerTrades[key] = [];
					
					// Avoid duplicates
					var exists = playerTrades[key].some(function(t) {
						return t.tradeId === trade.tradeId;
					});
					
					if (!exists) {
						playerTrades[key].push({
							year: tradeYear,
							toOwner: toOwner.toLowerCase(),
							tradeId: trade.tradeId
						});
					}
				});
			});
		});
	});
}

/**
 * Check if a player was traded away from an owner during or after a given year.
 * If so, the new owner (not the original) would be responsible for cutting them.
 * Uses player-resolver to handle name variations.
 */
function wasPlayerTradedFrom(playerName, fromOwner, year) {
	// Try both the normalized name and the resolved name
	var context = { year: year, type: 'cut' };
	var resolution = resolver.lookup(playerName, context);
	
	var keys = [resolver.normalizePlayerName(playerName)];
	if (resolution && resolution.name) {
		keys.push(resolver.normalizePlayerName(resolution.name));
	}
	
	for (var i = 0; i < keys.length; i++) {
		var trades = playerTrades[keys[i]] || [];
		
		var traded = trades.some(function(t) {
			// Trade happened in the year we're looking at
			// and the player went TO someone other than fromOwner
			return (t.year === year || t.year === year - 1) && 
			       t.toOwner !== fromOwner.toLowerCase();
		});
		
		if (traded) return true;
	}
	
	return false;
}

/**
 * Build a lookup of existing cuts from cuts.json
 * Key: normalized player name + '|' + cutYear + '|' + franchiseId
 * Uses player-resolver to handle name variations.
 */
function buildExistingCutsLookup() {
	var cutsJson = require('../cuts/cuts.json');
	var lookup = {};
	
	cutsJson.forEach(function(cut) {
		if (!cut.name || !cut.cutYear || !cut.franchiseId) return;
		
		// Get all name variations via resolver
		var context = { year: cut.cutYear, type: 'cut' };
		var resolution = resolver.lookup(cut.name, context);
		
		var names = [cut.name];
		if (resolution && resolution.name && resolution.name !== cut.name) {
			names.push(resolution.name);
		}
		
		names.forEach(function(name) {
			var key = resolver.normalizePlayerName(name) + '|' + cut.cutYear + '|' + cut.franchiseId;
			lookup[key] = cut;
			
			// Also add key for cutYear+1 to catch year-to-year inference off-by-one
			var keyNextYear = resolver.normalizePlayerName(name) + '|' + (cut.cutYear + 1) + '|' + cut.franchiseId;
			if (!lookup[keyNextYear]) {
				lookup[keyNextYear] = cut;
			}
		});
	});
	
	return lookup;
}

async function run() {
	var args = process.argv.slice(2);
	var dryRun = args.includes('--dry-run');
	var skipAmbiguous = args.includes('--skip-ambiguous');
	var yearArg = args.find(function(a) { return a.startsWith('--year='); });
	var targetYear = yearArg ? parseInt(yearArg.split('=')[1]) : null;
	
	console.log('=== Infer Cuts from Snapshots ===\n');
	if (dryRun) console.log('DRY RUN MODE\n');
	if (skipAmbiguous) console.log('SKIP AMBIGUOUS MODE\n');
	
	var playerCount = await buildPlayerCache();
	console.log('Loaded ' + playerCount + ' players');
	console.log('Loaded ' + resolver.count() + ' cached resolutions\n');
	
	// Build lookup from cuts.json for deduplication
	var existingCutsLookup = buildExistingCutsLookup();
	console.log('Loaded ' + Object.keys(existingCutsLookup).length + ' existing cuts from cuts.json');
	
	// Build trade lookup to skip players who were traded
	buildTradeLookup();
	console.log('Loaded ' + Object.keys(playerTrades).length + ' players with trade history\n');
	
	if (!skipAmbiguous) {
		rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout
		});
	}
	
	var regimes = await Regime.find({}).lean();
	var franchises = await Franchise.find({}).lean();
	
	// Determine years to process
	var years = targetYear ? [targetYear] : [2009, 2010, 2011, 2012, 2013];
	
	var totalCreated = 0;
	var totalSkipped = 0;
	var totalExisting = 0;
	var userQuit = false;
	
	for (var i = 0; i < years.length; i++) {
		if (userQuit) break;
		
		var cutYear = years[i];
		var priorYear = cutYear - 1;
		
		console.log('--- Inferring cuts for ' + cutYear + ' (comparing ' + priorYear + ' to ' + cutYear + ') ---');
		
		var inferredCuts = inferCutsForYear(priorYear, cutYear);
		console.log('Found ' + inferredCuts.length + ' potential cuts\n');
		
		var ownerMap = buildOwnerMap(regimes, franchises, priorYear);
		var timestamp = getCutTimestamp(cutYear);
		
		for (var j = 0; j < inferredCuts.length; j++) {
			if (userQuit) break;
			
			var cut = inferredCuts[j];
			
			// Resolve player
			var context = { year: cutYear, type: 'cut', franchise: cut.owner };
			var player = await resolvePlayer(cut.playerName, context, cutYear, cut.position, skipAmbiguous);
			
			if (player && player.quit) {
				console.log('\nQuitting...');
				resolver.save();
				if (rl) rl.close();
				await mongoose.disconnect();
				process.exit(130); // 130 = interrupted by Ctrl+C convention
			}
			
			if (!player) {
				console.log('  ✗ Could not resolve: ' + cut.playerName);
				totalSkipped++;
				continue;
			}
			
			// Get franchise
			var franchiseId = ownerMap[cut.owner.toLowerCase()];
			if (!franchiseId) {
				console.log('  ✗ Could not find franchise for: ' + cut.owner);
				totalSkipped++;
				continue;
			}
			
			// Check if player was traded away from this owner
			if (wasPlayerTradedFrom(cut.playerName, cut.owner, cutYear)) {
				if (dryRun) {
					console.log('  Traded: ' + cut.playerName + ' (' + cut.owner + ') - skipping');
				}
				totalSkipped++;
				continue;
			}
			
			// Check for existing cut in cuts.json (by player name + year + franchise)
			// Try both the original name and any resolved name
			var context = { year: cutYear, type: 'cut', franchise: cut.owner };
			var resolution = resolver.lookup(cut.playerName, context);
			
			var namesToCheck = [cut.playerName];
			if (resolution && resolution.name && resolution.name !== cut.playerName) {
				namesToCheck.push(resolution.name);
			}
			
			var existingCut = null;
			for (var k = 0; k < namesToCheck.length; k++) {
				var cutKey = resolver.normalizePlayerName(namesToCheck[k]) + '|' + cutYear + '|' + franchiseId.toString();
				if (existingCutsLookup[cutKey]) {
					existingCut = existingCutsLookup[cutKey];
					break;
				}
			}
			
			if (existingCut) {
				if (dryRun) {
					console.log('  Already exists: ' + cut.playerName + ' (' + cut.owner + ') - cut in ' + existingCut.cutYear);
				}
				totalExisting++;
				continue;
			}
			
			var newOwner = cut.newContract ? cut.newContract.owner : 'FA';
			
			if (dryRun) {
				console.log('  Would create cut: ' + cut.playerName + ' (' + cut.owner + ' -> ' + newOwner + ')');
				console.log('    Contract was ' + cut.originalStart + '/' + cut.originalEnd + ' $' + cut.salary);
				totalCreated++;
			} else {
				try {
					await Transaction.create({
						type: 'fa',
						franchiseId: franchiseId,
						timestamp: timestamp,
						source: 'snapshot',  // Use 'snapshot' since this is inferred from snapshot data
						adds: [],
						drops: [{
							playerId: player._id,
							salary: cut.salary,
							startYear: cut.originalStart,
							endYear: cut.originalEnd
						}]
					});
					console.log('  + Cut: ' + cut.playerName + ' by ' + cut.owner);
					totalCreated++;
				} catch (err) {
					console.log('  ✗ Error: ' + err.message);
					totalSkipped++;
				}
			}
		}
		
		console.log('');
	}
	
	console.log('=== Summary ===');
	console.log('Created: ' + totalCreated);
	console.log('Skipped: ' + totalSkipped);
	console.log('Already existed: ' + totalExisting);
	
	resolver.save();
	if (rl) rl.close();
	await mongoose.disconnect();
}

run().catch(function(err) {
	console.error(err);
	process.exit(1);
});
