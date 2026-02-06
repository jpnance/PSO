/**
 * Seed contract expiry transactions from historical data.
 * 
 * Contract expiry rules (2019+ only):
 *   - 1-year contracts and FA contracts do NOT convey RFA rights
 *   - These contracts simply expire, player becomes UFA
 * 
 * Pre-2019: All contracts conveyed RFA rights, so no contract-expiry needed.
 * 
 * Data sources:
 *   - postseason-YEAR.txt: End-of-season roster snapshots
 * 
 * Usage:
 *   docker compose run --rm -it web node data/seed/contract-expiry.js
 *   docker compose run --rm -it web node data/seed/contract-expiry.js --year=2024
 *   docker compose run --rm -it web node data/seed/contract-expiry.js --dry-run
 */

var dotenv = require('dotenv').config({ path: __dirname + '/../../.env' });
var mongoose = require('mongoose');
var fs = require('fs');
var path = require('path');
var readline = require('readline');

var Franchise = require('../../models/Franchise');
var Player = require('../../models/Player');
var Transaction = require('../../models/Transaction');
var PSO = require('../../config/pso.js');
var resolver = require('../utils/player-resolver');

mongoose.connect(process.env.MONGODB_URI);

var ARCHIVE_DIR = path.join(__dirname, '../archive/snapshots');

// Contract expiry date convention: January 15 at 12:00:01 PM ET
// Same day as RFA conversion but 1 second later for ordering
function getContractExpiryTimestamp(year) {
	// Jan 15 at 12:00:01 ET = Jan 15 at 17:00:01 UTC
	return new Date(Date.UTC(year + 1, 0, 15, 17, 0, 1));
}

// Build owner -> franchiseId lookup for a given year
var ownerToFranchiseByYear = {};

Object.keys(PSO.franchiseNames).forEach(function(rosterId) {
	var yearMap = PSO.franchiseNames[rosterId];
	Object.keys(yearMap).forEach(function(year) {
		var ownerName = yearMap[year];
		if (!ownerToFranchiseByYear[year]) {
			ownerToFranchiseByYear[year] = {};
		}
		ownerToFranchiseByYear[year][ownerName] = parseInt(rosterId);
	});
});

function getRosterId(ownerName, season) {
	if (!ownerName) return null;
	
	var yearMap = ownerToFranchiseByYear[season];
	if (!yearMap) return null;
	
	// Direct match
	if (yearMap[ownerName]) return yearMap[ownerName];
	
	// Try partial match
	var owners = Object.keys(yearMap);
	for (var i = 0; i < owners.length; i++) {
		if (owners[i].indexOf(ownerName) >= 0 || ownerName.indexOf(owners[i]) >= 0) {
			return yearMap[owners[i]];
		}
	}
	
	return null;
}

/**
 * Check if a contract expires without RFA rights (becomes UFA).
 * Only applies to 2019+ seasons.
 */
function expiresWithoutRfa(startYear, endYear, season) {
	// Must have valid endYear matching the season
	if (!endYear || isNaN(endYear) || endYear !== season) return false;
	
	// Pre-2019: All contracts had RFA rights
	if (season < 2019) return false;
	
	// Calculate contract length
	var contractLength = (startYear && !isNaN(startYear) && endYear) ? (endYear - startYear + 1) : 1;
	
	// 2019+: 2-3 year contracts get RFA; 1-year and 4+ year do not
	// FA contracts (no startYear) also do not get RFA
	return contractLength < 2 || contractLength > 3;
}

/**
 * Parse a contracts/postseason file.
 */
function parseContractsFile(filePath) {
	if (!fs.existsSync(filePath)) {
		return null;
	}
	
	var content = fs.readFileSync(filePath, 'utf8');
	var lines = content.split('\n');
	var contracts = [];
	
	for (var i = 1; i < lines.length; i++) {
		var line = lines[i].trim();
		if (!line) continue;
		
		var parts = line.split(',');
		if (parts.length < 7) continue;
		
		var owner = parts[1].trim();
		var name = parts[2].trim();
		var position = parts[3].trim();
		var startStr = parts[4].trim();
		var endStr = parts[5].trim();
		var salaryStr = parts[6].trim();
		
		// Skip unowned players
		if (!owner) continue;
		
		var startYear = startStr ? parseInt(startStr, 10) : null;
		var endYear = endStr ? parseInt(endStr, 10) : null;
		var salary = salaryStr ? parseInt(salaryStr.replace('$', ''), 10) : null;
		
		if (isNaN(startYear)) startYear = null;
		if (isNaN(endYear)) endYear = null;
		if (isNaN(salary)) salary = null;
		
		contracts.push({
			owner: owner,
			name: name,
			position: position,
			startYear: startYear,
			endYear: endYear,
			salary: salary
		});
	}
	
	return contracts;
}

/**
 * Find contracts that expire without RFA rights.
 */
function findExpiringWithoutRfa(contracts, season) {
	var expiring = [];
	
	for (var i = 0; i < contracts.length; i++) {
		var c = contracts[i];
		if (expiresWithoutRfa(c.startYear, c.endYear, season)) {
			expiring.push(c);
		}
	}
	
	return expiring;
}

// Global state
var rl = null;
var playersByNormalizedName = {};
var franchiseByRosterId = {};

/**
 * Resolve a player using the unified prompt system.
 */
