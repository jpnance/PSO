#!/usr/bin/env node
/**
 * Seed 2009 contract transactions.
 * 
 * Creates contract transactions for all rostered players on contract due date.
 * Uses contracts-2009.txt as the source of truth for who owns each player
 * and their contract terms (salary, startYear, endYear).
 * 
 * Usage:
 *   docker compose run --rm web node data/seed/contracts-2009.js
 *   docker compose run --rm web node data/seed/contracts-2009.js --dry-run
 */

require('dotenv').config();

var fs = require('fs');
var path = require('path');
var readline = require('readline');
var mongoose = require('mongoose');

var Franchise = require('../../models/Franchise');
var Player = require('../../models/Player');
var Regime = require('../../models/Regime');
var Transaction = require('../../models/Transaction');
var resolver = require('../utils/player-resolver');

mongoose.connect(process.env.MONGODB_URI);

// Contract due date from summer-meetings.txt: Sept 2, 2009
// Use :33 convention for inferred timestamp
var CONTRACT_DUE_DATE = new Date(Date.UTC(2009, 8, 2, 23, 59, 33));

var CONTRACTS_PATH = path.join(__dirname, '../archive/snapshots/contracts-2009.txt');

var dryRun = false;
var skipUnresolved = false;
var rl = null;
var playersByNormalizedName = {};

// Owner name mappings
var ownerAliases = {
	'Patrick': 1, 'Koci': 2, 'Syed': 3, 'John': 4, 'Trevor': 5,
	'Keyon': 6, 'Jake/Luke': 7, 'Luke': 7, 'Daniel': 8, 'James': 9, 'Schexes': 10
};

function getRosterId(ownerName) {
	if (ownerName === 'Jake/Luke') ownerName = 'Luke';
	return ownerAliases[ownerName] || null;
}

/**
 * Load contracts from contracts-2009.txt
 * Format: ID,Owner,Name,Position,Start,End,Salary
 */
function loadContracts() {
	var content = fs.readFileSync(CONTRACTS_PATH, 'utf8');
	var lines = content.trim().split('\n');
	var contracts = [];
	
	// Skip header
	for (var i = 1; i < lines.length; i++) {
		var parts = lines[i].split(',');
		if (parts.length < 7) continue;
		
		var espnId = parts[0].trim();
		var owner = parts[1].trim();
		var name = parts[2].trim();
		var position = parts[3].trim();
		var startStr = parts[4].trim();
		var endStr = parts[5].trim();
		var salaryStr = parts[6].trim();
		
		// Skip free agents (no owner)
		if (!owner) continue;
		
		// Parse salary
		var salary = parseInt(salaryStr.replace('$', ''));
		if (isNaN(salary)) salary = null;
		
		// Parse years
		var startYear = startStr === 'FA' ? null : parseInt(startStr);
		var endYear = parseInt(endStr);
		if (isNaN(endYear)) endYear = null;
		
		contracts.push({
			espnId: espnId,
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
 * Resolve a player from contract data.
 */
async function resolvePlayer(contract) {
	var normalizedName = resolver.normalizePlayerName(contract.name);
	var candidates = playersByNormalizedName[normalizedName] || [];
	
	// Check cache
	var context = { year: 2009, type: 'contract', franchise: contract.owner };
	var cached = resolver.lookup(contract.name, context);
	
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
	
	// No candidates - check if player exists elsewhere
	if (candidates.length === 0) {
		// Try exact name match in database
		var exactMatch = await Player.findOne({ name: contract.name });
		if (exactMatch) return exactMatch;
		
		if (skipUnresolved) {
			console.log('SKIPPED (unresolved):', contract.name);
			return null;
		}
		
		// Create historical player
		var positions = contract.position ? [contract.position.split('/')[0]] : [];
		console.log('  Creating historical player:', contract.name, positions.join('/'));
		
		if (dryRun) {
			return { _id: 'dry-run-id', name: contract.name, positions: positions };
		}
		
		var player = await Player.create({
			name: contract.name,
			positions: positions,
			sleeperId: null
		});
		
		if (!playersByNormalizedName[normalizedName]) {
			playersByNormalizedName[normalizedName] = [];
		}
		playersByNormalizedName[normalizedName].push(player);
		
		resolver.addResolution(contract.name, null, contract.name, context);
		return player;
	}
	
	if (skipUnresolved) {
		console.log('SKIPPED (ambiguous):', contract.name);
		return null;
	}
	
	// Multiple candidates - prompt
	var result = await resolver.promptForPlayer({
		name: contract.name,
		context: context,
		candidates: candidates,
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

async function run() {
	dryRun = process.argv.includes('--dry-run');
	skipUnresolved = process.argv.includes('--skip-unresolved');
	
	console.log('=== 2009 Contracts Seeder ===');
	if (dryRun) console.log('[DRY RUN]');
	if (skipUnresolved) console.log('[SKIP UNRESOLVED]');
	console.log('Contract due date:', CONTRACT_DUE_DATE.toISOString());
	console.log('');
	
	// Load player resolutions
	console.log('Loaded', resolver.count(), 'cached player resolutions');
	
	// Create readline interface
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
	
	// Load franchise mappings
	var franchises = await Franchise.find({});
	var franchiseById = {};
	franchises.forEach(function(f) {
		franchiseById[f.rosterId] = f;
	});
	console.log('Loaded', franchises.length, 'franchises');
	
	// Load contracts
	var contracts = loadContracts();
	console.log('Found', contracts.length, 'rostered contracts in contracts-2009.txt');
	console.log('');
	
	// Check for existing 2009 contract transactions
	var existingContracts = await Transaction.countDocuments({
		type: 'contract',
		timestamp: { $gte: new Date('2009-01-01'), $lt: new Date('2010-01-01') }
	});
	
	if (existingContracts > 0 && !dryRun) {
		var answer = await new Promise(function(resolve) {
			rl.question('Found ' + existingContracts + ' existing 2009 contract transactions. Skip them? [Y/n] ', resolve);
		});
		
		if (answer.toLowerCase() === 'n') {
			rl.close();
			process.exit(0);
		}
	}
	
	var counts = { created: 0, skipped: 0, errors: 0 };
	
	for (var i = 0; i < contracts.length; i++) {
		var contract = contracts[i];
		
		// Resolve player
		var player = await resolvePlayer(contract);
		if (!player) {
			counts.errors++;
			continue;
		}
		
		// Get franchise
		var rosterId = getRosterId(contract.owner);
		var franchise = franchiseById[rosterId];
		if (!franchise) {
			console.log('ERROR: Unknown owner:', contract.owner);
			counts.errors++;
			continue;
		}
		
		// Check if contract already exists
		var existing = await Transaction.findOne({
			type: 'contract',
			playerId: player._id,
			timestamp: CONTRACT_DUE_DATE
		});
		
		if (existing) {
			counts.skipped++;
			continue;
		}
		
		if (!dryRun) {
			await Transaction.create({
				type: 'contract',
				timestamp: CONTRACT_DUE_DATE,
				source: 'snapshot',
				franchiseId: franchise._id,
				playerId: player._id,
				salary: contract.salary,
				startYear: contract.startYear,
				endYear: contract.endYear
			});
		}
		counts.created++;
	}
	
	resolver.save();
	
	console.log('\n=== Summary ===');
	console.log('Created:', counts.created);
	console.log('Skipped (existing):', counts.skipped);
	console.log('Errors:', counts.errors);
	
	rl.close();
	process.exit(0);
}

run().catch(function(err) {
	console.error('Error:', err);
	if (rl) rl.close();
	process.exit(1);
});
