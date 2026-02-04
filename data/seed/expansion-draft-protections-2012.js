/**
 * Seed 2012 Expansion Draft protection transactions.
 * 
 * Each existing franchise protected players before the expansion draft.
 * Protected players could not be selected by the new franchises.
 * 
 * Data source: data/archive/sources/txt/expansion-draft-protections-2012.txt
 * Format: Franchise: Player1, Player2, Player3 (RFA)
 * 
 * Usage:
 *   docker compose run --rm web node data/seed/expansion-draft-protections-2012.js
 *   docker compose run --rm web node data/seed/expansion-draft-protections-2012.js --dry-run
 */

var dotenv = require('dotenv').config({ path: __dirname + '/../../.env' });
var mongoose = require('mongoose');
var fs = require('fs');
var path = require('path');

var Player = require('../../models/Player');
var Franchise = require('../../models/Franchise');
var Transaction = require('../../models/Transaction');
var PSO = require('../../config/pso.js');
var resolver = require('../utils/player-resolver');

mongoose.connect(process.env.MONGODB_URI);

var DATA_FILE = path.join(__dirname, '../archive/sources/txt/expansion-draft-protections-2012.txt');

// Protection timestamp: August 18, 2012 at 9:59 AM ET (1 minute before selections)
var PROTECTION_DATE = new Date(Date.UTC(2012, 7, 18, 13, 59, 0)); // 9:59 AM ET = 13:59 UTC

/**
 * Build owner name to franchise ID lookup for 2012.
 */
function buildOwnerMap() {
	var map = {};
	
	// Use PSO.franchiseNames for 2012
	Object.keys(PSO.franchiseNames).forEach(function(rosterId) {
		var yearMap = PSO.franchiseNames[rosterId];
		if (yearMap && yearMap[2012]) {
			map[yearMap[2012].toLowerCase()] = parseInt(rosterId);
		}
	});
	
	// Add common aliases
	map['patrick'] = 1;
	
	return map;
}

/**
 * Parse the protections file.
 * Format: Franchise: Player1, Player2, Player3 (RFA)
 */
function parseProtectionsFile(content) {
	var protections = [];
	var lines = content.trim().split('\n');
	
	for (var i = 0; i < lines.length; i++) {
		var line = lines[i].trim();
		if (!line || line.startsWith('#')) continue;
		
		var colonIdx = line.indexOf(':');
		if (colonIdx === -1) continue;
		
		var franchiseStr = line.substring(0, colonIdx).trim();
		// Extract roster ID if present (e.g., "Patrick (1)" -> rosterId: 1, name: "Patrick")
		var rosterIdMatch = franchiseStr.match(/\((\d+)\)\s*$/);
		var franchiseRosterId = rosterIdMatch ? parseInt(rosterIdMatch[1], 10) : null;
		var franchise = franchiseStr.replace(/\s*\(\d+\)\s*$/, '');
		var playersStr = line.substring(colonIdx + 1).trim();
		
		if (!playersStr) continue;
		
		var players = playersStr.split(',').map(function(p) { return p.trim(); }).filter(Boolean);
		
		for (var j = 0; j < players.length; j++) {
			var playerStr = players[j];
			var hintRfa = false;
			
			// Check for (RFA) suffix hint
			if (playerStr.match(/\s*\(RFA\)\s*$/i)) {
				hintRfa = true;
				playerStr = playerStr.replace(/\s*\(RFA\)\s*$/i, '').trim();
			}
			
		protections.push({
			franchise: franchise,
			franchiseRosterId: franchiseRosterId,
			player: playerStr,
			hintRfa: hintRfa
		});
		}
	}
	
	return protections;
}

