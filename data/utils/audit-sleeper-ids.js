#!/usr/bin/env node
/**
 * Audit Sleeper IDs across critical data files
 * 
 * Checks that every Sleeper ID we reference actually corresponds to the
 * player we think it does, by verifying name and position matches.
 * Also flags ambiguous names (multiple Sleeper players with same name).
 * 
 * Usage: node data/utils/audit-sleeper-ids.js [--verbose]
 */

var fs = require('fs');
var path = require('path');

// File paths
var SLEEPER_DATA_FILE = path.join(__dirname, '../../public/data/sleeper-data.json');
var CUTS_FILE = path.join(__dirname, '../cuts/cuts.json');
var TRADES_FILE = path.join(__dirname, '../trades/trades.json');
var DRAFTS_FILE = path.join(__dirname, '../drafts/drafts.json');
var SNAPSHOTS_DIR = path.join(__dirname, '../archive/snapshots');
var RESOLUTIONS_FILE = path.join(__dirname, '../config/player-resolutions.json');

var verbose = process.argv.includes('--verbose');

// ============================================================================
// Name normalization
// ============================================================================

function normalizeName(name) {
	if (!name) return '';
	return name
		.replace(/\s*\([^)]+\)\s*$/, '')  // Strip team hints like "(NE)"
		.replace(/\s+(III|II|IV|V|Jr\.|Jr|Sr\.|Sr)$/i, '')  // Strip suffixes
		.replace(/\./g, '')  // Remove periods (A.J. -> AJ)
		.replace(/'/g, '')   // Remove apostrophes
		.replace(/-/g, ' ')  // Normalize hyphens to spaces
		.trim()
		.toLowerCase();
}

function normalizePosition(pos) {
	if (!pos) return null;
	// Normalize to sorted uppercase array
	var positions = Array.isArray(pos) ? pos : pos.split(/[\/,]/);
	return positions.map(function(p) { return p.trim().toUpperCase(); }).sort().join('/');
}

// ============================================================================
// Load Sleeper data and build indexes
// ============================================================================

console.log('Loading Sleeper data...');
var sleeperData = JSON.parse(fs.readFileSync(SLEEPER_DATA_FILE, 'utf8'));
var sleeperCount = Object.keys(sleeperData).length;
console.log('  ' + sleeperCount + ' players loaded\n');

// Build name -> [ids] index for detecting ambiguous names
var nameToIds = {};
Object.keys(sleeperData).forEach(function(id) {
	var player = sleeperData[id];
	var normName = normalizeName(player.full_name);
	if (!nameToIds[normName]) {
		nameToIds[normName] = [];
	}
	nameToIds[normName].push(id);
});

var ambiguousNames = {};
Object.keys(nameToIds).forEach(function(name) {
	if (nameToIds[name].length > 1) {
		ambiguousNames[name] = nameToIds[name];
	}
});
console.log('Found ' + Object.keys(ambiguousNames).length + ' ambiguous names in Sleeper data\n');

// Load player resolutions
var resolutions = {};
if (fs.existsSync(RESOLUTIONS_FILE)) {
	resolutions = JSON.parse(fs.readFileSync(RESOLUTIONS_FILE, 'utf8'));
	console.log('Loaded ' + Object.keys(resolutions).length + ' player resolutions\n');
}

// ============================================================================
// Audit result tracking
// ============================================================================

var results = {
	mismatches: [],      // ID points to different name
	notFound: [],        // ID not in Sleeper data
	positionMismatch: [], // Position doesn't match
	ambiguous: [],       // Name has multiple Sleeper IDs
	checked: 0
};

