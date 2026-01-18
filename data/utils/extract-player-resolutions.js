/**
 * Extract player name → sleeperId/name mappings from the current database.
 * 
 * This captures all the manual matching work done during seeding.
 * The output file can be manually edited to add aliases or fix names.
 * Future seed scripts will consult this file before prompting.
 * 
 * Usage:
 *   docker compose run --rm web node data/utils/extract-player-resolutions.js
 * 
 * Output format:
 *   {
 *     "normalized name": { "sleeperId": "12345" },           // Sleeper player
 *     "normalized name": { "sleeperId": null, "name": "Display Name" }  // Historical
 *   }
 * 
 * Multiple aliases can point to the same player:
 *   {
 *     "marion barber iii": { "sleeperId": null, "name": "Marion Barber" },
 *     "marion barber": { "sleeperId": null, "name": "Marion Barber" }
 *   }
 */

var dotenv = require('dotenv').config({ path: __dirname + '/../../.env' });
var mongoose = require('mongoose');
var fs = require('fs');

var Player = require('../../models/Player');
var sleeperData = Object.values(require('../../public/data/sleeper-data.json'));

mongoose.connect(process.env.MONGODB_URI);

var relevantPositions = ['QB', 'RB', 'WR', 'TE', 'DL', 'LB', 'DB', 'K'];

function hasRelevantPosition(player) {
	if (!player.fantasy_positions) return false;
	return player.fantasy_positions.some(function(pos) {
		return relevantPositions.includes(pos);
	});
}

// Find ambiguous names in Sleeper data
function findAmbiguousNames() {
	var byName = {};
	
	sleeperData.forEach(function(player) {
		if (!player.full_name) return;
		if (!hasRelevantPosition(player)) return;
		
		var normalized = normalizePlayerName(player.full_name);
		if (!byName[normalized]) byName[normalized] = [];
		byName[normalized].push(player);
	});
	
	return Object.keys(byName)
		.filter(function(name) { return byName[name].length > 1; })
		.filter(function(name) { return name !== 'player invalid' && name !== 'duplicate player'; })
		.sort();
}

function normalizePlayerName(name) {
	if (!name) return '';
	return name
		.replace(/\s+(III|II|IV|V|Jr\.|Sr\.)$/i, '')
		.replace(/[^\w\s]/g, '')
		.replace(/\s+/g, ' ')
		.trim()
		.toLowerCase();
}

async function extract() {
	console.log('Extracting player resolutions from database...\n');
	
	// Load existing resolutions if present (to preserve manual edits)
	var existingResolutions = {};
	var existingPath = __dirname + '/../config/player-resolutions.json';
	try {
		existingResolutions = require('../config/player-resolutions.json');
		console.log('Loaded existing resolutions:', Object.keys(existingResolutions).length);
	} catch (e) {
		console.log('No existing resolutions file, creating new one.');
	}
	
	// Get all players from database
	var players = await Player.find({}).lean();
	console.log('Players in database:', players.length);
	
	var resolutions = { ...existingResolutions };
	var added = 0;
	var sleeperCount = 0;
	var historicalCount = 0;
	
	// Build resolutions map from database
	for (var i = 0; i < players.length; i++) {
		var player = players[i];
		var normalizedName = normalizePlayerName(player.name);
		
		// Skip if already in resolutions (preserve manual edits/aliases)
		if (resolutions[normalizedName]) {
			continue;
		}
		
		if (player.sleeperId) {
			resolutions[normalizedName] = { sleeperId: player.sleeperId };
			sleeperCount++;
		} else {
			resolutions[normalizedName] = { sleeperId: null, name: player.name };
			historicalCount++;
		}
		added++;
	}
	
	// Also add entries from draft-selections.json (original spreadsheet names)
	try {
		var draftSelections = require('./draft-selections.json');
		var draftAdded = 0;
		
		for (var i = 0; i < draftSelections.length; i++) {
			var sel = draftSelections[i];
			if (sel.playerNameRaw) {
				var rawNormalized = normalizePlayerName(sel.playerNameRaw);
				
				// Skip if already exists
				if (resolutions[rawNormalized]) continue;
				
				if (sel.sleeperId === 'historical') {
					resolutions[rawNormalized] = { 
						sleeperId: null, 
						name: sel.playerNameNormalized || sel.playerNameRaw 
					};
				} else if (sel.sleeperId) {
					resolutions[rawNormalized] = { sleeperId: sel.sleeperId };
				}
				draftAdded++;
			}
		}
		
		if (draftAdded > 0) {
			console.log('Added from draft-selections.json:', draftAdded);
			added += draftAdded;
		}
	} catch (e) {
		console.log('(draft-selections.json not found, skipping)');
	}
	
	// Find ambiguous names
	var ambiguousNames = findAmbiguousNames();
	console.log('Found', ambiguousNames.length, 'ambiguous names in Sleeper data');
	
	// Sort by key for readability, with _ambiguous first
	var sortedResolutions = { _ambiguous: ambiguousNames };
	Object.keys(resolutions).sort().forEach(function(key) {
		if (key !== '_ambiguous') {
			sortedResolutions[key] = resolutions[key];
		}
	});
	
	// Write output
	fs.writeFileSync(existingPath, JSON.stringify(sortedResolutions, null, 2));
	
	console.log('\nWrote', Object.keys(sortedResolutions).length, 'resolutions to data/config/player-resolutions.json');
	console.log('  New entries added:', added);
	
	// Summary stats
	var byType = { sleeper: 0, historical: 0 };
	Object.values(sortedResolutions).forEach(function(v) {
		if (v.sleeperId) byType.sleeper++;
		else byType.historical++;
	});
	
	console.log('\nTotal resolutions:');
	console.log('  Sleeper IDs:', byType.sleeper);
	console.log('  Historical:', byType.historical);
	
	process.exit(0);
}

extract().catch(function(err) {
	console.error('Error:', err);
	process.exit(1);
});
