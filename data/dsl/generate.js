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

var DSL_FILE = path.join(__dirname, 'player-history.dsl');
var SNAPSHOTS_DIR = path.join(__dirname, '../archive/snapshots');
var TRADES_FILE = path.join(__dirname, '../trades/trades.json');
var DRAFTS_FILE = path.join(__dirname, '../drafts/drafts.json');
var CUTS_FILE = path.join(__dirname, '../cuts/cuts.json');


/**
 * Load draft picks
 * Returns: { bySleeperId: {...}, byName: {...} }
 */
function loadDrafts() {
	var drafts = JSON.parse(fs.readFileSync(DRAFTS_FILE, 'utf8'));
	var bySleeperId = {};
	var byName = {};
	
	drafts.forEach(function(d) {
		// Skip passed picks (no player)
		if (!d.playerName) return;
		
		var entry = {
			season: d.season,
			round: d.round,
			pick: d.pickNumber,
			owner: d.owner
		};
		
		// Key by sleeperId + season if available
		if (d.sleeperId) {
			var key = d.sleeperId + '|' + d.season;
			bySleeperId[key] = entry;
		}
		
		// Also key by name + season as fallback
		var nameKey = d.playerName.toLowerCase() + '|' + d.season;
		byName[nameKey] = entry;
	});
	
	return { bySleeperId: bySleeperId, byName: byName };
}

/**
 * Load cuts from cuts.json
 * Returns: { bySleeperId: {...}, byName: {...} }
 * Each key maps to an array of cuts (a player can be cut multiple times)
 */
function loadCuts() {
	var cuts = JSON.parse(fs.readFileSync(CUTS_FILE, 'utf8'));
	var bySleeperId = {};
	var byName = {};
	
	cuts.forEach(function(cut) {
		var entry = {
			year: cut.cutYear,
			owner: cut.owner,
			name: cut.name,
			position: cut.position,
			sleeperId: cut.sleeperId || null,
			startYear: cut.startYear,
			endYear: cut.endYear,
			salary: cut.salary || 1,
			offseason: cut.offseason || false
		};
		
		if (cut.sleeperId) {
			if (!bySleeperId[cut.sleeperId]) {
				bySleeperId[cut.sleeperId] = [];
			}
			bySleeperId[cut.sleeperId].push(entry);
		} else {
			// Historical player - key by lowercase name
			var nameKey = cut.name.toLowerCase();
			if (!byName[nameKey]) {
				byName[nameKey] = [];
			}
			byName[nameKey].push(entry);
		}
	});
	
	return { bySleeperId: bySleeperId, byName: byName };
}

/**
 * Load trades
 * Returns: { bySleeperId: {...}, byName: {...} }
 */
function loadTrades() {
	var trades = JSON.parse(fs.readFileSync(TRADES_FILE, 'utf8'));
	var bySleeperId = {};
	var byName = {};
	
	trades.forEach(function(trade) {
		var year = new Date(trade.date).getFullYear();
		
		trade.parties.forEach(function(party) {
			(party.players || []).forEach(function(player) {
				var entry = {
					tradeId: trade.tradeId,
					year: year,
					date: trade.date,
					toOwner: party.owner
				};
				
				// Track sleeperId in entry for filtering
			entry.sleeperId = player.sleeperId || null;
			
			if (player.sleeperId) {
				if (!bySleeperId[player.sleeperId]) {
					bySleeperId[player.sleeperId] = [];
				}
				bySleeperId[player.sleeperId].push(entry);
			}
			
			// Add all to byName (will filter by sleeperId at lookup time)
			if (player.name) {
				var nameKey = player.name.toLowerCase();
				if (!byName[nameKey]) {
					byName[nameKey] = [];
				}
				byName[nameKey].push(entry);
			}
			});
		});
	});
	
	// Sort by date
	function sortByDate(arr) {
		arr.sort(function(a, b) {
			return new Date(a.date) - new Date(b.date);
		});
	}
	
	Object.keys(bySleeperId).forEach(function(k) { sortByDate(bySleeperId[k]); });
	Object.keys(byName).forEach(function(k) { sortByDate(byName[k]); });
	
	return { bySleeperId: bySleeperId, byName: byName };
}

/**
 * Load unsigned player trades
 * Returns map: sleeperId|name -> [{tradeId, date, year, sender, receiver}]
 */
function loadUnsignedTrades() {
	var trades = JSON.parse(fs.readFileSync(TRADES_FILE, 'utf8'));
	var result = { bySleeperId: {}, byName: {} };
	
	// Special case: Trade 486 is 3-party, Schex sent Montrell Washington to Keyon
	var SPECIAL_SENDERS = {
		'486|Montrell Washington': 'Schex'
	};
	
	trades.forEach(function(trade) {
		var year = new Date(trade.date).getFullYear();
		var parties = trade.parties;
		
		parties.forEach(function(party, partyIndex) {
			(party.players || []).forEach(function(player) {
				// Only care about unsigned players
				if (player.contractStr !== 'unsigned' && player.contract && player.contract.start !== null) {
					return;
				}
				
				var receiver = party.owner;
				var sender;
				
				// Check special cases first
				var specialKey = trade.tradeId + '|' + player.name;
				if (SPECIAL_SENDERS[specialKey]) {
					sender = SPECIAL_SENDERS[specialKey];
				} else if (parties.length === 2) {
					// Two-party trade: sender is the other party
					sender = parties[1 - partyIndex].owner;
				} else {
					// Multi-party trade without special case - can't determine sender
					console.warn('Warning: Cannot determine sender for ' + player.name + ' in trade ' + trade.tradeId);
					return;
				}
				
				var entry = {
					tradeId: trade.tradeId,
					date: trade.date,
					year: year,
					sender: sender,
					receiver: receiver
				};
				
				if (player.sleeperId) {
					if (!result.bySleeperId[player.sleeperId]) {
						result.bySleeperId[player.sleeperId] = [];
					}
					result.bySleeperId[player.sleeperId].push(entry);
				}
				
				var nameKey = player.name.toLowerCase();
				if (!result.byName[nameKey]) {
					result.byName[nameKey] = [];
				}
				result.byName[nameKey].push(entry);
			});
		});
	});
	
	return result;
}

