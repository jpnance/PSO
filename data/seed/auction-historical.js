#!/usr/bin/env node

/**
 * Process contract-history.txt to find players and surface ambiguities.
 * Creates historical player records for anyone not in Sleeper.
 * 
 * Usage:
 *   node data/seed/auction-historical.js 2015
 *   node data/seed/auction-historical.js 2015 --dry-run
 */

var dotenv = require('dotenv').config({ path: __dirname + '/../../.env' });
var mongoose = require('mongoose');
var fs = require('fs');
var path = require('path');

var Player = require('../../models/Player');
var resolver = require('../utils/player-resolver');

// Use resolver's normalize function
function normalizeForMatch(name) {
	return resolver.normalizePlayerName(name);
}

async function run() {
	await mongoose.connect(process.env.MONGODB_URI);
	
	var args = process.argv.slice(2);
	var year = parseInt(args.find(function(a) { return !a.startsWith('--'); }), 10);
	var dryRun = args.includes('--dry-run');
	
	if (!year || isNaN(year)) {
		console.log('Usage: node data/seed/auction-historical.js <year> [--dry-run]');
		process.exit(1);
	}
	
	console.log('Processing year: ' + year + (dryRun ? ' (DRY RUN)' : ''));
	console.log('');
	
	// Parse contract-history.txt
	var filePath = path.join(__dirname, '../archive/legacy/contract-history.txt');
	var content = fs.readFileSync(filePath, 'utf8');
	var lines = content.split('\n');
	
	// Find the section for this year
	var inYear = false;
	var records = [];
	
	for (var i = 0; i < lines.length; i++) {
		var line = lines[i].trim();
		
		// Check for year header
		var yearMatch = line.match(/^=== (\d{4}) data ===$/);
		if (yearMatch) {
			if (parseInt(yearMatch[1], 10) === year) {
				inYear = true;
			} else if (inYear) {
				break; // We've passed our year
			}
			continue;
		}
		
		if (!inYear) continue;
		
		// Skip header row
		if (line.startsWith('ID,')) continue;
		if (!line) continue;
		
		// Parse CSV row
		var parts = line.split(',');
		if (parts.length < 5) continue;
		
		var espnId = parts[0] && parts[0] !== '-1' ? parts[0] : null;
		
		var record = {
			espnId: espnId,
			owner: parts[1] || null,
			name: parts[2],
			position: parts[3],
			start: parts[4],
			end: parts[5] || null,
			salary: parts[6] ? parseInt(parts[6].replace(/[$,]/g, ''), 10) : null
		};
		
		// Only process records with contracts starting this year
		if (record.start === String(year) && record.owner) {
			records.push(record);
		}
	}
	
	console.log('Found ' + records.length + ' new contracts for ' + year);
	console.log('');
	
	// Load all players for matching
	var allPlayers = await Player.find({}).lean();
	var playersByNormalizedName = {};
	var playersByEspnId = {};
	allPlayers.forEach(function(p) {
		var norm = normalizeForMatch(p.name);
		if (!playersByNormalizedName[norm]) {
			playersByNormalizedName[norm] = [];
		}
		playersByNormalizedName[norm].push(p);
		
		// Index by ESPN ID if available (from Sleeper data)
		if (p.espnId) {
			playersByEspnId[String(p.espnId)] = p;
		}
	});
	
	// Load ambiguous list
	var resolutions = {};
	try { resolutions = require('../config/player-resolutions.json'); } catch(e) {}
	var ambiguousList = resolutions._ambiguous || [];
	
	var stats = {
		matched: 0,
		historical: 0,
		ambiguous: [],
		notFound: []
	};
	
	for (var i = 0; i < records.length; i++) {
		var r = records[i];
		var normalizedName = normalizeForMatch(r.name);
		
		// Try ESPN ID match first
		if (r.espnId && playersByEspnId[r.espnId]) {
			stats.matched++;
			continue;
		}
		
		var candidates = playersByNormalizedName[normalizedName] || [];
		
		// Filter by position if we have it
		var positionCandidates = candidates;
		if (r.position && r.position !== 'FA') {
			var positions = r.position.split('/');
			positionCandidates = candidates.filter(function(c) {
				return c.positions && c.positions.some(function(p) {
					return positions.includes(p);
				});
			});
		}
		
		// Check if name is ambiguous
		var isAmbiguous = ambiguousList.includes(normalizedName);
		
		if (isAmbiguous && positionCandidates.length > 0) {
			stats.ambiguous.push(r.name + ' (' + r.position + ') - ' + positionCandidates.length + ' candidates');
		} else if (positionCandidates.length === 1) {
			stats.matched++;
		} else if (positionCandidates.length > 1) {
			stats.ambiguous.push(r.name + ' (' + r.position + ') - ' + positionCandidates.length + ' candidates');
		} else if (candidates.length === 1) {
			// Position mismatch but name matches
			stats.matched++;
		} else if (candidates.length > 1) {
			stats.ambiguous.push(r.name + ' (' + r.position + ') - ' + candidates.length + ' candidates (no position match)');
		} else {
			// No match at all - would need historical player
			stats.notFound.push(r.name + ' (' + r.position + ')');
			
			// Create historical player if not dry run
			if (!dryRun) {
				var existing = await Player.findOne({ name: r.name, sleeperId: null });
				if (!existing) {
					await Player.create({
						name: r.name,
						positions: r.position ? r.position.split('/') : [],
						sleeperId: null
					});
				}
			}
			stats.historical++;
		}
	}
	
	console.log('=== Summary ===');
	console.log('Matched to existing player: ' + stats.matched);
	console.log('Historical (not in Sleeper): ' + stats.historical);
	console.log('');
	
	if (stats.ambiguous.length > 0) {
		console.log('=== Ambiguous (' + stats.ambiguous.length + ') ===');
		stats.ambiguous.forEach(function(a) { console.log('  ' + a); });
		console.log('');
	}
	
	if (stats.notFound.length > 0) {
		console.log('=== Not Found / Historical (' + stats.notFound.length + ') ===');
		stats.notFound.forEach(function(n) { console.log('  ' + n); });
		console.log('');
	}
	
	await mongoose.disconnect();
}

run().catch(function(err) {
	console.error(err);
	process.exit(1);
});