async function resolvePlayer(contract, season) {
	var context = {
		year: season,
		type: 'contract-expiry',
		franchise: contract.owner
	};
	
	var normalizedName = resolver.normalizePlayerName(contract.name);
	var candidates = playersByNormalizedName[normalizedName] || [];
	
	// Check cache first
	var cached = resolver.lookup(contract.name, context);
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
	
	// Need interactive resolution
	if (candidates.length !== 1 || resolver.isAmbiguous(normalizedName)) {
		var result = await resolver.promptForPlayer({
			name: contract.name,
			context: context,
			candidates: candidates,
			position: contract.position,
			Player: Player,
			rl: rl,
			playerCache: playersByNormalizedName
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
 * Parse command line arguments.
 */
function parseArgs() {
	var args = {
		dryRun: process.argv.includes('--dry-run'),
		clear: process.argv.includes('--clear'),
		year: null
	};
	
	var yearArg = process.argv.find(function(a) { return a.startsWith('--year='); });
	if (yearArg) {
		args.year = parseInt(yearArg.split('=')[1], 10);
	}
	
	return args;
}

/**
 * Main run function.
 */
async function run() {
	var args = parseArgs();
	
	console.log('Seeding contract expiry transactions (non-RFA)');
	if (args.year) {
		console.log('Year:', args.year);
	} else {
		console.log('Years: 2019 - 2024 (rule only applies 2019+)');
	}
	if (args.dryRun) console.log('[DRY RUN]');
	console.log('');
	
	// Load player resolutions
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
	console.log('');
	
	// Clear existing if requested
	if (args.clear && !args.dryRun) {
		console.log('Clearing existing contract-expiry transactions...');
		var query = { type: 'contract-expiry' };
		if (args.year) {
			var yearStart = getContractExpiryTimestamp(args.year - 1);
			var yearEnd = getContractExpiryTimestamp(args.year);
			query.timestamp = { $gt: yearStart, $lte: yearEnd };
		}
		var deleted = await Transaction.deleteMany(query);
		console.log('  Deleted', deleted.deletedCount, 'transactions');
		console.log('');
	}
	
	// Determine years to process (only 2019+)
	var startYear = args.year || 2019;
	var endYear = args.year || 2024;
	
	// Enforce 2019+ rule
	if (startYear < 2019) startYear = 2019;
	
	var stats = {
		created: 0,
		skipped: 0,
		errors: []
	};
	
	for (var season = startYear; season <= endYear; season++) {
		console.log('=== Season', season, '===');
		
		var postseasonPath = path.join(ARCHIVE_DIR, 'postseason-' + season + '.txt');
		var contracts = parseContractsFile(postseasonPath);
		
		if (!contracts) {
			console.log('  No postseason file found, skipping');
			continue;
		}
		
		console.log('  Using postseason-' + season + '.txt');
		
		// Find expiring contracts without RFA
		var expiring = findExpiringWithoutRfa(contracts, season);
		console.log('  Found', expiring.length, 'contracts expiring without RFA');
		
		if (expiring.length === 0) continue;
		
		var timestamp = getContractExpiryTimestamp(season);
		var createdThisSeason = 0;
		
		for (var i = 0; i < expiring.length; i++) {
			var contract = expiring[i];
			
			// Resolve franchise
			var rosterId = getRosterId(contract.owner, season);
			if (!rosterId) {
				stats.errors.push(season + ': Unknown owner "' + contract.owner + '" for ' + contract.name);
				continue;
			}
			
			var franchiseId = franchiseByRosterId[rosterId];
			if (!franchiseId) {
				stats.errors.push(season + ': No franchise for rosterId ' + rosterId);
				continue;
			}
			
			// Resolve player
			var resolution;
			try {
				resolution = await resolvePlayer(contract, season);
			} catch (err) {
				if (err.message === 'User quit') {
					console.log('\nQuitting...');
					break;
				}
				throw err;
			}
			
			if (!resolution.playerId) {
				stats.errors.push(season + ': Could not resolve player "' + contract.name + '"');
				continue;
			}
			
			// Check for existing transaction
			var existing = await Transaction.findOne({
				type: 'contract-expiry',
				playerId: resolution.playerId,
				timestamp: timestamp
			});
			
			if (existing) {
				stats.skipped++;
				continue;
			}
			
			// Create transaction
			if (!args.dryRun) {
				var txData = {
					type: 'contract-expiry',
					timestamp: timestamp,
					source: 'snapshot',
					franchiseId: franchiseId,
					playerId: resolution.playerId
				};
				
				if (contract.salary && !isNaN(contract.salary)) {
					txData.salary = contract.salary;
				}
				if (contract.startYear && !isNaN(contract.startYear)) {
					txData.startYear = contract.startYear;
				}
				if (contract.endYear && !isNaN(contract.endYear)) {
					txData.endYear = contract.endYear;
				}
				
				await Transaction.create(txData);
			}
			
			stats.created++;
			createdThisSeason++;
		}
		
		console.log('  Created:', createdThisSeason);
	}
	
	// Save resolutions
	resolver.save();
	
	console.log('\nDone!');
	console.log('  Created:', stats.created);
	console.log('  Skipped (existing):', stats.skipped);
	
	if (stats.errors.length > 0) {
		console.log('\nErrors (first 20):');
		stats.errors.slice(0, 20).forEach(function(e) {
			console.log('  -', e);
		});
		if (stats.errors.length > 20) {
			console.log('  ... and', stats.errors.length - 20, 'more');
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