/**
 * Parse contract snapshots (pre-season state only, NOT postseason)
 * Snapshots now have Sleeper IDs in the ID column (or -1 for historical)
 * Returns: { sleeperId: { name, positions, appearances: [...] } }
 */
function parseSnapshots() {
	// Only parse contracts-*.txt files (pre-season state)
	// Postseason files are handled separately for final FA pickups
	var files = fs.readdirSync(SNAPSHOTS_DIR).filter(function(f) {
		return f.match(/^contracts-\d{4}\.txt$/);
	}).sort();
	
	var players = {};
	
	files.forEach(function(file) {
		var year = parseInt(file.match(/-([\d]{4})\.txt/)[1]);
		var content = fs.readFileSync(path.join(SNAPSHOTS_DIR, file), 'utf8');
		var lines = content.trim().split('\n');
		
		// Skip header
		for (var i = 1; i < lines.length; i++) {
			var parts = lines[i].split(',');
			if (parts.length < 7) continue;
			
			var id = parts[0];  // Now Sleeper ID (or -1 for historical)
			var owner = parts[1];
			var name = parts[2];
			var position = parts[3];
			var startYear = parts[4] === 'FA' ? null : parseInt(parts[4]);
			var endYear = parseInt(parts[5]);
			var salaryStr = parts[6].replace(/[$,]/g, '');
			var salary = salaryStr ? parseInt(salaryStr) : 1;
			if (isNaN(salary)) salary = 1;
			
			// Skip empty IDs
			if (!id || id === '') continue;
			
			// Strip team hints like "(NO)" for consistent keying
			var baseName = name.replace(/\s*\([^)]+\)\s*$/, '').trim();
			
			// Determine player key:
			// - Valid Sleeper ID: use directly
			// - Historical (-1): use name-based key
			var playerKey;
			var sleeperId = null;
			if (id !== '-1') {
				playerKey = id;
				sleeperId = id;
			} else {
				playerKey = 'historical:' + baseName.toLowerCase();
			}
			
			// Split position on / if needed
			var positionList = position ? position.split('/') : [];
			
			var appearance = {
				year: year,
				owner: owner,
				salary: salary,
				startYear: startYear,
				endYear: endYear
			};
			
			if (!players[playerKey]) {
				players[playerKey] = {
					sleeperId: sleeperId,
					name: name,
					baseName: baseName,
					positions: positionList.slice(),
					appearances: [appearance],
					nameVariants: [name]
				};
			} else {
				players[playerKey].appearances.push(appearance);
				// Merge positions (avoid duplicates)
				positionList.forEach(function(pos) {
					if (pos && !players[playerKey].positions.includes(pos)) {
						players[playerKey].positions.push(pos);
					}
				});
				// Track name variants
				if (!players[playerKey].nameVariants.includes(name)) {
					players[playerKey].nameVariants.push(name);
				}
			}
		}
	});
	
	// Check for name collisions (multiple different players merged into same key)
	var collisions = [];
	Object.keys(players).forEach(function(key) {
		var player = players[key];
		if (key.startsWith('name:') && player.nameVariants.length > 1) {
			// Check if variants are actually different players (not just team hints)
			var uniqueBaseNames = [];
			player.nameVariants.forEach(function(v) {
				var base = v.replace(/\s*\([^)]+\)\s*$/, '').trim().toLowerCase();
				if (!uniqueBaseNames.includes(base)) {
					uniqueBaseNames.push(base);
				}
			});
			if (uniqueBaseNames.length > 1) {
				collisions.push({
					key: key,
					variants: player.nameVariants
				});
			}
		}
	});
	
	if (collisions.length > 0) {
		console.log('\n=== NAME COLLISIONS DETECTED ===');
		collisions.forEach(function(c) {
			console.log('  ' + c.key + ': ' + c.variants.join(', '));
		});
		console.log('These players may be incorrectly merged. Add ESPN IDs or disambiguate in snapshots.\n');
	}
	
	// Sort appearances by year and dedupe (keep last per year - reflects post-trade state)
	Object.keys(players).forEach(function(key) {
		var appearances = players[key].appearances;
		appearances.sort(function(a, b) {
			return a.year - b.year;
		});
		
		// Dedupe by year - keep last appearance for each year
		var deduped = [];
		var lastYear = null;
		for (var i = 0; i < appearances.length; i++) {
			if (appearances[i].year === lastYear) {
				// Same year - replace previous with this one
				deduped[deduped.length - 1] = appearances[i];
			} else {
				deduped.push(appearances[i]);
				lastYear = appearances[i].year;
			}
		}
		players[key].appearances = deduped;
	});
	
	return players;
}

/**
 * Parse postseason snapshots for final FA pickups
 * Returns: { sleeperId: { year: { owner, salary, endYear } } }
 * These are FA pickups where the player ended the season rostered (wasn't cut)
 */
function parsePostseasonFAs() {
	var files = fs.readdirSync(SNAPSHOTS_DIR).filter(function(f) {
		return f.match(/^postseason-\d{4}\.txt$/);
	}).sort();
	
	var faPickups = {};
	
	files.forEach(function(file) {
		var year = parseInt(file.match(/-([\d]{4})\.txt/)[1]);
		var content = fs.readFileSync(path.join(SNAPSHOTS_DIR, file), 'utf8');
		var lines = content.trim().split('\n');
		
		for (var i = 1; i < lines.length; i++) {
			var parts = lines[i].split(',');
			if (parts.length < 7) continue;
			
			var id = parts[0];
			var owner = parts[1];
			var startYear = parts[4] === 'FA' ? null : parseInt(parts[4]);
			var endYear = parseInt(parts[5]);
			var salaryStr = parts[6].replace(/[$,]/g, '');
			var salary = salaryStr ? parseInt(salaryStr) : 1;
			if (isNaN(salary)) salary = 1;
			
			// Only care about FA pickups (startYear === null) with an owner
			if (startYear !== null || !owner) continue;
			if (!id || id === '' || id === '-1') continue;  // Skip historical for now
			
			if (!faPickups[id]) faPickups[id] = {};
			faPickups[id][year] = { owner: owner, salary: salary, endYear: endYear };
		}
	});
	
	return faPickups;
}

