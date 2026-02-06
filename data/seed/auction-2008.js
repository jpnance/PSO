/**
 * Seed 2008 initial auction transactions.
 * 
 * This is the founding auction - all players start from available state.
 * No RFA rights exist yet, so all acquisitions are auction-ufa.
 * 
 * Usage:
 *   docker compose run --rm -it web node data/seed/auction-2008.js
 *   docker compose run --rm -it web node data/seed/auction-2008.js --dry-run
 */

var dotenv = require('dotenv').config({ path: __dirname + '/../../.env' });
var mongoose = require('mongoose');
var fs = require('fs');
var path = require('path');
var readline = require('readline');

var Franchise = require('../../models/Franchise');
var Player = require('../../models/Player');
var Regime = require('../../models/Regime');
var Transaction = require('../../models/Transaction');
var PSO = require('../../config/pso.js');
var resolver = require('../utils/player-resolver');
var RosterState = require('../utils/roster-state');

mongoose.connect(process.env.MONGODB_URI);

// Roster state tracker - builds up as we process
var rosterState = new RosterState();

// 2008 auction was August 18, 2008
// Auction timestamp: 9:00 AM ET = 13:00 UTC (EDT, UTC-4)
var AUCTION_TIMESTAMP = new Date(Date.UTC(2008, 7, 18, 13, 0, 0));

// Contract due date was August 24, 2008
// Contract timestamp: 12:00 PM ET = 16:00 UTC (EDT, UTC-4)
var CONTRACT_TIMESTAMP = new Date(Date.UTC(2008, 7, 24, 16, 0, 0));

var SNAPSHOT_PATH = path.join(__dirname, '../archive/snapshots/contracts-2008.txt');

// Global state
var rl = null;
var playersByNormalizedName = {};
var franchiseByOwnerName = {};
var dryRun = false;

/**
 * Parse the 2008 snapshot CSV.
 * Format: ID,Owner,Name,Position,Start,End,Salary
 */
function loadSnapshot() {
	var content = fs.readFileSync(SNAPSHOT_PATH, 'utf8');
	var lines = content.trim().split('\n');
	var results = [];
	
	for (var i = 1; i < lines.length; i++) { // Skip header
		var line = lines[i];
		var parts = parseCSVLine(line);
		if (parts.length < 7) continue;
		
		results.push({
			espnId: parts[0],
			owner: parts[1],
			name: parts[2],
			position: parts[3],
			startYear: parseInt(parts[4]) || 2008,
			endYear: parseInt(parts[5]) || 2008,
			salary: parseInt(parts[6].replace('$', '')) || 0
		});
	}
	
	return results;
}

/**
 * Parse a CSV line handling quoted fields.
 */
function parseCSVLine(line) {
	var result = [];
	var current = '';
	var inQuotes = false;
	
	for (var i = 0; i < line.length; i++) {
		var char = line[i];
		if (char === '"') {
			inQuotes = !inQuotes;
		} else if (char === ',' && !inQuotes) {
			result.push(current.trim());
			current = '';
		} else {
			current += char;
		}
	}
	result.push(current.trim());
	return result;
}

/**
 * Resolve a player to a database Player document.
 * Uses the resolver with position hints, creates historical players if needed.
 */
async function resolvePlayer(entry) {
	var context = {
		year: 2008,
		type: 'auction',
		franchise: entry.owner,
		position: entry.position
	};
	
	var normalizedName = resolver.normalizePlayerName(entry.name);
	var candidates = playersByNormalizedName[normalizedName] || [];
	
	// Check cache first
	var cached = resolver.lookup(entry.name, context);
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
	
	// Filter by position if we have multiple candidates
	if (candidates.length > 1 && entry.position) {
		var positionFiltered = candidates.filter(function(c) {
			return c.positions && c.positions.some(function(p) {
				return p === entry.position || 
					(entry.position === 'DL' && (p === 'DE' || p === 'DT')) ||
					(entry.position === 'DB' && (p === 'CB' || p === 'S' || p === 'FS' || p === 'SS'));
			});
		});
		if (positionFiltered.length === 1) {
			return positionFiltered[0];
		}
	}
	
	// Need interactive resolution or auto-create historical
	if (candidates.length === 0) {
		// No candidates - create historical player
		console.log('  Creating historical player: ' + entry.name + ' (' + entry.position + ')');
		
		if (dryRun) {
			return { _id: 'dry-run-id', name: entry.name, positions: [entry.position] };
		}
		
		var player = await Player.create({
			name: entry.name,
			positions: entry.position ? [entry.position] : [],
			sleeperId: null
		});
		
		// Add to cache
		if (!playersByNormalizedName[normalizedName]) {
			playersByNormalizedName[normalizedName] = [];
		}
		playersByNormalizedName[normalizedName].push(player);
		
		// Save resolution
		resolver.addResolution(entry.name, null, entry.name, context);
		
		return player;
	}
	
	// Multiple candidates or ambiguous - prompt
	var result = await resolver.promptForPlayer({
		name: entry.name,
		context: context,
		candidates: candidates,
		position: entry.position,
		Player: Player,
		rl: rl,
		playerCache: playersByNormalizedName,
		autoHistorical: true
	});
	
	if (result.action === 'quit') {
		throw new Error('User quit');
	}
	
	return result.player;
}