function checkPlayer(sleeperId, ourName, ourPosition, source) {
	if (!sleeperId || sleeperId === '-1' || sleeperId === 'null' || sleeperId === '') {
		return; // Skip historical/missing IDs
	}
	
	results.checked++;
	
	var sleeperPlayer = sleeperData[sleeperId];
	var ourNormName = normalizeName(ourName);
	
	// Check if ID exists
	if (!sleeperPlayer) {
		results.notFound.push({
			sleeperId: sleeperId,
			ourName: ourName,
			source: source
		});
		return;
	}
	
	var sleeperNormName = normalizeName(sleeperPlayer.full_name);
	
	// Check name match
	if (ourNormName !== sleeperNormName) {
		results.mismatches.push({
			sleeperId: sleeperId,
			ourName: ourName,
			sleeperName: sleeperPlayer.full_name,
			source: source
		});
	}
	
	// Check position match (if we have position data)
	if (ourPosition) {
		var ourNormPos = normalizePosition(ourPosition);
		var sleeperPos = sleeperPlayer.fantasy_positions || [];
		var sleeperNormPos = normalizePosition(sleeperPos);
		
		// Check if there's any overlap
		var ourPosArr = ourNormPos.split('/');
		var sleeperPosArr = sleeperNormPos.split('/');
		var hasOverlap = ourPosArr.some(function(p) {
			return sleeperPosArr.includes(p);
		});
		
		if (!hasOverlap && sleeperNormPos) {
			results.positionMismatch.push({
				sleeperId: sleeperId,
				ourName: ourName,
				ourPosition: ourNormPos,
				sleeperPosition: sleeperNormPos,
				source: source
			});
		}
	}
	
	// Check if name is ambiguous
	if (ambiguousNames[ourNormName]) {
		var ids = ambiguousNames[ourNormName];
		var resolution = resolutions[ourNormName];
		
		results.ambiguous.push({
			sleeperId: sleeperId,
			ourName: ourName,
			allIds: ids,
			hasResolution: !!resolution,
			resolutionMatches: resolution ? resolution.sleeperId === sleeperId : null,
			source: source
		});
	}
}

// ============================================================================
// Audit each file type
// ============================================================================

// Audit cuts.json
console.log('Auditing cuts.json...');
if (fs.existsSync(CUTS_FILE)) {
	var cuts = JSON.parse(fs.readFileSync(CUTS_FILE, 'utf8'));
	var cutCount = 0;
	cuts.forEach(function(cut, idx) {
		if (cut.sleeperId) {
			cutCount++;
			checkPlayer(cut.sleeperId, cut.name, cut.position, 'cuts.json:' + idx);
		}
	});
	console.log('  ' + cutCount + ' players checked');
} else {
	console.log('  File not found');
}

// Audit trades.json
console.log('Auditing trades.json...');
if (fs.existsSync(TRADES_FILE)) {
	var trades = JSON.parse(fs.readFileSync(TRADES_FILE, 'utf8'));
	var tradePlayerCount = 0;
	trades.forEach(function(trade) {
		trade.parties.forEach(function(party) {
			(party.players || []).forEach(function(player) {
				if (player.sleeperId) {
					tradePlayerCount++;
					checkPlayer(player.sleeperId, player.name, null, 'trades.json:trade' + trade.tradeId);
				}
			});
		});
	});
	console.log('  ' + tradePlayerCount + ' players checked');
} else {
	console.log('  File not found');
}

// Audit drafts.json
console.log('Auditing drafts.json...');
if (fs.existsSync(DRAFTS_FILE)) {
	var drafts = JSON.parse(fs.readFileSync(DRAFTS_FILE, 'utf8'));
	var draftCount = 0;
	drafts.forEach(function(draft) {
		if (draft.sleeperId && draft.playerName) {
			draftCount++;
			checkPlayer(draft.sleeperId, draft.playerName, null, 'drafts.json:' + draft.season + ':' + draft.pickNumber);
		}
	});
	console.log('  ' + draftCount + ' players checked');
} else {
	console.log('  File not found');
}

// Audit snapshots
console.log('Auditing snapshots...');
if (fs.existsSync(SNAPSHOTS_DIR)) {
	var snapshotFiles = fs.readdirSync(SNAPSHOTS_DIR).filter(function(f) {
		// Only audit contracts-*.txt and postseason-*.txt files
		return f.match(/^(contracts|postseason)-\d{4}\.txt$/);
	}).sort();
	
	var snapshotPlayerCount = 0;
	snapshotFiles.forEach(function(file) {
		var filePath = path.join(SNAPSHOTS_DIR, file);
		var content = fs.readFileSync(filePath, 'utf8');
		var lines = content.trim().split('\n');
		
		for (var i = 1; i < lines.length; i++) {
			var parts = lines[i].split(',');
			if (parts.length < 4) continue;
			
			var sleeperId = parts[0];
			var name = parts[2];
			var position = parts[3];
			
			if (sleeperId && sleeperId !== '-1') {
				snapshotPlayerCount++;
				checkPlayer(sleeperId, name, position, file + ':' + (i + 1));
			}
		}
	});
	console.log('  ' + snapshotFiles.length + ' files, ' + snapshotPlayerCount + ' player entries checked');
} else {
	console.log('  Directory not found');
}