/**
 * Helper to format 2-digit year
 */
function yy(year) {
	if (year === null) return 'FA';
	return String(year % 100).padStart(2, '0');
}

/**
 * Build regime transitions from franchiseNames config
 * Returns: { "oldName|newName": transitionYear }
 */
var PSO = require('../../config/pso.js');

function buildRegimeTransitions() {
	var transitions = {};
	
	Object.keys(PSO.franchiseNames).forEach(function(franchiseId) {
		var yearMap = PSO.franchiseNames[franchiseId];
		var years = Object.keys(yearMap).map(Number).sort(function(a, b) { return a - b; });
		
		for (var i = 1; i < years.length; i++) {
			var prevYear = years[i - 1];
			var currYear = years[i];
			var prevName = yearMap[prevYear];
			var currName = yearMap[currYear];
			
			if (prevName !== currName) {
				var key = prevName.toLowerCase() + '|' + currName.toLowerCase();
				transitions[key] = currYear;
			}
		}
	});
	
	return transitions;
}

var REGIME_TRANSITIONS = buildRegimeTransitions();

var EXPANSION_DRAFT_FILE = path.join(__dirname, '../archive/sources/txt/expansion-draft-2012.txt');
var EXPANSION_PROTECTIONS_FILE = path.join(__dirname, '../archive/sources/txt/expansion-draft-protections-2012.txt');

/**
 * Load 2012 expansion draft selections
 * Returns: { "playerName": { toOwner, fromOwner, pick, round } }
 */
function loadExpansionSelections() {
	var content = fs.readFileSync(EXPANSION_DRAFT_FILE, 'utf8');
	var lines = content.trim().split('\n');
	var selections = {};
	
	// Skip header
	for (var i = 1; i < lines.length; i++) {
		var parts = lines[i].split(',');
		if (parts.length < 5) continue;
		
		var pick = parseInt(parts[0]);
		var round = parseInt(parts[1]);
		var toOwner = parts[2].trim();
		var playerName = parts[3].trim();
		var fromOwner = parts[4].trim();
		
		selections[playerName.toLowerCase()] = {
			toOwner: toOwner,
			fromOwner: fromOwner,
			pick: pick,
			round: round
		};
	}
	
	return selections;
}

/**
 * Load 2012 expansion draft protections
 * Returns: { "playerName": { owner, isRfa } }
 */
function loadExpansionProtections() {
	var content = fs.readFileSync(EXPANSION_PROTECTIONS_FILE, 'utf8');
	var lines = content.trim().split('\n');
	var protections = {};
	
	for (var i = 0; i < lines.length; i++) {
		var line = lines[i].trim();
		if (!line || line.startsWith('#')) continue;
		
		// Format: Owner (ID): Player1, Player2 (RFA), Player3, Player4
		var match = line.match(/^([^(]+)\s*\(\d+\):\s*(.+)$/);
		if (!match) continue;
		
		var owner = match[1].trim();
		var playersStr = match[2];
		
		// Split by comma and parse each player
		var players = playersStr.split(',');
		for (var j = 0; j < players.length; j++) {
			var playerStr = players[j].trim();
			var isRfa = playerStr.includes('(RFA)');
			var playerName = playerStr.replace(/\s*\(RFA\)\s*/g, '').trim();
			
			protections[playerName.toLowerCase()] = {
				owner: owner,
				isRfa: isRfa
			};
		}
	}
	
	return protections;
}

var EXPANSION_SELECTIONS_2012 = loadExpansionSelections();
var EXPANSION_PROTECTIONS_2012 = loadExpansionProtections();

/**
 * Check if an owner change is just a regime transition (same franchise)
 */
function isRegimeTransition(oldOwner, newOwner, oldYear, newYear) {
	var key = oldOwner.toLowerCase() + '|' + newOwner.toLowerCase();
	var transitionYear = REGIME_TRANSITIONS[key];
	
	if (transitionYear && newYear >= transitionYear) {
		return true;
	}
	
	return false;
}

/**
 * Check if two regime names are the same franchise (via transition)
 */
function sameRegime(owner1, owner2, year) {
	// Empty owner means no owner (FA) - never the same as any owner
	if (!owner1 || !owner2) return false;
	
	if (owner1.toLowerCase() === owner2.toLowerCase()) return true;
	
	// Check if there's a regime transition between them
	var key1 = owner1.toLowerCase() + '|' + owner2.toLowerCase();
	var key2 = owner2.toLowerCase() + '|' + owner1.toLowerCase();
	
	if (REGIME_TRANSITIONS[key1] && REGIME_TRANSITIONS[key1] <= year) return true;
	if (REGIME_TRANSITIONS[key2] && REGIME_TRANSITIONS[key2] <= year) return true;
	
	// Handle partial matches (Koci vs Koci/Mueller)
	if (owner1.toLowerCase().includes(owner2.toLowerCase()) ||
		owner2.toLowerCase().includes(owner1.toLowerCase())) {
		return true;
	}
	
	return false;
}

/**
 * Find a trade that explains an owner change
 */
function findTrade(sleeperId, playerName, fromYear, toOwner, tradesMap) {
	// Try by Sleeper ID first
	var trades = tradesMap.bySleeperId[sleeperId];
	
	// Fallback to name if no Sleeper ID match
	if (!trades && playerName) {
		// Strip team hints like "(NO)" from name
		var baseName = playerName.replace(/\s*\([^)]+\)\s*$/, '').trim();
		trades = tradesMap.byName[playerName.toLowerCase()];
		if (!trades) {
			trades = tradesMap.byName[baseName.toLowerCase()];
		}
	}
	
	if (!trades) return null;
	
	// Look for a trade to this owner around this time
	for (var i = 0; i < trades.length; i++) {
		var trade = trades[i];
		// Trade should be in the year before or same year as the appearance
		if (trade.year >= fromYear - 1 && trade.year <= fromYear) {
			// Check if owner matches (considering regime transitions)
			if (sameRegime(trade.toOwner, toOwner, fromYear)) {
				return trade;
			}
		}
	}
	return null;
}