/**
 * Main run function.
 */
async function run() {
	dryRun = process.argv.includes('--dry-run');
	
	console.log('=== 2008 Initial Auction Seeder ===');
	console.log('Auction date:', AUCTION_TIMESTAMP.toISOString());
	if (dryRun) console.log('[DRY RUN]');
	console.log('');
	
	// Load player resolutions
	console.log('Loaded', resolver.count(), 'cached player resolutions');
	
	// Create readline interface for prompts
	rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout
	});
	
	// Load all players from database
	var allPlayers = await Player.find({});
	allPlayers.forEach(function(p) {
		var normalized = resolver.normalizePlayerName(p.name);
		if (!playersByNormalizedName[normalized]) {
			playersByNormalizedName[normalized] = [];
		}
		playersByNormalizedName[normalized].push(p);
	});
	console.log('Loaded', allPlayers.length, 'players from database');
	
	// Load franchise mappings for 2008 via regimes
	var regimes = await Regime.find({});
	regimes.forEach(function(r) {
		// Find tenure active in 2008
		var tenure = r.tenures.find(function(t) {
			return t.startSeason <= 2008 && (t.endSeason === null || t.endSeason >= 2008);
		});
		if (tenure) {
			franchiseByOwnerName[r.displayName] = tenure.franchiseId;
		}
	});
	console.log('Loaded', Object.keys(franchiseByOwnerName).length, 'franchise mappings for 2008');
	
	// Load snapshot
	var snapshot = loadSnapshot();
	console.log('Loaded', snapshot.length, 'players from 2008 snapshot');
	console.log('');
	
	// Check for existing 2008 auction/contract transactions
	var existingAuction = await Transaction.countDocuments({
		type: 'auction-ufa',
		timestamp: AUCTION_TIMESTAMP
	});
	var existingContract = await Transaction.countDocuments({
		type: 'contract',
		timestamp: CONTRACT_TIMESTAMP
	});
	var existing = existingAuction + existingContract;
	
	if (existing > 0) {
		console.log('Found', existingAuction, 'auction +', existingContract, 'contract transactions from 2008.');
		var answer = await new Promise(function(resolve) {
			rl.question('Clear them and re-seed? [y/N] ', resolve);
		});
		
		if (answer.toLowerCase() === 'y') {
			console.log('Clearing...');
			if (!dryRun) {
				await Transaction.deleteMany({
					$or: [
						{ type: 'auction-ufa', timestamp: AUCTION_TIMESTAMP },
						{ type: 'contract', timestamp: CONTRACT_TIMESTAMP }
					]
				});
			}
		} else {
			console.log('Aborting.');
			rl.close();
			process.exit(0);
		}
	}
	
	// Process each player
	var created = 0;
	var errors = [];
	
	for (var i = 0; i < snapshot.length; i++) {
		var entry = snapshot[i];
		
		// Resolve franchise
		var franchiseId = franchiseByOwnerName[entry.owner];
		if (!franchiseId) {
			errors.push({ player: entry.name, reason: 'Unknown owner: ' + entry.owner });
			continue;
		}
		
		// Resolve player
		var player;
		try {
			player = await resolvePlayer(entry);
		} catch (err) {
			if (err.message === 'User quit') {
				console.log('\nQuitting...');
				break;
			}
			throw err;
		}
		
		if (!player) {
			errors.push({ player: entry.name, reason: 'Could not resolve player' });
			continue;
		}
		
		// Create auction-ufa transaction (acquisition event)
		if (!dryRun) {
			await Transaction.create({
				type: 'auction-ufa',
				timestamp: AUCTION_TIMESTAMP,
				source: 'snapshot',
				franchiseId: franchiseId,
				playerId: player._id,
				winningBid: entry.salary
			});
			
			// Create contract transaction (terms)
			await Transaction.create({
				type: 'contract',
				timestamp: CONTRACT_TIMESTAMP,
				source: 'snapshot',
				franchiseId: franchiseId,
				playerId: player._id,
				salary: entry.salary,
				startYear: entry.startYear,
				endYear: entry.endYear
			});
		}
		
		// Record in roster state (for future resolution)
		rosterState.acquire(player._id, player.name, franchiseId);
		
		created++;
		
		// Progress
		if ((i + 1) % 50 === 0) {
			console.log('  Processed', i + 1, '/', snapshot.length, '...');
		}
	}
	
	// Save resolutions
	resolver.save();
	
	console.log('');
	console.log('=== Done ===');
	console.log('Created:', created, 'players');
	console.log('  auction-ufa:', created);
	console.log('  contract:', created);
	
	// Show roster state
	var stats = rosterState.getStats();
	console.log('');
	console.log('Roster state after 2008 auction:');
	console.log('  Total players tracked:', stats.total);
	console.log('  Rostered:', stats.rostered);
	console.log('  Available:', stats.available);
	
	if (errors.length > 0) {
		console.log('');
		console.log('Errors:', errors.length);
		errors.forEach(function(e) {
			console.log('  -', e.player + ':', e.reason);
		});
	}
	
	rl.close();
	process.exit(0);
}

run().catch(function(err) {
	console.error('Error:', err);
	if (rl) rl.close();
	process.exit(1);
});
