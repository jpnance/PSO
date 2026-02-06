/**
 * Chronological Builder
 * 
 * Builds player transaction history one season at a time, starting from 2008.
 * Every player must have a legal state before proceeding to the next season.
 * 
 * Usage:
 *   node data/analysis/chronological-builder.js
 *   node data/analysis/chronological-builder.js --year=2008
 *   node data/analysis/chronological-builder.js --player="Reggie Bush"
 */

var fs = require('fs');
var path = require('path');

// =============================================================================
// Configuration
// =============================================================================

var FIRST_SEASON = 2008;
var CURRENT_SEASON = 2025;

var PATHS = {
	snapshots: path.join(__dirname, '../archive/snapshots'),
	cuts: path.join(__dirname, '../cuts/cuts.json'),
	trades: path.join(__dirname, '../trades/trades.json')
};

// =============================================================================
// Player State
// =============================================================================

var STATES = {
	AVAILABLE: 'available',
	ROSTERED: 'rostered',
	RFA_HELD: 'rfa-held'
};

/**
 * Player state tracker.
 * Maps normalized player name → { state, franchiseId, contract, history }
 */
var players = {};

function getPlayer(name) {
	var key = normalizeName(name);
	if (!players[key]) {
		players[key] = {
			name: name,
			state: STATES.AVAILABLE,
			franchiseId: null,
			contract: null,
			history: []
		};
	}
	return players[key];
}