/**
 * Find unsigned trade for a player before a given date
 */
function findUnsignedTradeBefore(player, beforeDate, unsignedTrades) {
	var trades = [];
	if (player.sleeperId) {
		trades = unsignedTrades.bySleeperId[player.sleeperId] || [];
	}
	if (trades.length === 0) {
		var nameKey = player.name.toLowerCase().replace(/\s*\([^)]+\)\s*$/, '').trim();
		trades = unsignedTrades.byName[nameKey] || [];
	}
	
	// Find trades before the given date
	for (var i = 0; i < trades.length; i++) {
		var trade = trades[i];
		if (new Date(trade.date) < new Date(beforeDate)) {
			return trade;
		}
	}
	return null;
}

/**
 * Find cuts for a player in the given year range from cutsMap
 */
function findCutsForPlayer(player, fromYear, toYear, cutsMap) {
	var cuts = [];
	
	if (player.sleeperId) {
		cuts = cutsMap.bySleeperId[player.sleeperId] || [];
	}
	
	// Also check by name as fallback (for historical cuts without sleeperId)
	var nameKey = player.name.toLowerCase();
	var nameCuts = cutsMap.byName[nameKey] || [];
	if (nameCuts.length > 0) {
		// Merge, avoiding duplicates (same year + owner)
		var seen = new Set(cuts.map(function(c) { return c.year + ':' + c.owner; }));
		nameCuts.forEach(function(c) {
			var key = c.year + ':' + c.owner;
			if (!seen.has(key)) {
				cuts.push(c);
				seen.add(key);
			}
		});
	}
	
	// Filter to cuts in the year range
	return cuts.filter(function(cut) {
		return cut.year >= fromYear && cut.year <= toYear;
	}).sort(function(a, b) {
		return a.year - b.year;
	});
}

/**
 * Generate all transactions for a player by walking their contract history
 */
