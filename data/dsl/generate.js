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
 * Load trades
 * Returns: { espnId: [{ tradeId, year, toOwner }, ...] }
 */
function loadTrades() {
	var trades = JSON.parse(fs.readFileSync(TRADES_FILE, 'utf8'));
	var map = {};
	
	trades.forEach(function(trade) {
		var year = new Date(trade.date).getFullYear();
		
		trade.parties.forEach(function(party) {
			(party.players || []).forEach(function(player) {
				if (!player.espnId) return;
				
				if (!map[player.espnId]) {
					map[player.espnId] = [];
				}
				map[player.espnId].push({
					tradeId: trade.tradeId,
					year: year,
					date: trade.date,
					toOwner: party.owner
				});
			});
		});
	});
	
	// Sort each player's trades by date
	Object.keys(map).forEach(function(espnId) {
		map[espnId].sort(function(a, b) {
			return new Date(a.date) - new Date(b.date);
		});
	});
	
	return map;
}

/**
 * Parse all contract snapshots
 * Returns: { espnId: { name, positions, appearances: [{ year, owner, salary, startYear, endYear }, ...] } }
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
			
			var appearance = {
				year: year,
				owner: owner,
				salary: salary,
				startYear: startYear,
				endYear: endYear
			};
			
			if (!players[espnId]) {
				players[espnId] = {
					espnId: espnId,
					name: name,
					positions: positionList.slice(),
					appearances: [appearance]
				};
			} else {
				players[espnId].appearances.push(appearance);
				// Merge positions (avoid duplicates)
				positionList.forEach(function(pos) {
					if (pos && !players[espnId].positions.includes(pos)) {
						players[espnId].positions.push(pos);
					}
				});
			}
		}
	});
	
	// Sort appearances by year for each player
	Object.keys(players).forEach(function(espnId) {
		players[espnId].appearances.sort(function(a, b) {
			return a.year - b.year;
		});
	});
	
	return players;
}

/**
 * Helper to format 2-digit year
 */
function yy(year) {
	if (year === null) return 'FA';
	return String(year % 100).padStart(2, '0');
}

/**
 * Find a trade that explains an owner change
 */
function findTrade(espnId, fromYear, toOwner, tradesMap) {
	var trades = tradesMap[espnId];
	if (!trades) return null;
	
	// Look for a trade to this owner around this time
	for (var i = 0; i < trades.length; i++) {
		var trade = trades[i];
		// Trade should be in the year before or same year as the appearance
		if (trade.year >= fromYear - 1 && trade.year <= fromYear) {
			// Check if owner matches (case-insensitive, handle regime name variations)
			if (trade.toOwner.toLowerCase() === toOwner.toLowerCase()) {
				return trade;
			}
			// Handle regime transitions (e.g., "Koci" -> "Koci/Mueller")
			if (toOwner.toLowerCase().includes(trade.toOwner.toLowerCase()) ||
				trade.toOwner.toLowerCase().includes(toOwner.toLowerCase())) {
				return trade;
			}
		}
	}
	return null;
}

/**
 * Generate all transactions for a player by walking their contract history
 */