// ============================================================================
// Report results
// ============================================================================

console.log('\n' + '='.repeat(60));
console.log('AUDIT RESULTS');
console.log('='.repeat(60) + '\n');

console.log('Total checked: ' + results.checked + '\n');

// Name mismatches (critical)
if (results.mismatches.length > 0) {
	console.log('NAME MISMATCHES (' + results.mismatches.length + '):');
	console.log('-'.repeat(40));
	results.mismatches.forEach(function(m) {
		console.log('  ID ' + m.sleeperId + ': "' + m.ourName + '" vs Sleeper: "' + m.sleeperName + '"');
		console.log('    Source: ' + m.source);
	});
	console.log('');
}

// Not found (critical)
if (results.notFound.length > 0) {
	console.log('ID NOT FOUND IN SLEEPER (' + results.notFound.length + '):');
	console.log('-'.repeat(40));
	results.notFound.forEach(function(m) {
		console.log('  ID ' + m.sleeperId + ': "' + m.ourName + '"');
		console.log('    Source: ' + m.source);
	});
	console.log('');
}

// Position mismatches (warning)
if (results.positionMismatch.length > 0) {
	console.log('POSITION MISMATCHES (' + results.positionMismatch.length + '):');
	console.log('-'.repeat(40));
	// Dedupe by sleeperId
	var seen = {};
	results.positionMismatch.forEach(function(m) {
		if (seen[m.sleeperId]) return;
		seen[m.sleeperId] = true;
		console.log('  ID ' + m.sleeperId + ' "' + m.ourName + '": ours=' + m.ourPosition + ', Sleeper=' + m.sleeperPosition);
		if (verbose) {
			console.log('    Source: ' + m.source);
		}
	});
	console.log('');
}

// Ambiguous names (informational) - only show with --verbose
var ambiguousByName = {};
if (results.ambiguous.length > 0) {
	// Dedupe by name
	results.ambiguous.forEach(function(a) {
		var normName = normalizeName(a.ourName);
		if (!ambiguousByName[normName]) {
			ambiguousByName[normName] = {
				name: a.ourName,
				allIds: a.allIds,
				usedIds: [],
				hasResolution: a.hasResolution
			};
		}
		if (!ambiguousByName[normName].usedIds.includes(a.sleeperId)) {
			ambiguousByName[normName].usedIds.push(a.sleeperId);
		}
	});
	
	if (verbose) {
		var ambiguousNamesList = Object.keys(ambiguousByName);
		console.log('AMBIGUOUS NAMES (' + ambiguousNamesList.length + ' unique names):');
		console.log('-'.repeat(40));
		ambiguousNamesList.forEach(function(normName) {
			var info = ambiguousByName[normName];
			var resStatus = info.hasResolution ? ' [has resolution]' : ' [NO RESOLUTION]';
			console.log('  "' + info.name + '"' + resStatus);
			console.log('    Sleeper IDs with this name: ' + info.allIds.join(', '));
			console.log('    IDs we use: ' + info.usedIds.join(', '));
			
			// Show which Sleeper player each ID represents
			info.allIds.forEach(function(id) {
				var p = sleeperData[id];
				if (p) {
					var pos = (p.fantasy_positions || []).join('/');
					var team = p.team || 'FA';
					console.log('      ' + id + ': ' + p.full_name + ' (' + pos + ', ' + team + ')');
				}
			});
		});
		console.log('');
	}
}

// Summary
console.log('='.repeat(60));
console.log('SUMMARY');
console.log('='.repeat(60));
console.log('  Name mismatches:     ' + results.mismatches.length + (results.mismatches.length > 0 ? ' [FIX REQUIRED]' : ' ✓'));
console.log('  IDs not found:       ' + results.notFound.length + (results.notFound.length > 0 ? ' [FIX REQUIRED]' : ' ✓'));
console.log('  Position mismatches: ' + results.positionMismatch.length + (results.positionMismatch.length > 0 ? ' [review]' : ' ✓'));
console.log('  Ambiguous names:     ' + Object.keys(ambiguousByName || {}).length + ' unique');

if (results.mismatches.length === 0 && results.notFound.length === 0) {
	console.log('\n✓ All Sleeper IDs verified!');
	process.exit(0);
} else {
	console.log('\n✗ Issues found - review above');
	process.exit(1);
}