function generatePlayerTransactions(player, draftsMap, tradesMap, unsignedTrades, cutsMap, postseasonFAs) {
	var transactions = [];
	var appearances = player.appearances;
	
	if (appearances.length === 0) return transactions;
	
	var prevAppearance = null;
	var prevContractKey = null;  // "startYear|endYear" to detect contract changes
	var processedCuts = new Set();  // Track cuts we've already processed (year:owner)
	
	for (var i = 0; i < appearances.length; i++) {
		var app = appearances[i];
		var contractKey = (app.startYear || 'FA') + '|' + app.endYear;
		
			if (i === 0) {
			// Check for cuts BEFORE the first appearance
			// If first appearance is FA, also include same-year cuts by OTHER owners (they cut, then current owner picked up)
			var cutsBeforeFirstYear = app.startYear === null ? app.year : app.year - 1;
			var cutsBeforeFirst = findCutsForPlayer(player, 2008, cutsBeforeFirstYear, cutsMap);
			
			// Filter to cuts by different owners if checking same year
			if (cutsBeforeFirstYear === app.year) {
				cutsBeforeFirst = cutsBeforeFirst.filter(function(cut) {
					return !app.owner || !cut.owner || cut.owner.toLowerCase() !== app.owner.toLowerCase();
				});
			}
			
			cutsBeforeFirst.forEach(function(cut) {
				var cutKey = cut.year + ':' + cut.owner;
				processedCuts.add(cutKey);
				
				// Generate entry transaction for this cut's owner
				if (cut.startYear === null) {
					// FA pickup - infer it
					transactions.push({
						year: cut.year,
						type: 'fa',
						line: '  ' + yy(cut.year) + ' fa ' + cut.owner + ' $' + cut.salary + ' FA/' + yy(cut.endYear) + ' # inferred from cut'
					});
				} else {
					// Auction contract - generate auction + contract from cut data
					transactions.push({
						year: cut.startYear,
						type: 'auction',
						line: '  ' + yy(cut.startYear) + ' auction ' + cut.owner + ' $' + cut.salary
					});
					transactions.push({
						year: cut.startYear,
						type: 'contract',
						line: '  ' + yy(cut.startYear) + ' contract $' + cut.salary + ' ' + yy(cut.startYear) + '/' + yy(cut.endYear)
					});
				}
				transactions.push({
					year: cut.year,
					type: 'cut',
					offseason: cut.offseason,
					line: '  ' + yy(cut.year) + ' cut # by ' + cut.owner
				});
			});
			
			// First appearance - determine entry transaction(s)
			var entryTxs = determineEntryTransaction(player, app, draftsMap, unsignedTrades);
			entryTxs.forEach(function(tx) { transactions.push(tx); });
			prevContractKey = contractKey;
			prevAppearance = app;
			continue;
		}
		
		// Check for cuts between appearances using explicit cuts.json data
		var cutsInGap = findCutsForPlayer(player, prevAppearance.year, app.year - 1, cutsMap);
		var lastCutYear = null;
		var lastCutOwner = null;
		
		cutsInGap.forEach(function(cut) {
			// Skip if already processed
			var cutKey = cut.year + ':' + cut.owner;
			if (processedCuts.has(cutKey)) return;
			processedCuts.add(cutKey);
			
			// Only infer FA pickup if the cut has an FA contract (startYear === null)
			// If startYear != null, the player was acquired via auction/draft which is already captured
			if (cut.startYear === null) {
				transactions.push({
					year: cut.year,
					type: 'fa',
					line: '  ' + yy(cut.year) + ' fa ' + cut.owner + ' $' + cut.salary + ' FA/' + yy(cut.endYear) + ' # inferred from cut'
				});
			}
			transactions.push({
				year: cut.year,
				type: 'cut',
				offseason: cut.offseason,
				line: '  ' + yy(cut.year) + ' cut # by ' + cut.owner
			});
			lastCutYear = cut.year;
			lastCutOwner = cut.owner;
		});
		
		// Check for expansion draft (2012) - before other checks
		// If player was selected in expansion draft and now appears on expansion team
		var expansionPick = EXPANSION_SELECTIONS_2012[player.name.toLowerCase()];
		var isExpansionPick = expansionPick && app.year === 2012 && 
			sameRegime(app.owner, expansionPick.toOwner, 2012) &&
			sameRegime(prevAppearance.owner, expansionPick.fromOwner, 2011);
		
		if (isExpansionPick) {
			transactions.push({
				year: 2012,
				type: 'expansion',
				line: '  12 expansion ' + expansionPick.toOwner + ' from ' + expansionPick.fromOwner
			});
			// If contract also changed, add the auction + contract after
			if (contractKey !== prevContractKey && app.startYear === app.year) {
				transactions.push({
					year: app.year,
					type: 'auction',
					line: '  ' + yy(app.year) + ' auction ' + app.owner + ' $' + app.salary
				});
				transactions.push({
					year: app.year,
					type: 'contract',
					line: '  ' + yy(app.year) + ' contract $' + app.salary + ' ' + yy(app.startYear) + '/' + yy(app.endYear)
				});
			}
		} else if (contractKey !== prevContractKey) {
			// New contract
			if (app.startYear === null) {
				// FA pickup - only generate if we know the owner
				// FAs with empty owner (cut mid-season) will be handled by cuts logic
				if (app.owner) {
					transactions.push({
						year: app.year,
						type: 'fa',
						line: '  ' + yy(app.year) + ' fa ' + app.owner + ' $' + app.salary + ' FA/' + yy(app.endYear)
					});
				}
			} else if (app.startYear === app.year) {
				// New contract starting this year - auction
				// First check for offseason cut (cut in this year by prev owner before new contract)
				var offseasonCutsThisYear = findCutsForPlayer(player, app.year, app.year, cutsMap);
				offseasonCutsThisYear.forEach(function(cut) {
					var cutKey = cut.year + ':' + cut.owner;
					if (processedCuts.has(cutKey)) return;
					
					// Offseason cut should be by the previous owner (they cut, then player was re-signed)
					if (sameRegime(cut.owner, prevAppearance.owner, cut.year)) {
						processedCuts.add(cutKey);
						transactions.push({
							year: cut.year,
							type: 'cut',
							offseason: cut.offseason,
							line: '  ' + yy(cut.year) + ' cut # by ' + cut.owner
						});
					}
				});
				
				// Check if player was traded unsigned
				var unsignedTrade = findUnsignedTradeToOwner(player, app.owner, app.startYear, unsignedTrades);
				var auctionOwner = unsignedTrade ? unsignedTrade.sender : app.owner;
				var contractDate = unsignedTrade 
					? new Date(new Date(unsignedTrade.date).getTime() + 1).toISOString() 
					: null;
				
				// Always generate separate auction + contract
				transactions.push({
					year: app.year,
					type: 'auction',
					line: '  ' + yy(app.year) + ' auction ' + auctionOwner + ' $' + app.salary
				});
				transactions.push({
					year: app.year,
					date: contractDate,
					type: 'contract',
					line: '  ' + yy(app.year) + ' contract $' + app.salary + ' ' + yy(app.startYear) + '/' + yy(app.endYear)
				});
			} else if (app.startYear > prevAppearance.year) {
				// Contract started after last appearance - auction in startYear
				// First check for offseason cut (cut in startYear by prev owner before new contract)
				var offseasonCuts = findCutsForPlayer(player, app.startYear, app.startYear, cutsMap);
				offseasonCuts.forEach(function(cut) {
					var cutKey = cut.year + ':' + cut.owner;
					if (processedCuts.has(cutKey)) return;
					
					// Offseason cut should be by the previous owner (they cut, then player was re-signed)
					if (sameRegime(cut.owner, prevAppearance.owner, cut.year)) {
						processedCuts.add(cutKey);
						transactions.push({
							year: cut.year,
							type: 'cut',
							offseason: cut.offseason,
							line: '  ' + yy(cut.year) + ' cut # by ' + cut.owner
						});
					}
				});
				
				// Check if player was traded unsigned
				var unsignedTrade = findUnsignedTradeToOwner(player, app.owner, app.startYear, unsignedTrades);
				var auctionOwner = unsignedTrade ? unsignedTrade.sender : app.owner;
				var contractDate = unsignedTrade 
					? new Date(new Date(unsignedTrade.date).getTime() + 1).toISOString() 
					: null;
				
				// Always generate separate auction + contract
				transactions.push({
					year: app.startYear,
					type: 'auction',
					line: '  ' + yy(app.startYear) + ' auction ' + auctionOwner + ' $' + app.salary
				});
				transactions.push({
					year: app.startYear,
					date: contractDate,
					type: 'contract',
					line: '  ' + yy(app.startYear) + ' contract $' + app.salary + ' ' + yy(app.startYear) + '/' + yy(app.endYear)
				});
			}
		} else if (app.owner !== prevAppearance.owner) {
			// Same contract but different owner
			// Skip if either owner is empty (FA status - cuts logic handles this)
			if (!app.owner || !prevAppearance.owner) {
				// Skip - empty owner means player was cut/released
			} else if (isRegimeTransition(prevAppearance.owner, app.owner, prevAppearance.year, app.year)) {
				// Skip - not a real ownership change
			} else {
				// Look for trade
				var trade = findTrade(player.sleeperId, player.name, app.year, app.owner, tradesMap);
				if (trade) {
					transactions.push({
						year: trade.year,
						date: trade.date,
						type: 'trade',
						line: '  ' + yy(trade.year) + ' trade ' + trade.tradeId + ' -> ' + trade.toOwner
					});
				} else {
					transactions.push({
						year: app.year,
						type: 'unknown',
						line: '  ' + yy(app.year) + ' unknown ' + app.owner + '  # owner changed, no trade found'
					});
				}
			}
		}
		
		// Check for expansion protection (2012)
		// Add if player was protected and still with same owner in 2012
		var protection = EXPANSION_PROTECTIONS_2012[player.name.toLowerCase()];
		if (protection && app.year === 2012 && sameRegime(app.owner, protection.owner, 2012)) {
			// Only add if we haven't already added a protection for this player
			var hasProtection = transactions.some(function(t) { return t.type === 'protect'; });
			if (!hasProtection) {
				transactions.push({
					year: 2012,
					type: 'protect',
					line: '  12 protect ' + protection.owner + (protection.isRfa ? ' (RFA)' : '')
				});
			}
		}
		
		prevContractKey = contractKey;
		prevAppearance = app;
	}
	
	// Add expansion pick if player was selected (unconditionally)
	var expansionPick = EXPANSION_SELECTIONS_2012[player.name.toLowerCase()];
	if (!expansionPick) {
		// Try base name without team hints
		var baseName = player.name.replace(/\s*\([^)]+\)\s*$/, '').trim();
		expansionPick = EXPANSION_SELECTIONS_2012[baseName.toLowerCase()];
	}
	if (expansionPick) {
		var hasExpansion = transactions.some(function(t) { return t.type === 'expansion'; });
		if (!hasExpansion) {
			transactions.push({
				year: 2012,
				type: 'expansion',
				line: '  12 expansion ' + expansionPick.toOwner + ' from ' + expansionPick.fromOwner
			});
		}
	}
	
	// Add all trades for this player from trades.json
	// Get trades by sleeperId if available, otherwise by name (for historical players only)
	var playerTrades = [];
	if (player.sleeperId) {
		playerTrades = tradesMap.bySleeperId[player.sleeperId] || [];
	} else {
		// Historical player - match trades by name that also have sleeperId: null
		var baseName = player.name.replace(/\s*\([^)]+\)\s*$/, '').trim();
		var nameTrades = tradesMap.byName[player.name.toLowerCase()] || 
		                 tradesMap.byName[baseName.toLowerCase()] || [];
		playerTrades = nameTrades.filter(function(t) { return t.sleeperId === null; });
	}
	playerTrades.forEach(function(trade) {
		var hasTrade = transactions.some(function(t) { 
			return t.type === 'trade' && t.line.includes('trade ' + trade.tradeId + ' '); 
		});
		if (!hasTrade) {
			transactions.push({
				year: trade.year,
				date: trade.date,
				type: 'trade',
				line: '  ' + yy(trade.year) + ' trade ' + trade.tradeId + ' -> ' + trade.toOwner
			});
		}
	});
	
	// Add final cuts (player was cut and never returned)
	// Find the last OWNED appearance (not FA appearances which are results of cuts)
	var lastOwnedAppearance = null;
	for (var i = appearances.length - 1; i >= 0; i--) {
		if (appearances[i].owner) {
			lastOwnedAppearance = appearances[i];
			break;
		}
	}
	
	// If no owned appearance found, skip final cuts processing
	// (Player only appears as FA in snapshots - handled by cuts-only logic)
	if (!lastOwnedAppearance) {
		lastOwnedAppearance = appearances[appearances.length - 1];
	}
	
	var finalCuts = findCutsForPlayer(player, lastOwnedAppearance.year, 2099, cutsMap);
	var lastFinalCutYear = null;
	var lastFinalCutOwner = null;
	
	finalCuts.forEach(function(cut) {
		// Skip if already processed
		var cutKey = cut.year + ':' + cut.owner;
		if (processedCuts.has(cutKey)) return;
		processedCuts.add(cutKey);
		
		// Only infer FA pickup if the cut has an FA contract (startYear === null)
		// If startYear != null, the player was acquired via auction/draft which is already captured
		if (cut.startYear === null) {
			transactions.push({
				year: cut.year,
				type: 'fa',
				line: '  ' + yy(cut.year) + ' fa ' + cut.owner + ' $' + cut.salary + ' FA/' + yy(cut.endYear) + ' # inferred from cut'
			});
		}
		transactions.push({
			year: cut.year,
			type: 'cut',
			offseason: cut.offseason,
			line: '  ' + yy(cut.year) + ' cut # by ' + cut.owner
		});
		lastFinalCutYear = cut.year;
		lastFinalCutOwner = cut.owner;
	});
	
	// Add postseason FA pickups (player ended season rostered, wasn't cut)
	if (player.sleeperId && postseasonFAs[player.sleeperId]) {
		var playerPostseasonFAs = postseasonFAs[player.sleeperId];
		Object.keys(playerPostseasonFAs).forEach(function(yearStr) {
			var year = parseInt(yearStr);
			var fa = playerPostseasonFAs[year];
			
			// Check if we already have an FA transaction for this year/owner
			var alreadyHasFA = transactions.some(function(t) {
				return t.year === year && t.type === 'fa' && t.line.includes(' fa ' + fa.owner + ' ');
			});
			
			if (!alreadyHasFA) {
				transactions.push({
					year: year,
					type: 'fa',
					line: '  ' + yy(year) + ' fa ' + fa.owner + ' $' + fa.salary + ' FA/' + yy(fa.endYear)
				});
			}
		});
	}
	
	// Sort transactions by year, then by type priority, then by date
	// Priority: offseason cut → draft/auction → contract → trade → in-season cut → fa (postseason)
	var typePriority = {
		'protect': 0,
		'cut-offseason': 1,
		'draft': 2,
		'auction': 2,
		'contract': 3,
		'expansion': 4,
		'trade': 5,
		'cut': 6,
		'fa': 7,
		'unknown': 8
	};
	transactions.sort(function(a, b) {
		if (a.year !== b.year) return a.year - b.year;
		// Sort by type priority first (offseason cuts get treated as cut-offseason)
		var aType = (a.type === 'cut' && a.offseason) ? 'cut-offseason' : a.type;
		var bType = (b.type === 'cut' && b.offseason) ? 'cut-offseason' : b.type;
		var aPri = typePriority[aType] !== undefined ? typePriority[aType] : 10;
		var bPri = typePriority[bType] !== undefined ? typePriority[bType] : 10;
		if (aPri !== bPri) return aPri - bPri;
		// Within same type, sort by date if available
		if (a.date && b.date) return new Date(a.date) - new Date(b.date);
		return 0;
	});
	
	return transactions;
}

