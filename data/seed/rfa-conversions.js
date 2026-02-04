/**
 * Seed RFA rights conversion transactions from historical data.
 * 
 * RFA eligibility rules:
 *   - 2008-2018: Any expiring contract conveys RFA rights
 *   - 2019+: Only 2-3 year contracts convey RFA rights
 * 
 * Data sources:
 *   - postseason-YEAR.txt (2014+): End-of-season roster snapshots
 *   - contracts-YEAR.txt + cuts/trades (pre-2014): Infer from absence of release
 * 
 * Usage:
 *   docker compose run --rm -it web node data/seed/rfa-conversions.js
 *   docker compose run --rm -it web node data/seed/rfa-conversions.js --year=2024
 *   docker compose run --rm -it web node data/seed/rfa-conversions.js --dry-run
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

// RFA conversion date convention: January 15 at 12:00:33 PM ET
// The :33 seconds indicates imprecise timing
// January 15 is definitively in the offseason
function getRfaConversionTimestamp(year) {
	// Jan 15 at 12:00:33 ET = Jan 15 at 17:00:33 UTC (EST, no DST in Jan)
	return new Date(Date.UTC(year + 1, 0, 15, 17, 0, 33));
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
 * Check if a contract qualifies for RFA rights conversion.
 */
function qualifiesForRfa(startYear, endYear, season) {
	// Must have valid endYear matching the season
	if (!endYear || isNaN(endYear) || endYear !== season) return false;
	
	// Calculate contract length
	var contractLength = (startYear && !isNaN(startYear) && endYear) ? (endYear - startYear + 1) : 1;
	
	if (season <= 2018) {
		// 2008-2018: Any expiring contract
		return true;
	} else {
		// 2019+: Only 2-3 year contracts
		return contractLength >= 2 && contractLength <= 3;
	}
}

/**
 * Parse a contracts/postseason file.
 * Returns array of { owner, name, position, startYear, endYear, salary }
 */
function parseContractsFile(filePath) {
	if (!fs.existsSync(filePath)) {
		return null;
	}
	
	var content = fs.readFileSync(filePath, 'utf8');
	var lines = content.split('\n');
	var contracts = [];
	
	for (var i = 1; i < lines.length; i++) {  // Skip header
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
		
		// Skip unowned players (free agents in the pool)
		if (!owner) continue;
		
		var startYear = startStr ? parseInt(startStr, 10) : null;
		var endYear = endStr ? parseInt(endStr, 10) : null;
		var salary = salaryStr ? parseInt(salaryStr.replace('$', ''), 10) : null;
		
		// Convert NaN to null
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
 * Find RFA-eligible contracts from a postseason file.
 */
function findRfaEligible(contracts, season) {
	var eligible = [];
	
	for (var i = 0; i < contracts.length; i++) {
		var c = contracts[i];
		if (qualifiesForRfa(c.startYear, c.endYear, season)) {
			eligible.push(c);
		}
	}
	
	return eligible;
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
		type: 'rfa-conversion',
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
			playerCache: playersByNormalizedName,
			autoHistorical: season < 2016
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
	
	console.log('Seeding RFA rights conversion transactions');
	if (args.year) {
		console.log('Year:', args.year);
	} else {
		console.log('Years: 2008 - 2024');
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
		console.log('Clearing existing RFA conversion transactions...');
		var query = { type: 'rfa-rights-conversion' };
		if (args.year) {
			var yearStart = getRfaConversionTimestamp(args.year - 1);
			var yearEnd = getRfaConversionTimestamp(args.year);
			query.timestamp = { $gt: yearStart, $lte: yearEnd };
		}
		var deleted = await Transaction.deleteMany(query);
		console.log('  Deleted', deleted.deletedCount, 'transactions');
		console.log('');
	}
	
	// Determine years to process
	var startYear = args.year || 2008;
	var endYear = args.year || 2024;  // Last completed season
	
	var stats = {
		created: 0,
		skipped: 0,
		errors: []
	};
	
	for (var season = startYear; season <= endYear; season++) {
		console.log('=== Season', season, '===');
		
		// Try postseason file first, then contracts file
		var postseasonPath = path.join(ARCHIVE_DIR, 'postseason-' + season + '.txt');
		var contractsPath = path.join(ARCHIVE_DIR, 'contracts-' + season + '.txt');
		
		var contracts = parseContractsFile(postseasonPath);
		var source = 'postseason';
		
		if (!contracts) {
			contracts = parseContractsFile(contractsPath);
			source = 'contracts';
		}
		
		if (!contracts) {
			console.log('  No data file found, skipping');
			continue;
		}
		
		console.log('  Using', source + '-' + season + '.txt');
		
		// Find RFA-eligible contracts
		var eligible = findRfaEligible(contracts, season);
		console.log('  Found', eligible.length, 'RFA-eligible expiring contracts');
		
		if (eligible.length === 0) continue;
		
		var timestamp = getRfaConversionTimestamp(season);
		
		for (var i = 0; i < eligible.length; i++) {
			var contract = eligible[i];
			
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
				type: 'rfa-rights-conversion',
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
					type: 'rfa-rights-conversion',
					timestamp: timestamp,
					source: 'snapshot',
					franchiseId: franchiseId,
					playerId: resolution.playerId
				};
				
				// Only include numeric values (avoid NaN)
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
		}
		
		console.log('  Created:', stats.created, '(this season)');
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
