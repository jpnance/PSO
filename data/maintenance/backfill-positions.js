/**
 * Backfill positions for players who are missing them.
 * 
 * Uses snapshot facts (contracts-YEAR.txt files) to find position data
 * for players that were auto-created without positions.
 * 
 * Usage:
 *   node data/maintenance/backfill-positions.js [--dry-run]
 */

var fs = require('fs');
var path = require('path');
var mongoose = require('mongoose');
var Player = require('../../models/Player');
var snapshotFacts = require('../facts/snapshot-facts');
var cutFacts = require('../facts/cut-facts');

var ARCHIVE_DIR = path.join(__dirname, '../archive');

/**
 * Load position data from free agent entries (no owner) in contract files.
 * The main snapshot-facts loader skips these, but they have valid positions.
 */
function loadFreeAgentFacts() {
	var facts = [];
	var files = fs.readdirSync(ARCHIVE_DIR);
	
	files.forEach(function(file) {
		if (!file.match(/^contracts-\d{4}\.txt$/)) return;
		
		var content = fs.readFileSync(path.join(ARCHIVE_DIR, file), 'utf8');
		var lines = content.trim().split('\n');
		
		// Skip header
		for (var i = 1; i < lines.length; i++) {
			var cols = lines[i].split(',');
			if (cols.length < 4) continue;
			
			var owner = cols[1].trim();
			var playerName = cols[2].trim();
			var position = cols[3].trim();
			
			// Only grab entries WITHOUT owner (FAs) that have position data
			if (!owner && playerName && position) {
				facts.push({
					playerName: playerName,
					position: position,
					source: 'fa:' + file
				});
			}
		}
	});
	
	return facts;
}

// Normalize position strings to our standard format
function normalizePosition(pos) {
	if (!pos) return null;
	pos = pos.toUpperCase().trim();
	
	// Map common variations
	var posMap = {
		'D': 'DL',
		'DE': 'DL',
		'DT': 'DL',
		'NT': 'DL',
		'ILB': 'LB',
		'OLB': 'LB',
		'MLB': 'LB',
		'CB': 'DB',
		'S': 'DB',
		'SS': 'DB',
		'FS': 'DB',
		'PK': 'K',
		'FB': 'RB'
	};
	
	return posMap[pos] || pos;
}

async function run() {
	var dryRun = process.argv.includes('--dry-run');
	
	if (dryRun) {
		console.log('=== DRY RUN MODE ===\n');
	}
	
	await mongoose.connect(process.env.MONGODB_URI || 'mongodb://mongo:27017/pso');
	
	// Find players without positions
	var playersWithoutPositions = await Player.find({
		$or: [
			{ positions: { $exists: false } },
			{ positions: { $size: 0 } },
			{ positions: null }
		]
	}).lean();
	
	console.log('Found ' + playersWithoutPositions.length + ' players without positions\n');
	
	if (playersWithoutPositions.length === 0) {
		await mongoose.disconnect();
		return;
	}
	
	// Load all snapshot facts (including FA entries for position data)
	console.log('Loading snapshot facts...');
	var allFacts = snapshotFacts.loadAll();
	console.log('Loaded ' + allFacts.length + ' owned contract facts');
	
	// Also load raw files to get FA entries (which have positions but no owner)
	var faFacts = loadFreeAgentFacts();
	console.log('Loaded ' + faFacts.length + ' free agent facts');
	allFacts = allFacts.concat(faFacts);
	
	// Also load cut facts (players who were cut may not appear in contract snapshots)
	var cuts = cutFacts.loadAll();
	var cutFactsWithPos = cuts.filter(function(c) { return c.name && c.position; }).map(function(c) {
		return { playerName: c.name, position: c.position, source: 'cuts' };
	});
	console.log('Loaded ' + cutFactsWithPos.length + ' cut facts with positions');
	allFacts = allFacts.concat(cutFactsWithPos);
	
	console.log('Total: ' + allFacts.length + ' facts\n');
	
	// Build a name -> position map from facts
	// Use most recent occurrence if position changes
	var positionMap = {};
	
	allFacts.forEach(function(fact) {
		if (!fact.playerName || !fact.position) return;
		
		var name = fact.playerName.toLowerCase().trim();
		var pos = normalizePosition(fact.position);
		if (!pos) return;
		
		if (!positionMap[name]) {
			positionMap[name] = { position: pos, season: fact.season };
		} else if (fact.season > positionMap[name].season) {
			// Use most recent season's position
			positionMap[name] = { position: pos, season: fact.season };
		}
	});
	
	console.log('Built position map with ' + Object.keys(positionMap).length + ' entries\n');
	
	// Match and update
	var updated = 0;
	var notFound = [];
	
	for (var player of playersWithoutPositions) {
		var lookupName = player.name.toLowerCase().trim();
		
		// Also try without parenthetical suffix
		var cleanName = lookupName.replace(/\s*\([^)]*\)\s*$/, '').trim();
		
		var match = positionMap[lookupName] || positionMap[cleanName];
		
		if (match) {
			if (dryRun) {
				console.log('Would update: ' + player.name + ' -> [' + match.position + ']');
			} else {
				await Player.updateOne(
					{ _id: player._id },
					{ $set: { positions: [match.position] } }
				);
				console.log('Updated: ' + player.name + ' -> [' + match.position + ']');
			}
			updated++;
		} else {
			notFound.push(player.name);
		}
	}
	
	console.log('\n=== Summary ===');
	console.log('Updated: ' + updated);
	console.log('Not found: ' + notFound.length);
	
	if (notFound.length > 0 && notFound.length <= 20) {
		console.log('\nPlayers not found in facts:');
		notFound.forEach(function(name) {
			console.log('  - ' + name);
		});
	} else if (notFound.length > 20) {
		console.log('\nFirst 20 players not found:');
		notFound.slice(0, 20).forEach(function(name) {
			console.log('  - ' + name);
		});
	}
	
	await mongoose.disconnect();
}

run().catch(function(err) {
	console.error(err);
	process.exit(1);
});