/**
 * Determine the entry transaction(s) for a player's first appearance
 * Returns array of transactions (usually 1, but can be more for unsigned trades)
 */
function determineEntryTransaction(player, app, draftsMap, unsignedTrades) {
	var year = app.year;
	var startYear = app.startYear;
	var endYear = app.endYear;
	var salary = app.salary;
	var owner = app.owner;
	
	// Check if player was drafted - try sleeperId first, then name
	var draftInfo = null;
	if (player.sleeperId && startYear) {
		var sleeperKey = player.sleeperId + '|' + startYear;
		draftInfo = draftsMap.bySleeperId[sleeperKey];
	}
	if (!draftInfo && startYear) {
		var nameKey = player.baseName.toLowerCase() + '|' + startYear;
		draftInfo = draftsMap.byName[nameKey];
	}
	
	if (draftInfo) {
		// We have draft data for this player
		var teamsCount = draftInfo.season < 2012 ? 10 : 12;
		var pickInRound = draftInfo.pick - (draftInfo.round - 1) * teamsCount;
		var results = [{
			year: draftInfo.season,
			type: 'draft',
			line: '  ' + yy(draftInfo.season) + ' draft ' + draftInfo.owner + ' ' + draftInfo.round + '.' + String(pickInRound).padStart(2, '0')
		}];
		
		// Check if drafted player was traded unsigned before signing
		if (startYear && draftInfo.owner !== owner) {
			var unsignedTrade = findUnsignedTradeToOwner(player, owner, startYear, unsignedTrades);
			if (unsignedTrade) {
				// Contract date is 1ms after trade to ensure proper sorting
				var contractDate = new Date(new Date(unsignedTrade.date).getTime() + 1).toISOString();
				results.push({
					year: startYear,
					date: contractDate,
					type: 'contract',
					line: '  ' + yy(startYear) + ' contract $' + salary + ' ' + yy(startYear) + '/' + yy(endYear)
				});
			}
		} else if (startYear && endYear) {
			// Player stayed with drafter - add contract line
			results.push({
				year: startYear,
				type: 'contract',
				line: '  ' + yy(startYear) + ' contract $' + salary + ' ' + yy(startYear) + '/' + yy(endYear)
			});
		}
		return results;
	} else if (startYear === null) {
		// FA contract - picked up as free agent
		// Skip if no owner (will be handled by cuts logic)
		if (!owner) {
			return [];
		}
		return [{
			year: year,
			type: 'fa',
			line: '  ' + yy(year) + ' fa ' + owner + ' $' + salary + ' FA/' + yy(endYear)
		}];
	} else if (startYear <= year) {
		// Contract started this year or before - auction from startYear
		// Skip if no owner (will be handled by cuts logic)
		if (!owner) {
			return [];
		}
		// Check if player was traded unsigned
		var unsignedTrade = findUnsignedTradeToOwner(player, owner, startYear, unsignedTrades);
		if (unsignedTrade) {
			// Auction went to sender, contract to receiver (current owner)
			// Contract date is 1ms after trade to ensure proper sorting
			var contractDate = new Date(new Date(unsignedTrade.date).getTime() + 1).toISOString();
			return [
				{
					year: startYear,
					type: 'auction',
					line: '  ' + yy(startYear) + ' auction ' + unsignedTrade.sender + ' $' + salary
				},
				{
					year: startYear,
					date: contractDate,
					type: 'contract',
					line: '  ' + yy(startYear) + ' contract $' + salary + ' ' + yy(startYear) + '/' + yy(endYear)
				}
			];
		}
		// Always separate auction + contract
		return [
			{
				year: startYear,
				type: 'auction',
				line: '  ' + yy(startYear) + ' auction ' + owner + ' $' + salary
			},
			{
				year: startYear,
				type: 'contract',
				line: '  ' + yy(startYear) + ' contract $' + salary + ' ' + yy(startYear) + '/' + yy(endYear)
			}
		];
	} else {
		// startYear > year - shouldn't happen, but default to auction + contract
		return [
			{
				year: startYear,
				type: 'auction',
				line: '  ' + yy(startYear) + ' auction ' + owner + ' $' + salary
			},
			{
				year: startYear,
				type: 'contract',
				line: '  ' + yy(startYear) + ' contract $' + salary + ' ' + yy(startYear) + '/' + yy(endYear)
			}
		];
	}
}