async function run() {
	var args = process.argv.slice(2);
	var dryRun = args.includes('--dry-run');
	
	console.log('Seeding 2012 Expansion Draft Protections' + (dryRun ? ' (DRY RUN)' : ''));
	console.log('');
	
	// Check for data file
	if (!fs.existsSync(DATA_FILE)) {
		console.log('No protections file found: ' + DATA_FILE);
		console.log('Skipping protections seeding.');
		await mongoose.disconnect();
		return;
	}
	
	// Parse protections file
	var content = fs.readFileSync(DATA_FILE, 'utf8');
	var protections = parseProtectionsFile(content);
	console.log('Loaded ' + protections.length + ' protections');
	console.log('');
	
	if (protections.length === 0) {
		console.log('No protections to seed.');
		await mongoose.disconnect();
		return;
	}
	
	// Load franchises
	var franchises = await Franchise.find({}).lean();
	var franchiseByRosterId = {};
	franchises.forEach(function(f) {
		franchiseByRosterId[f.rosterId] = f._id;
	});
	
	var ownerMap = buildOwnerMap();
	
	// Load players for matching
	var allPlayers = await Player.find({}).lean();
	var playersByNormalizedName = {};
	allPlayers.forEach(function(p) {
		var norm = resolver.normalizePlayerName(p.name);
		if (!playersByNormalizedName[norm]) {
			playersByNormalizedName[norm] = [];
		}
		playersByNormalizedName[norm].push(p);
	});
	
	// Load contracts snapshot for 2012 to get contract info
	var contractsPath = path.join(__dirname, '../archive/snapshots/contracts-2012.txt');
	var contractsByPlayer = {};
	if (fs.existsSync(contractsPath)) {
		var contractsContent = fs.readFileSync(contractsPath, 'utf8');
		var contractLines = contractsContent.trim().split('\n');
		for (var i = 1; i < contractLines.length; i++) {
			var cols = contractLines[i].split(',');
			if (cols.length < 7) continue;
			var playerName = cols[2].trim().toLowerCase();
			contractsByPlayer[playerName] = {
				salary: parseInt(cols[6].replace('$', '').trim(), 10),
				startYear: cols[4].trim(),
				endYear: parseInt(cols[5].trim(), 10)
			};
		}
	}
	console.log('Loaded ' + Object.keys(contractsByPlayer).length + ' contracts from 2012 snapshot');
	console.log('');
	
	var created = 0;
	var skipped = 0;
	var errors = [];
	
	for (var i = 0; i < protections.length; i++) {
		var protection = protections[i];
		console.log(protection.franchise + ': ' + protection.player + (protection.hintRfa ? ' (RFA hint)' : ''));
		
		// Resolve franchise (prefer explicit rosterId if provided)
		var rosterId = protection.franchiseRosterId;
		if (!rosterId) {
			var ownerKey = protection.franchise.toLowerCase();
			rosterId = ownerMap[ownerKey];
		}
		if (!rosterId) {
			console.log('  ✗ Could not find franchise: ' + protection.franchise);
			errors.push('Could not find franchise: ' + protection.franchise);
			continue;
		}
		var franchiseId = franchiseByRosterId[rosterId];
		
		// Resolve player
		var normalizedName = resolver.normalizePlayerName(protection.player);
		var candidates = playersByNormalizedName[normalizedName] || [];
		
		var player = null;
		if (candidates.length === 1) {
			player = candidates[0];
		} else if (candidates.length > 1) {
			// Try to find one without sleeperId (historical)
			var historical = candidates.filter(function(c) { return !c.sleeperId; });
			player = historical.length === 1 ? historical[0] : candidates[0];
		}
		
		// Auto-create if not found (historical player)
		if (!player && candidates.length === 0) {
			var existing = await Player.findOne({ name: protection.player, sleeperId: null });
			if (existing) {
				player = existing;
			} else {
				console.log('  Auto-creating historical: ' + protection.player);
				if (!dryRun) {
					player = await Player.create({
						name: protection.player,
						positions: [],
						sleeperId: null
					});
				} else {
					player = { _id: 'dry-run', name: protection.player };
				}
			}
		}
		
		if (!player) {
			console.log('  ✗ Could not find player: ' + protection.player);
			errors.push('Could not find player: ' + protection.player);
			continue;
		}
		
		// Check for existing transaction
		var existingTx = await Transaction.findOne({
			type: 'expansion-draft-protect',
			playerId: player._id,
			franchiseId: franchiseId
		});
		
		if (existingTx) {
			console.log('  → Already exists, skipping');
			skipped++;
			continue;
		}
		
		// Get contract info
		var contract = contractsByPlayer[protection.player.toLowerCase()];
		var isRfaRights = false;
		var salary = null;
		var startYear = null;
		var endYear = null;
		
		if (contract) {
			// Check if it's RFA rights (startYear is 'FA' or contract already expired)
			if (contract.startYear === 'FA' || contract.endYear < 2012) {
				isRfaRights = true;
			} else {
				salary = contract.salary;
				startYear = parseInt(contract.startYear, 10);
				endYear = contract.endYear;
			}
		} else {
			// No contract found - assume RFA rights (or use hint)
			isRfaRights = true;
		}
		
		// Override with hint if provided
		if (protection.hintRfa) {
			isRfaRights = true;
		}
		
		if (isRfaRights) {
			console.log('  → RFA rights');
		} else {
			console.log('  → Contract: $' + salary + ' ' + startYear + '/' + endYear);
		}
		
		// Create transaction
		if (!dryRun) {
			var txData = {
				type: 'expansion-draft-protect',
				timestamp: PROTECTION_DATE,
				source: 'manual',
				franchiseId: franchiseId,
				playerId: player._id
			};
			
			if (isRfaRights) {
				txData.rfaRights = true;
			} else {
				txData.salary = salary;
				txData.startYear = startYear;
				txData.endYear = endYear;
			}
			
			await Transaction.create(txData);
		}
		
		created++;
	}
	
	console.log('');
	console.log('=== Summary ===');
	console.log('Created: ' + created);
	console.log('Skipped (existing): ' + skipped);
	
	if (errors.length > 0) {
		console.log('Errors: ' + errors.length);
		errors.forEach(function(e) {
			console.log('  - ' + e);
		});
	}
	
	await mongoose.disconnect();
}

run().catch(function(err) {
	console.error('Error:', err);
	process.exit(1);
});
