/**
 * Seed auction transactions from extracted-all.csv (2008 founding auction)
 * 
 * Uses entries extracted from results.html (source column = "results.html").
 * This fills in gaps for players who were won at auction but cut before
 * the contract snapshot was taken.
 * 
 * Usage:
 *   docker compose run --rm web node data/seed/auction-results.js
 *   docker compose run --rm web node data/seed/auction-results.js --dry-run
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

var EXTRACTED_FILE = path.join(__dirname, '../archive/snapshots/extracted-all.csv');
var CONTRACTS_FILE = path.join(__dirname, '../archive/snapshots/contracts-2008.txt');

// Auction timestamp: Aug 18, 2008 at 9:00 AM ET = 13:00 UTC
var AUCTION_TIMESTAMP = new Date(Date.UTC(2008, 7, 18, 13, 0, 0));

// Cut day timestamp: conventional date before season start (inferred with :33)
var CUT_TIMESTAMP = new Date(Date.UTC(2008, 7, 24, 4, 0, 33)); // Aug 24, 2008 12:00:33 AM ET

// Name corrections for misspellings in results.html
var NAME_CORRECTIONS = {
	'darelle revis': 'Darrelle Revis',
	'aaron schoebel': 'Aaron Schobel',
	'osi umeniyora': 'Osi Umenyiora',
	'vincent young jr.': 'Vince Young',
	'dj hackett': 'D.J. Hackett',
	'donte stallworth': "Donte' Stallworth"
};

/**
 * Load player names from contracts-2008.txt (to detect who was cut)
 */
function loadContractPlayers() {
	var players = new Set();
	if (!fs.existsSync(CONTRACTS_FILE)) return players;
	
	var content = fs.readFileSync(CONTRACTS_FILE, 'utf8');
	var lines = content.trim().split('\n');
	
	// Skip header
	for (var i = 1; i < lines.length; i++) {
		var cols = lines[i].split(',');
		if (cols.length < 3) continue;
		var name = cols[2] ? cols[2].trim().toLowerCase() : '';
		if (name) players.add(name);
	}
	
	return players;
}

/**
 * Build owner name to franchise ID lookup for 2008.
 */
function buildOwnerMap() {
	var map = {};
	
	Object.keys(PSO.franchiseNames).forEach(function(rosterId) {
		var yearMap = PSO.franchiseNames[rosterId];
		if (yearMap && yearMap[2008]) {
			map[yearMap[2008].toLowerCase()] = parseInt(rosterId);
		}
	});
	
	// Add aliases for names used in results.html
	map['david'] = 10;  // David -> Schexes
	
	return map;
}

/**
 * Load 2008 auction entries from extracted-all.csv (source = results.html)
 */
function loadAuctionEntries() {
	var content = fs.readFileSync(EXTRACTED_FILE, 'utf8');
	var lines = content.trim().split('\n');
	var entries = [];
	
	// Skip header
	for (var i = 1; i < lines.length; i++) {
		var cols = lines[i].split(',');
		if (cols.length < 9) continue;
		
		var source = cols[0];
		if (source !== 'results.html') continue;
		
		var playerName = cols[4] ? cols[4].trim() : '';
		
		// Apply name corrections
		var correctedName = NAME_CORRECTIONS[playerName.toLowerCase()];
		if (correctedName) {
			playerName = correctedName;
		}
		
		entries.push({
			year: parseInt(cols[1], 10),
			owner: cols[3] ? cols[3].trim() : '',
			player: playerName,
			position: cols[5] ? cols[5].trim() : '',
			startYear: cols[6] ? parseInt(cols[6], 10) : null,
			endYear: cols[7] ? parseInt(cols[7], 10) : null,
			salary: cols[8] ? parseInt(cols[8], 10) : 1
		});
	}
	
	return entries;
}