function generatePlayerTransactions(player, draftsMap, tradesMap) {
	var transactions = [];
	var appearances = player.appearances;
	
	if (appearances.length === 0) return transactions;
	
	var prevAppearance = null;
	var prevContractKey = null;  // "startYear|endYear" to detect contract changes
	
	for (var i = 0; i < appearances.length; i++) {
		var app = appearances[i];
		var contractKey = (app.startYear || 'FA') + '|' + app.endYear;
		
		if (i === 0) {
			// First appearance - determine entry transaction
			var tx = determineEntryTransaction(player, app, draftsMap);
			transactions.push(tx);
			prevContractKey = contractKey;
			prevAppearance = app;
			continue;
		}
		
		// Check for gaps (player not rostered in between)
		var yearGap = app.year - prevAppearance.year;
		if (yearGap > 1) {
			// Gap detected - player was cut at some point
			transactions.push({
				year: prevAppearance.year,
				type: 'cut',
				line: '  ' + yy(prevAppearance.year) + ' cut'
			});
		}
		
		// Check for contract changes
		if (contractKey !== prevContractKey) {
			// New contract
			if (app.startYear === null) {
				// FA pickup
				transactions.push({
					year: app.year,
					type: 'fa',
					line: '  ' + yy(app.year) + ' fa ' + app.owner + ' $' + app.salary + ' FA/' + yy(app.endYear)
				});
			} else if (app.startYear === app.year) {
				// New contract starting this year - auction
				transactions.push({
					year: app.year,
					type: 'auction',
					line: '  ' + yy(app.year) + ' auction ' + app.owner + ' $' + app.salary + ' ' + yy(app.startYear) + '/' + yy(app.endYear)
				});
			} else if (app.startYear > prevAppearance.year) {
				// Contract started after last appearance - auction in startYear
				transactions.push({
					year: app.startYear,
					type: 'auction',
					line: '  ' + yy(app.startYear) + ' auction ' + app.owner + ' $' + app.salary + ' ' + yy(app.startYear) + '/' + yy(app.endYear)
				});
			}
		} else if (app.owner !== prevAppearance.owner) {
			// Same contract but different owner - look for trade
			var trade = findTrade(player.espnId, app.year, app.owner, tradesMap);
			if (trade) {
				transactions.push({
					year: trade.year,
					type: 'trade',
					line: '  ' + yy(trade.year) + ' trade ' + trade.tradeId + ' -> ' + app.owner
				});
			} else {
				transactions.push({
					year: app.year,
					type: 'unknown',
					line: '  ' + yy(app.year) + ' unknown ' + app.owner + '  # owner changed, no trade found'
				});
			}
		}
		
		prevContractKey = contractKey;
		prevAppearance = app;
	}
	
	return transactions;
}

/**
 * Determine the entry transaction for a player's first appearance
 */
function determineEntryTransaction(player, app, draftsMap) {
	var year = app.year;
	var startYear = app.startYear;
	var endYear = app.endYear;
	var salary = app.salary;
	var owner = app.owner;
	
	// Check if player was drafted
	var draftKey = player.name.toLowerCase() + '|' + startYear;
	var draftInfo = draftsMap[draftKey];
	
	if (draftInfo) {
		// We have draft data for this player
		var pickInRound = ((draftInfo.pick - 1) % 10) + 1;
		return {
			year: draftInfo.season,
			type: 'draft',
			line: '  ' + yy(draftInfo.season) + ' draft ' + draftInfo.owner + ' ' + draftInfo.round + '.' + String(pickInRound).padStart(2, '0')
		};
	} else if (startYear === null) {
		// FA contract - picked up as free agent
		return {
			year: year,
			type: 'fa',
			line: '  ' + yy(year) + ' fa ' + owner + ' $' + salary + ' FA/' + yy(endYear)
		};
	} else if (startYear <= year) {
		// Contract started this year or before - auction from startYear
		return {
			year: startYear,
			type: 'auction',
			line: '  ' + yy(startYear) + ' auction ' + owner + ' $' + salary + ' ' + yy(startYear) + '/' + yy(endYear)
		};
	} else {
		// startYear > year - shouldn't happen, but default to auction
		return {
			year: startYear,
			type: 'auction',
			line: '  ' + yy(startYear) + ' auction ' + owner + ' $' + salary + ' ' + yy(startYear) + '/' + yy(endYear)
		};
	}
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
	
	console.log('Loading trades...');
	var tradesMap = loadTrades();
	console.log('  ' + Object.keys(tradesMap).length + ' players with trades\n');
	
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
		var transactions = generatePlayerTransactions(player, draftsMap);
		
		lines.push(header);
		transactions.forEach(function(tx) {
			lines.push(tx.line);
		});
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