/**
 * Find unsigned trade where player went to a specific owner in a specific year
 */
function findUnsignedTradeToOwner(player, toOwner, year, unsignedTrades) {
	var trades = [];
	if (player.sleeperId) {
		trades = unsignedTrades.bySleeperId[player.sleeperId] || [];
	}
	if (trades.length === 0) {
		var nameKey = player.name.toLowerCase().replace(/\s*\([^)]+\)\s*$/, '').trim();
		trades = unsignedTrades.byName[nameKey] || [];
	}
	
	for (var i = 0; i < trades.length; i++) {
		var trade = trades[i];
		if (trade.year === year && sameRegime(trade.receiver, toOwner, year)) {
			return trade;
		}
	}
	return null;
}

/**
 * Format player header
 */
function formatHeader(player) {
	var parts = [player.name, player.positions.join('/')];
	
	// Add Sleeper ID if available
	if (player.sleeperId) {
		parts.push('sleeper:' + player.sleeperId);
	} else {
		// Mark as historical if not in Sleeper
		parts.push('historical');
	}
	
	return parts.join(' | ');
}

/**
 * Generate DSL content
 */
function generateDSL() {
	console.log('Loading draft data...');
	var draftsMap = loadDrafts();
	console.log('  ' + Object.keys(draftsMap.bySleeperId).length + ' by Sleeper ID, ' + Object.keys(draftsMap.byName).length + ' by name\n');
	
	console.log('Loading trades...');
	var tradesMap = loadTrades();
	console.log('  ' + Object.keys(tradesMap.bySleeperId).length + ' by Sleeper ID, ' + Object.keys(tradesMap.byName).length + ' by name');
	
	var unsignedTrades = loadUnsignedTrades();
	console.log('  ' + Object.keys(unsignedTrades.bySleeperId).length + ' unsigned by Sleeper ID, ' + Object.keys(unsignedTrades.byName).length + ' unsigned by name\n');
	
	console.log('Loading cuts...');
	var cutsMap = loadCuts();
	console.log('  ' + Object.keys(cutsMap.bySleeperId).length + ' by Sleeper ID, ' + Object.keys(cutsMap.byName).length + ' by name (historical)\n');
	
	console.log('Loading postseason FAs...');
	var postseasonFAs = parsePostseasonFAs();
	console.log('  ' + Object.keys(postseasonFAs).length + ' players with postseason FA pickups\n');
	
	console.log('Parsing snapshots...');
	var players = parseSnapshots();
	var playerKeys = Object.keys(players);
	console.log('  ' + playerKeys.length + ' players found\n');
	
	// Sort players by name
	playerKeys.sort(function(a, b) {
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
	
	// Collect all player entries (header + transactions)
	var playerEntries = [];
	
	// Generate entries from snapshots
	playerKeys.forEach(function(key) {
		var player = players[key];
		var header = formatHeader(player);
		var transactions = generatePlayerTransactions(player, draftsMap, tradesMap, unsignedTrades, cutsMap, postseasonFAs);
		
		var entryLines = [header];
		transactions.forEach(function(tx) {
			entryLines.push(tx.line);
		});
		
		playerEntries.push({
			name: player.name,
			lines: entryLines
		});
	});
	
	// Add players only in cuts.json (never in any snapshot)
	var cutsOnlyCount = 0;
	Object.keys(cutsMap.bySleeperId).forEach(function(sleeperId) {
		// Skip if player already exists in DSL
		if (players[sleeperId]) return;
		
		var cuts = cutsMap.bySleeperId[sleeperId];
		if (!cuts || cuts.length === 0) return;
		
		// Use first cut for player info
		var firstCut = cuts[0];
		var name = firstCut.name;
		var position = firstCut.position || 'Unknown';
		
		var entryLines = [name + ' | ' + position + ' | sleeper:' + sleeperId];
		
		// Sort cuts by year
		cuts.sort(function(a, b) { return a.year - b.year; });
		
		// Generate acquisitions and cuts
		cuts.forEach(function(cut) {
			if (cut.startYear === null) {
				// FA pickup - infer it
				entryLines.push('  ' + yy(cut.year) + ' fa ' + cut.owner + ' $' + cut.salary + ' FA/' + yy(cut.endYear) + ' # inferred from cut');
			} else {
				// Auction contract - generate auction + contract from cut data
				entryLines.push('  ' + yy(cut.startYear) + ' auction ' + cut.owner + ' $' + cut.salary);
				entryLines.push('  ' + yy(cut.startYear) + ' contract $' + cut.salary + ' ' + yy(cut.startYear) + '/' + yy(cut.endYear));
			}
			entryLines.push('  ' + yy(cut.year) + ' cut # by ' + cut.owner);
		});
		
		playerEntries.push({
			name: name,
			lines: entryLines
		});
		cutsOnlyCount++;
	});
	
	// Also add players from cuts.json who have no sleeperId and no snapshot appearances
	var processedNames = new Set();
	Object.keys(cutsMap.byName).forEach(function(nameKey) {
		var cuts = cutsMap.byName[nameKey];
		if (!cuts || cuts.length === 0) return;
		
		// Skip if any of these cuts have a sleeperId (already handled above)
		if (cuts.some(function(c) { return c.sleeperId; })) return;
		
		// Skip if player exists in DSL by name
		var playerName = cuts[0].name;
		var nameExists = playerEntries.some(function(p) {
			return p.name.toLowerCase() === playerName.toLowerCase();
		});
		if (nameExists) return;
		if (processedNames.has(nameKey)) return;
		processedNames.add(nameKey);
		
		var position = cuts[0].position || 'Unknown';
		var entryLines = [playerName + ' | ' + position + ' | historical'];
		
		cuts.sort(function(a, b) { return a.year - b.year; });
		
		// Generate acquisitions and cuts
		cuts.forEach(function(cut) {
			if (cut.startYear === null) {
				// FA pickup - infer it
				entryLines.push('  ' + yy(cut.year) + ' fa ' + cut.owner + ' $' + cut.salary + ' FA/' + yy(cut.endYear) + ' # inferred from cut');
			} else {
				// Auction contract - generate auction + contract from cut data
				entryLines.push('  ' + yy(cut.startYear) + ' auction ' + cut.owner + ' $' + cut.salary);
				entryLines.push('  ' + yy(cut.startYear) + ' contract $' + cut.salary + ' ' + yy(cut.startYear) + '/' + yy(cut.endYear));
			}
			entryLines.push('  ' + yy(cut.year) + ' cut # by ' + cut.owner);
		});
		
		playerEntries.push({
			name: playerName,
			lines: entryLines
		});
		cutsOnlyCount++;
	});
	
	if (cutsOnlyCount > 0) {
		console.log('  Added ' + cutsOnlyCount + ' players from cuts.json (not in snapshots)');
	}
	
	// Sort all entries by player name
	playerEntries.sort(function(a, b) {
		return a.name.localeCompare(b.name);
	});
	
	// Output sorted entries
	playerEntries.forEach(function(entry) {
		entry.lines.forEach(function(line) {
			lines.push(line);
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