async function run() {
	var args = process.argv.slice(2);
	var dryRun = args.includes('--dry-run');
	
	console.log('Seeding 2008 Auction from extracted-all.csv' + (dryRun ? ' (DRY RUN)' : ''));
	console.log('');
	
	// Load auction entries from extracted-all.csv
	var entries = loadAuctionEntries();
	console.log('Loaded ' + entries.length + ' entries (source: results.html)');
	
	// Load contract snapshot to detect who was cut
	var contractPlayers = loadContractPlayers();
	console.log('Loaded ' + contractPlayers.size + ' players from contracts-2008.txt');
	console.log('');
	
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
	
	var created = 0;
	var skipped = 0;
	var errors = [];
	
	for (var i = 0; i < entries.length; i++) {
		var entry = entries[i];
		
		// Skip entries without owner
		if (!entry.owner) continue;
		
		// Resolve franchise
		var ownerKey = entry.owner.toLowerCase();
		var rosterId = ownerMap[ownerKey];
		if (!rosterId) {
			errors.push('Could not find franchise: ' + entry.owner + ' for ' + entry.player);
			continue;
		}
		var franchiseId = franchiseByRosterId[rosterId];
		
		// Resolve player
		var normalizedName = resolver.normalizePlayerName(entry.player);
		var candidates = playersByNormalizedName[normalizedName] || [];
		
		var player = null;
		if (candidates.length === 1) {
			player = candidates[0];
		} else if (candidates.length > 1) {
			// Try to find one without sleeperId (historical) or match position
			var historical = candidates.filter(function(c) { return !c.sleeperId; });
			if (historical.length === 1) {
				player = historical[0];
			} else {
				// Try position match
				var posMatch = candidates.filter(function(c) {
					if (!c.positions || c.positions.length === 0) return false;
					return c.positions.some(function(p) {
						return entry.position.split('/').includes(p);
					});
				});
				player = posMatch.length === 1 ? posMatch[0] : candidates[0];
			}
		}
		
		// Auto-create if not found (historical player)
		if (!player && candidates.length === 0) {
			var existing = await Player.findOne({ name: entry.player, sleeperId: null });
			if (existing) {
				player = existing;
			} else {
				console.log('Auto-creating historical: ' + entry.player + ' (' + entry.position + ')');
				if (!dryRun) {
					player = await Player.create({
						name: entry.player,
						positions: entry.position ? entry.position.split('/') : [],
						sleeperId: null
					});
					// Add to cache
					if (!playersByNormalizedName[normalizedName]) {
						playersByNormalizedName[normalizedName] = [];
					}
					playersByNormalizedName[normalizedName].push(player);
				} else {
					player = { _id: 'dry-run', name: entry.player };
				}
			}
		}
		
		if (!player) {
			errors.push('Could not find player: ' + entry.player);
			continue;
		}
		
		// Check for existing auction transaction (skip in dry-run for auto-created players)
		if (player._id !== 'dry-run') {
			var existingAuction = await Transaction.findOne({
				type: { $in: ['auction-ufa', 'auction-rfa-matched', 'auction-rfa-unmatched'] },
				playerId: player._id,
				timestamp: {
					$gte: new Date('2008-01-01'),
					$lt: new Date('2009-01-01')
				}
			});
			
			if (existingAuction) {
				skipped++;
				continue;
			}
		}
		
		// Create auction transaction
		console.log('+ ' + entry.player + ' (' + entry.owner + ') $' + entry.salary);
		
		if (!dryRun) {
			await Transaction.create({
				type: 'auction-ufa',
				timestamp: AUCTION_TIMESTAMP,
				source: 'manual',
				franchiseId: franchiseId,
				playerId: player._id,
				salary: entry.salary
			});
		}
		
		created++;
	}
	
	console.log('');
	console.log('=== Summary ===');
	console.log('Created: ' + created);
	console.log('Skipped (existing): ' + skipped);
	
	if (errors.length > 0) {
		console.log('Errors: ' + errors.length);
		errors.slice(0, 10).forEach(function(e) {
			console.log('  - ' + e);
		});
		if (errors.length > 10) {
			console.log('  ... and ' + (errors.length - 10) + ' more');
		}
	}
	
	await mongoose.disconnect();
}

run().catch(function(err) {
	console.error('Error:', err);
	process.exit(1);
});