function normalizeName(name) {
	return name.toLowerCase()
		.replace(/[^a-z\s]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

// =============================================================================
// Data Loaders
// =============================================================================

/**
 * Load contract snapshot for a given year.
 * Returns array of { player, franchise, salary, startYear, endYear, position, playerId }
 */
function loadSnapshot(year) {
	var filePath = path.join(PATHS.snapshots, 'contracts-' + year + '.txt');
	
	if (!fs.existsSync(filePath)) {
		console.log('  No snapshot for ' + year);
		return [];
	}
	
	var content = fs.readFileSync(filePath, 'utf8');
	var lines = content.trim().split('\n');
	var results = [];
	
	for (var i = 0; i < lines.length; i++) {
		var line = lines[i].trim();
		if (!line || line.startsWith('ID,')) continue; // Skip header
		
		// Format: ID,Owner,Name,Position,Start,End,Salary
		// Handle quoted fields (e.g., "Ted Ginn, Jr.")
		var parts = parseCSVLine(line);
		if (parts.length < 7) continue;
		
		var playerId = parts[0];
		var owner = parts[1];
		var player = parts[2];
		var position = parts[3];
		var startYear = parseInt(parts[4]) || year;
		var endYear = parseInt(parts[5]) || year;
		var salary = parseInt(parts[6].replace('$', '')) || 0;
		
		results.push({
			playerId: playerId,
			player: player,
			position: position,
			franchise: owner,
			salary: salary,
			startYear: startYear,
			endYear: endYear
		});
	}
	
	return results;
}

/**
 * Parse a CSV line handling quoted fields.
 */
function parseCSVLine(line) {
	var result = [];
	var current = '';
	var inQuotes = false;
	
	for (var i = 0; i < line.length; i++) {
		var char = line[i];
		
		if (char === '"') {
			inQuotes = !inQuotes;
		} else if (char === ',' && !inQuotes) {
			result.push(current.trim());
			current = '';
		} else {
			current += char;
		}
	}
	result.push(current.trim());
	
	return result;
}

/**
 * Load cuts for a given year.
 * Returns array of { player, franchise, salary, startYear, endYear, cutYear }
 */
function loadCuts(year) {
	if (!fs.existsSync(PATHS.cuts)) {
		return [];
	}
	
	var allCuts = JSON.parse(fs.readFileSync(PATHS.cuts, 'utf8'));
	return allCuts.filter(function(c) {
		return c.cutYear === year;
	}).map(function(c) {
		return {
			player: c.name,
			position: c.position,
			franchise: c.owner,
			salary: c.salary,
			startYear: c.startYear,
			endYear: c.endYear,
			cutYear: c.cutYear,
			type: 'cut'
		};
	});
}

/**
 * Load trades for a given year.
 */
function loadTrades(year) {
	if (!fs.existsSync(PATHS.trades)) {
		return [];
	}
	
	var allTrades = JSON.parse(fs.readFileSync(PATHS.trades, 'utf8'));
	return allTrades.filter(function(t) {
		var tradeYear = new Date(t.timestamp).getFullYear();
		return tradeYear === year;
	});
}

/**
 * Look ahead at future facts to inform current decisions.
 * e.g., seeing a cut in 2009 tells us about a 2008 contract.
 */
function lookAheadForContract(playerName, upToYear) {
	if (!fs.existsSync(PATHS.cuts)) {
		return null;
	}
	
	var allCuts = JSON.parse(fs.readFileSync(PATHS.cuts, 'utf8'));
	var normalized = normalizeName(playerName);
	
	// Find earliest cut for this player
	var playerCuts = allCuts.filter(function(c) {
		return normalizeName(c.name) === normalized;
	}).sort(function(a, b) {
		return a.cutYear - b.cutYear;
	});
	
	if (playerCuts.length > 0) {
		var cut = playerCuts[0];
		if (cut.startYear && cut.startYear <= upToYear) {
			return {
				salary: cut.salary,
				startYear: cut.startYear,
				endYear: cut.endYear,
				source: 'cut in ' + cut.cutYear
			};
		}
	}
	
	return null;
}

// =============================================================================
// Season Processor
// =============================================================================

function processSeason(year, isFirstSeason) {
	console.log('\n========================================');
	console.log('SEASON ' + year);
	console.log('========================================\n');
	
	// Load facts for this year
	var snapshot = loadSnapshot(year);
	var cuts = loadCuts(year);
	var trades = loadTrades(year);
	
	console.log('Facts loaded:');
	console.log('  Snapshot contracts:', snapshot.length);
	console.log('  Cuts:', cuts.length);
	console.log('  Trades:', trades.length);
	console.log('');
	
	var issues = [];
	
	// Build expected state from snapshot
	var snapshotByPlayer = {};
	snapshot.forEach(function(s) {
		var key = normalizeName(s.player);
		snapshotByPlayer[key] = s;
	});
	
	// Build cuts lookup
	var cutsByPlayer = {};
	cuts.forEach(function(c) {
		var key = normalizeName(c.player);
		if (!cutsByPlayer[key]) cutsByPlayer[key] = [];
		cutsByPlayer[key].push(c);
	});
	
	if (isFirstSeason) {
		// First season: establish initial state from snapshot
		console.log('--- Establishing Initial State ---');
		
		snapshot.forEach(function(s) {
			var player = getPlayer(s.player);
			player.playerId = s.playerId;
			player.state = STATES.ROSTERED;
			player.franchiseId = s.franchise;
			player.contract = {
				salary: s.salary,
				startYear: s.startYear,
				endYear: s.endYear
			};
			player.history.push({
				year: year,
				type: 'auction',
				franchise: s.franchise,
				contract: player.contract
			});
		});
		
		console.log('Established ' + snapshot.length + ' players from ' + year + ' snapshot');
		
	} else {
		// Subsequent seasons: reconcile current state with snapshot
		console.log('--- Reconciling State ---');
		
		var newPlayers = [];
		var auctionRfa = [];
		var continued = [];
		var cutPlayers = [];
		var missingPlayers = [];
		
		// Step 1: Process players in the snapshot (end-of-year state)
		console.log('\nProcessing snapshot (end-of-year rosters)...');
		
		snapshot.forEach(function(s) {
			var key = normalizeName(s.player);
			var player = getPlayer(s.player);
			player.playerId = player.playerId || s.playerId;
			
			if (player.state === STATES.AVAILABLE) {
				// Player in snapshot but we have them as available
				// They must have been acquired this year
				
				if (s.startYear === year) {
					// Contract started this year - auction or draft
					player.history.push({
						year: year,
						type: 'auction',
						franchise: s.franchise,
						contract: { salary: s.salary, startYear: s.startYear, endYear: s.endYear }
					});
					newPlayers.push({ name: s.player, type: 'auction', contract: s.startYear + '-' + s.endYear });
				} else {
					// Contract started earlier - FA pickup with existing contract
					player.history.push({
						year: year,
						type: 'fa-inferred',
						franchise: s.franchise,
						contract: { salary: s.salary, startYear: s.startYear, endYear: s.endYear },
						note: 'Contract started ' + s.startYear
					});
					newPlayers.push({ name: s.player, type: 'fa', contract: s.startYear + '-' + s.endYear });
				}
				
				player.state = STATES.ROSTERED;
				player.franchiseId = s.franchise;
				player.contract = { salary: s.salary, startYear: s.startYear, endYear: s.endYear };
				
			} else if (player.state === STATES.RFA_HELD) {
				// Player was RFA, now rostered - auction resolution
				player.state = STATES.ROSTERED;
				player.franchiseId = s.franchise;
				player.contract = { salary: s.salary, startYear: s.startYear, endYear: s.endYear };
				player.history.push({
					year: year,
					type: 'auction-rfa',
					franchise: s.franchise,
					contract: player.contract
				});
				auctionRfa.push(s.player);
				
			} else if (player.state === STATES.ROSTERED) {
				// Already rostered - check for ownership change
				if (player.franchiseId !== s.franchise) {
					player.history.push({
						year: year,
						type: 'ownership-change',
						fromFranchise: player.franchiseId,
						toFranchise: s.franchise
					});
				}
				player.franchiseId = s.franchise;
				player.contract = { salary: s.salary, startYear: s.startYear, endYear: s.endYear };
				continued.push(s.player);
			}
		});
		
		// Step 2: Process cuts - explains players who were rostered but left
		console.log('\nProcessing cuts...');
		
		cuts.forEach(function(c) {
			var key = normalizeName(c.player);
			var player = getPlayer(c.player);
			var wasInSnapshot = snapshotByPlayer[key];
			
			if (wasInSnapshot) {
				// Player is in snapshot AND in cuts - they were cut then re-acquired
				// The acquisition was already handled above
				// Just note the cut happened
				player.history.push({
					year: year,
					type: 'cut-then-reacquired',
					cutBy: c.franchise,
					contract: { salary: c.salary, startYear: c.startYear, endYear: c.endYear }
				});
				cutPlayers.push({ name: c.player, reacquired: true });
			} else {
				// Player was cut and NOT in snapshot - they're gone
				
				if (player.state === STATES.ROSTERED || player.state === STATES.RFA_HELD) {
					// We had them, they were cut
					player.history.push({
						year: year,
						type: 'cut',
						franchise: c.franchise,
						contract: { salary: c.salary, startYear: c.startYear, endYear: c.endYear }
					});
					player.state = STATES.AVAILABLE;
					player.franchiseId = null;
					player.contract = null;
					cutPlayers.push({ name: c.player, reacquired: false });
				} else {
					// We didn't have them - they were acquired then cut same year
					// Infer the acquisition
					player.history.push({
						year: year,
						type: 'acquired-then-cut',
						franchise: c.franchise,
						contract: { salary: c.salary, startYear: c.startYear, endYear: c.endYear },
						note: 'Inferred acquisition from cut record'
					});
					player.state = STATES.AVAILABLE;
					cutPlayers.push({ name: c.player, acquiredThenCut: true });
				}
			}
		});
		
		// Step 3: Check for players we have rostered who disappeared
		console.log('\nChecking for unexplained departures...');
		
		Object.keys(players).forEach(function(key) {
			var player = players[key];
			if (player.state !== STATES.ROSTERED) return;
			
			var inSnapshot = snapshotByPlayer[key];
			var wasCut = cutsByPlayer[key];
			
			if (!inSnapshot && !wasCut) {
				// Player was rostered, not in snapshot, not in cuts
				// Contract may have expired, or unexplained departure
				if (player.contract && player.contract.endYear < year) {
					// Contract already expired - this shouldn't happen
					missingPlayers.push(player.name + ' (contract expired ' + player.contract.endYear + ')');
				} else {
					missingPlayers.push(player.name);
				}
			}
		});
		
		// Summary
		console.log('\n  New acquisitions:', newPlayers.length);
		var auctionCount = newPlayers.filter(function(p) { return p.type === 'auction'; }).length;
		var faCount = newPlayers.filter(function(p) { return p.type === 'fa'; }).length;
		console.log('    Auction:', auctionCount);
		console.log('    FA (inferred):', faCount);
		
		console.log('  RFA resolutions:', auctionRfa.length);
		console.log('  Continued:', continued.length);
		console.log('  Cuts:', cutPlayers.length);
		var reacquired = cutPlayers.filter(function(p) { return p.reacquired; }).length;
		var acquiredThenCut = cutPlayers.filter(function(p) { return p.acquiredThenCut; }).length;
		if (reacquired > 0) console.log('    (reacquired after cut:', reacquired + ')');
		if (acquiredThenCut > 0) console.log('    (acquired then cut same year:', acquiredThenCut + ')');
		
		if (missingPlayers.length > 0) {
			console.log('\n  *** UNEXPLAINED DEPARTURES:', missingPlayers.length, '(inferring cuts) ***');
			missingPlayers.slice(0, 15).forEach(function(p) { console.log('    ' + p); });
			if (missingPlayers.length > 15) {
				console.log('    ... and', missingPlayers.length - 15, 'more');
			}
			
			// Infer cuts for unexplained departures so we can proceed
			missingPlayers.forEach(function(playerInfo) {
				var playerName = playerInfo.split(' (')[0]; // Strip notes
				var key = normalizeName(playerName);
				var player = players[key];
				if (player && player.state === STATES.ROSTERED) {
					player.history.push({
						year: year,
						type: 'cut-inferred',
						franchise: player.franchiseId,
						note: 'Unexplained departure - inferred cut'
					});
					player.state = STATES.AVAILABLE;
					player.franchiseId = null;
					player.contract = null;
				}
			});
		}
	}
	
	// End of season processing
	console.log('\n--- End of Season ---');
	var expirations = 0;
	var rfaConversions = 0;
	
	Object.keys(players).forEach(function(key) {
		var player = players[key];
		if (player.state !== STATES.ROSTERED) return;
		if (!player.contract) return;
		
		if (player.contract.endYear === year) {
			// Contract expires
			// Pre-2019: all rostered players get RFA rights
			// 2019+: only multi-year contracts get RFA
			var contractLength = player.contract.endYear - player.contract.startYear + 1;
			var getsRfa = year < 2019 || contractLength >= 2;
			
			if (getsRfa) {
				player.state = STATES.RFA_HELD;
				player.history.push({
					year: year,
					type: 'rfa-conversion',
					franchise: player.franchiseId
				});
				rfaConversions++;
			} else {
				player.state = STATES.AVAILABLE;
				player.franchiseId = null;
				player.history.push({
					year: year,
					type: 'contract-expiry'
				});
				expirations++;
			}
			player.contract = null;
		}
	});
	
	console.log('Contract expirations:', expirations);
	console.log('RFA conversions:', rfaConversions);
	
	// Summary
	var stateCounts = { available: 0, rostered: 0, 'rfa-held': 0 };
	Object.keys(players).forEach(function(key) {
		stateCounts[players[key].state]++;
	});
	
	console.log('\n--- Season ' + year + ' Summary ---');
	console.log('Total players tracked:', Object.keys(players).length);
	console.log('  Available:', stateCounts.available);
	console.log('  Rostered:', stateCounts.rostered);
	console.log('  RFA held:', stateCounts['rfa-held']);
	
	if (issues.length > 0) {
		console.log('\n*** ' + issues.length + ' ISSUES NEED RESOLUTION ***');
		issues.slice(0, 10).forEach(function(i) {
			console.log('  ' + i.player + ': ' + i.message);
		});
		return false;
	}
	
	return true;
}

// =============================================================================
// Main
// =============================================================================

function run() {
	var args = process.argv.slice(2);
	var targetYear = null;
	var targetPlayer = null;
	
	args.forEach(function(arg) {
		if (arg.startsWith('--year=')) {
			targetYear = parseInt(arg.split('=')[1]);
		}
		if (arg.startsWith('--player=')) {
			targetPlayer = arg.split('=')[1];
		}
	});
	
	var startYear = targetYear || FIRST_SEASON;
	var endYear = targetYear || CURRENT_SEASON;
	
	console.log('Chronological Builder');
	console.log('Starting from season', startYear);
	console.log('');
	
	for (var year = startYear; year <= endYear; year++) {
		var isFirstSeason = (year === FIRST_SEASON);
		var ok = processSeason(year, isFirstSeason);
		if (!ok && !targetYear) {
			console.log('\nStopping at ' + year + ' due to unresolved issues.');
			console.log('Resolve issues before proceeding to ' + (year + 1) + '.');
			break;
		}
	}
	
	// If looking for specific player
	if (targetPlayer) {
		var player = getPlayer(targetPlayer);
		console.log('\n--- Player: ' + targetPlayer + ' ---');
		console.log('Current state:', player.state);
		console.log('Franchise:', player.franchiseId);
		console.log('Contract:', JSON.stringify(player.contract));
		console.log('History:');
		player.history.forEach(function(h) {
			console.log('  ' + h.year + ': ' + h.type + (h.franchise ? ' (' + h.franchise + ')' : ''));
		});
	}
}

run();
