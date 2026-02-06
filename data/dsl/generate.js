#!/usr/bin/env node
/**
 * DSL Generator
 * 
 * Generates player-history.dsl from source data.
 * 
 * Usage:
 *   node data/dsl/generate.js [--nuclear]
 * 
 * Options:
 *   --nuclear   Rewrite entire DSL file from scratch (default behavior for now)
 */

var fs = require('fs');
var path = require('path');
var { execSync } = require('child_process');

var DSL_FILE = path.join(__dirname, 'player-history.dsl');
var SNAPSHOTS_DIR = path.join(__dirname, '../archive/snapshots');
var TRADES_FILE = path.join(__dirname, '../trades/trades.json');
var CUTS_FILE = path.join(__dirname, '../cuts/cuts.json');
var SLEEPER_FILE = path.join(__dirname, '../../public/data/sleeper-data.json');
var DRAFTS_FILE = path.join(__dirname, '../drafts/drafts.json');

/**
 * Load Sleeper data (ESPN ID -> Sleeper ID mapping)
 */
function loadSleeperMap() {
	var cmd = 'jq -r \'to_entries[] | select(.value.espn_id != null) | "\\(.value.espn_id)\\t\\(.key)\\t\\(.value.full_name)"\' ' + SLEEPER_FILE;
	var output = execSync(cmd, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
	
	var map = {};
	output.trim().split('\n').forEach(function(line) {
		var parts = line.split('\t');
		if (parts.length >= 3) {
			map[parts[0]] = { sleeperId: parts[1], name: parts[2] };
		}
	});
	return map;
}

/**
 * Load draft picks
 * Returns: { "playerName|season": { round, pick, owner } }
 */
function loadDrafts() {
	var drafts = JSON.parse(fs.readFileSync(DRAFTS_FILE, 'utf8'));
	var map = {};
	
	drafts.forEach(function(d) {
		// Key by normalized name + season
		var key = d.playerName.toLowerCase() + '|' + d.season;
		map[key] = {
			season: d.season,
			round: d.round,
			pick: d.pickNumber,
			owner: d.owner
		};
	});
	
	return map;
}

/**
 * Parse all contract snapshots
 * Returns: { espnId: { name, positions, firstSeen: { year, owner, salary, startYear, endYear } } }
 */
function parseSnapshots() {
	var files = fs.readdirSync(SNAPSHOTS_DIR).filter(function(f) {
		return f.match(/^contracts-\d{4}\.txt$/);
	}).sort();
	
	var players = {};
	
	files.forEach(function(file) {
		var year = parseInt(file.match(/contracts-(\d{4})\.txt/)[1]);
		var content = fs.readFileSync(path.join(SNAPSHOTS_DIR, file), 'utf8');
		var lines = content.trim().split('\n');
		
		// Skip header
		for (var i = 1; i < lines.length; i++) {
			var parts = lines[i].split(',');
			if (parts.length < 7) continue;
			
			var espnId = parts[0];
			var owner = parts[1];
			var name = parts[2];
			var position = parts[3];
			var startYear = parts[4] === 'FA' ? null : parseInt(parts[4]);
			var endYear = parseInt(parts[5]);
			var salaryStr = parts[6].replace(/[$,]/g, '');
			var salary = salaryStr ? parseInt(salaryStr) : 1;
			if (isNaN(salary)) salary = 1;
			
			// Skip placeholder IDs
			if (!espnId || espnId === '-1' || espnId === '') continue;
			
			// Skip unrostered players (no owner)
			if (!owner) continue;
			
			// Split position on / if needed
			var positionList = position ? position.split('/') : [];
			
			if (!players[espnId]) {
				players[espnId] = {
					espnId: espnId,
					name: name,
					positions: positionList.slice(),
					firstSeen: {
						year: year,
						owner: owner,
						salary: salary,
						startYear: startYear,
						endYear: endYear
					}
				};
			} else {
				// Track earliest appearance
				if (year < players[espnId].firstSeen.year) {
					players[espnId].firstSeen = {
						year: year,
						owner: owner,
						salary: salary,
						startYear: startYear,
						endYear: endYear
					};
				}
				// Merge positions (avoid duplicates)
				positionList.forEach(function(pos) {
					if (pos && !players[espnId].positions.includes(pos)) {
						players[espnId].positions.push(pos);
					}
				});
			}
		}
	});
	
	return players;
}

/**
 * Determine the earliest transaction type for a player
 */
function determineEarliestTransaction(player, sleeperMap, draftsMap) {
	var firstSeen = player.firstSeen;
	var year = firstSeen.year;
	var startYear = firstSeen.startYear;
	var endYear = firstSeen.endYear;
	var salary = firstSeen.salary;
	var owner = firstSeen.owner;
	
	// Helper to format 2-digit year
	function yy(year) {
		if (year === null) return 'FA';
		return String(year % 100).padStart(2, '0');
	}
	
	// Check if player was drafted
	var draftKey = player.name.toLowerCase() + '|' + startYear;
	var draftInfo = draftsMap[draftKey];
	
	// Determine transaction type based on contract characteristics
	var txType;
	var txDetails;
	
	if (draftInfo) {
		// We have draft data for this player
		// pickNumber is overall pick, convert to pick-in-round assuming 10-team league
		var pickInRound = ((draftInfo.pick - 1) % 10) + 1;
		txType = 'draft';
		txDetails = draftInfo.owner + ' ' + draftInfo.round + '.' + String(pickInRound).padStart(2, '0');
		// Use the draft year, not the snapshot year
		year = draftInfo.season;
	} else if (startYear === null) {
		// FA contract - picked up as free agent
		txType = 'fa';
		txDetails = owner + ' $' + salary + ' FA/' + yy(endYear);
	} else if (startYear === year) {
		// Contract starts this year - auction
		txType = 'auction';
		txDetails = owner + ' $' + salary + ' ' + yy(startYear) + '/' + yy(endYear);
	} else if (startYear < year) {
		// Contract started before first snapshot - must be auction from startYear
		txType = 'auction';
		txDetails = owner + ' $' + salary + ' ' + yy(startYear) + '/' + yy(endYear);
		year = startYear;  // Use the contract start year
	} else {
		// startYear > year - shouldn't happen, but default to auction
		txType = 'auction';
		txDetails = owner + ' $' + salary + ' ' + yy(startYear) + '/' + yy(endYear);
	}
	
	// Format the year
	var yearStr = String(year % 100).padStart(2, '0');
	
	return {
		year: year,
		line: '  ' + yearStr + ' ' + txType + ' ' + txDetails
	};
}

/**
 * Format player header
 */
function formatHeader(player, sleeperMap) {
	var parts = [player.name, player.positions.join('/')];
	
	// Add Sleeper ID if available
	var sleeperInfo = sleeperMap[player.espnId];
	if (sleeperInfo) {
		parts.push('sleeper:' + sleeperInfo.sleeperId);
	}
	
	// Add ESPN ID
	parts.push('espn:' + player.espnId);
	
	// Mark as historical if not in Sleeper
	if (!sleeperInfo) {
		parts.push('historical');
	}
	
	return parts.join(' | ');
}

/**
 * Generate DSL content
 */
function generateDSL() {
	console.log('Loading Sleeper data...');
	var sleeperMap = loadSleeperMap();
	console.log('  ' + Object.keys(sleeperMap).length + ' players with ESPN IDs\n');
	
	console.log('Loading draft data...');
	var draftsMap = loadDrafts();
	console.log('  ' + Object.keys(draftsMap).length + ' draft picks\n');
	
	console.log('Parsing snapshots...');
	var players = parseSnapshots();
	var espnIds = Object.keys(players);
	console.log('  ' + espnIds.length + ' players found\n');
	
	// Sort players by name
	espnIds.sort(function(a, b) {
		return players[a].name.localeCompare(players[b].name);
	});
	
	// Generate DSL
	var lines = [];
	
	// Header
	lines.push('# Player Transaction History DSL');
	lines.push('# ');
	lines.push('# Generated by: node data/dsl/generate.js --nuclear');
	lines.push('# Generated at: ' + new Date().toISOString());
	lines.push('# ');
	lines.push('# GRAMMAR:');
	lines.push('#   Header: Name | Position(s) | sleeper:ID [| espn:ID] [| historical]');
	lines.push('#   Transaction: YY TYPE [ARGS...]');
	lines.push('#');
	lines.push('# IDs:');
	lines.push('#   sleeper:ID   - Sleeper player ID (required for active players)');
	lines.push('#   espn:ID      - ESPN player ID (optional)');
	lines.push('#   historical   - Player no longer in NFL, not in Sleeper');
	lines.push('#');
	lines.push('# TYPES:');
	lines.push('#   auction OWNER $SALARY YY/YY              - UFA win');
	lines.push('#   auction-rfa-matched OWNER $SALARY YY/YY  - RFA matched by original owner');
	lines.push('#   auction-rfa-unmatched OWNER $SALARY YY/YY - RFA won by different owner');
	lines.push('#   draft OWNER RD.PICK                      - Rookie draft selection');
	lines.push('#   fa OWNER [$SALARY] [YY/YY]               - FA pickup');
	lines.push('#   trade NUMBER -> OWNER                    - Trade (NUMBER refs trades.json)');
	lines.push('#   cut                                      - Released by current owner');
	lines.push('#   contract [$SALARY] YY/YY                 - Contract signed');
	lines.push('#   rfa                                      - RFA rights conveyed at season end');
	lines.push('#   lapsed                                   - RFA rights expired');
	lines.push('#   unknown OWNER                            - gap: player ended up with OWNER, unknown how');
	lines.push('#');
	lines.push('# CONVENTIONS:');
	lines.push('#   - YY = 2-digit year (08 = 2008)');
	lines.push('#   - YY/YY = startYear/endYear');
	lines.push('#   - FA/YY = free agent contract (null startYear)');
	lines.push('#   - Blank lines separate players');
	lines.push('#   - # starts a comment');
	lines.push('');
	lines.push('# =============================================================================');
	lines.push('');
	
	// Generate player entries
	espnIds.forEach(function(espnId) {
		var player = players[espnId];
		var header = formatHeader(player, sleeperMap);
		var tx = determineEarliestTransaction(player, sleeperMap, draftsMap);
		
		lines.push(header);
		lines.push(tx.line);
		lines.push('');
	});
	
	return lines.join('\n');
}

function run() {
	var args = process.argv.slice(2);
	var nuclear = args.includes('--nuclear') || true;  // Default to nuclear for now
	
	console.log('=== DSL Generator ===\n');
	
	if (nuclear) {
		console.log('Mode: NUCLEAR (full rewrite)\n');
	}
	
	var content = generateDSL();
	
	// Write to file
	fs.writeFileSync(DSL_FILE, content);
	console.log('Wrote ' + DSL_FILE);
	
	// Count players
	var playerCount = (content.match(/^[A-Z]/gm) || []).length;
	console.log('Total players: ' + playerCount);
}

run();
