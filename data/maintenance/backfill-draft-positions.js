/**
 * Backfill draftedPositions and salary for draft-select transactions.
 * 
 * Uses contracts-YEAR.txt snapshots to determine what positions a player
 * had at the time they were drafted, rather than their current positions.
 * 
 * Usage:
 *   node data/maintenance/backfill-draft-positions.js           # Update all transactions
 *   node data/maintenance/backfill-draft-positions.js --diff    # Show picks where position differs
 */

var fs = require('fs');
var path = require('path');
var mongoose = require('mongoose');

var Pick = require('../../models/Pick');
var Player = require('../../models/Player');
var Transaction = require('../../models/Transaction');
var resolver = require('../utils/player-resolver');

var ARCHIVE_DIR = path.join(__dirname, '../archive/snapshots');

// First-round rookie salaries by year and position (from services/draft.js)
var rookieSalaries = {
	'2026': { 'DB': 2, 'DL': 2, 'K': 1, 'LB': 1, 'QB': 40, 'RB': 20, 'TE': 11, 'WR': 17 },
	'2025': { 'DB': 2, 'DL': 2, 'K': 1, 'LB': 1, 'QB': 44, 'RB': 21, 'TE': 9, 'WR': 16 },
	'2024': { 'DB': 2, 'DL': 2, 'K': 1, 'LB': 1, 'QB': 40, 'RB': 23, 'TE': 9, 'WR': 16 },
	'2023': { 'DB': 2, 'DL': 2, 'K': 2, 'LB': 1, 'QB': 30, 'RB': 25, 'TE': 14, 'WR': 16 },
	'2022': { 'DB': 1, 'DL': 2, 'K': 2, 'LB': 1, 'QB': 37, 'RB': 25, 'TE': 8, 'WR': 16 },
	'2021': { 'DB': 1, 'DL': 2, 'K': 1, 'LB': 1, 'QB': 29, 'RB': 25, 'TE': 5, 'WR': 16 },
	'2020': { 'DB': 2, 'DL': 1, 'K': 1, 'LB': 1, 'QB': 32, 'RB': 25, 'TE': 7, 'WR': 16 },
	'2019': { 'DB': 1, 'DL': 2, 'K': 1, 'LB': 1, 'QB': 38, 'RB': 25, 'TE': 10, 'WR': 16 },
	'2018': { 'DB': 2, 'DL': 3, 'K': 2, 'LB': 2, 'QB': 28, 'RB': 25, 'TE': 14, 'WR': 18 },
	'2017': { 'DB': 2, 'DL': 2, 'K': 2, 'LB': 1, 'QB': 31, 'RB': 24, 'TE': 17, 'WR': 18 },
	'2016': { 'DB': 2, 'DL': 3, 'K': 1, 'LB': 2, 'QB': 32, 'RB': 25, 'TE': 15, 'WR': 17 },
	'2015': { 'DB': 2, 'DL': 3, 'K': 1, 'LB': 1, 'QB': 24, 'RB': 27, 'TE': 15, 'WR': 17 },
	'2014': { 'DB': 2, 'DL': 2, 'K': 2, 'LB': 1, 'QB': 19, 'RB': 24, 'TE': 28, 'WR': 19 },
	'2013': { 'DB': 2, 'DL': 3, 'K': 1, 'LB': 2, 'QB': 17, 'RB': 26, 'TE': 18, 'WR': 18 },
	'2012': { 'DB': 1, 'DL': 1, 'K': 1, 'LB': 1, 'QB': 25, 'RB': 25, 'TE': 7, 'WR': 16 },
	'2011': { 'DB': 1, 'DL': 1, 'K': 1, 'LB': 2, 'QB': 25, 'RB': 25, 'TE': 3, 'WR': 26 },
	'2010': { 'DB': 1, 'DL': 2, 'K': 1, 'LB': 2, 'QB': 24, 'RB': 28, 'TE': 4, 'WR': 15 },
	'2009': { 'DB': 12.4, 'DL': 13.4, 'K': 2.2, 'LB': 14, 'QB': 124.5, 'RB': 270.2, 'TE': 53, 'WR': 137.3 }
};

// Calculate rookie salary for a given season, round, and positions
function getRookieSalary(season, round, positions) {
	var yearSalaries = rookieSalaries[String(season)];
	if (!yearSalaries || !positions || positions.length === 0) return null;
	
	var maxBase = 0;
	for (var i = 0; i < positions.length; i++) {
		var pos = positions[i];
		var base = yearSalaries[pos] || 0;
		if (base > maxBase) maxBase = base;
	}
	
	if (maxBase === 0) return null;
	
	// 2009 uses linear decay: 100% in round 1 down to 10% in round 10
	// 2010+ uses exponential halving: value / 2^(round-1)
	if (season <= 2009) {
		return Math.ceil(maxBase * (11 - round) / 10);
	} else {
		return Math.ceil(maxBase / Math.pow(2, round - 1));
	}
}

// Normalize position strings to our standard format
function normalizePosition(pos) {
	if (!pos) return null;
	pos = pos.toUpperCase().trim();
	
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

// Load position and salary data from a snapshot file (contracts or postseason)
function loadSnapshotFile(filePath) {
	if (!fs.existsSync(filePath)) {
		return null;
	}
	
	var content = fs.readFileSync(filePath, 'utf8');
	var lines = content.trim().split('\n');
	var playerData = {};
	
	// Skip header: ID,Owner,Name,Position,Start,End,Salary
	for (var i = 1; i < lines.length; i++) {
		var cols = lines[i].split(',');
		if (cols.length < 4) continue;
		
		var playerName = cols[2].trim();
		var positionStr = cols[3].trim();
		var salaryStr = cols.length >= 7 ? cols[6].trim() : '';
		
		// Parse salary (remove $ and convert to number)
		var salary = null;
		if (salaryStr && salaryStr !== '') {
			salary = parseInt(salaryStr.replace('$', ''), 10);
			if (isNaN(salary)) salary = null;
		}
		
		if (playerName && positionStr) {
			var normalized = resolver.normalizePlayerName(playerName);
			// Split compound positions (e.g., "DL/LB") and normalize each
			var positions = positionStr.split('/').map(function(p) {
				return normalizePosition(p.trim());
			}).filter(function(p) {
				return p !== null;
			});
			if (positions.length > 0) {
				playerData[normalized] = {
					positions: positions,
					salary: salary
				};
			}
		}
	}
	
	return playerData;
}

// Load position data from contracts file for a specific year
function loadContractsFile(season) {
	return loadSnapshotFile(path.join(ARCHIVE_DIR, 'contracts-' + season + '.txt'));
}

// Load position data from postseason file for a specific year
function loadPostseasonFile(season) {
	return loadSnapshotFile(path.join(ARCHIVE_DIR, 'postseason-' + season + '.txt'));
}

// Get player data from a source, returning null if not found
function getPlayerFromSource(sourceData, normalizedName) {
	if (!sourceData) return null;
	return sourceData[normalizedName] || null;
}

// Format positions array for display
function formatPositions(positions) {
	if (!positions || positions.length === 0) return '(not found)';
	return positions.join('/');
}

// Format source entry for display (positions + salary if available)
function formatSourceEntry(playerData) {
	if (!playerData) return '(not found)';
	var posStr = formatPositions(playerData.positions);
	if (playerData.salary !== null) {
		posStr += ' @ $' + playerData.salary;
	}
	return posStr;
}

// Compare two position arrays for equality
function positionsEqual(a, b) {
	if (!a && !b) return true;
	if (!a || !b) return false;
	if (a.length !== b.length) return false;
	var sortedA = a.slice().sort();
	var sortedB = b.slice().sort();
	for (var i = 0; i < sortedA.length; i++) {
		if (sortedA[i] !== sortedB[i]) return false;
	}
	return true;
}

// Format pick number as round.slot
function formatPickNumber(pickNumber, round, season) {
	var picksPerRound = (season <= 2011) ? 10 : 12;
	if (!pickNumber) return 'R' + round;
	var slot = pickNumber - (round - 1) * picksPerRound;
	return round + '.' + String(slot).padStart(2, '0');
}

async function run() {
	var diffMode = process.argv.includes('--diff');
	
	if (diffMode) {
		console.log('=== DIFF MODE: Showing picks where position differs ===\n');
	}
	
	await mongoose.connect(process.env.MONGODB_URI || 'mongodb://mongo:27017/pso');
	
	// Load all draft-select transactions
	var transactions = await Transaction.find({ type: 'draft-select' }).lean();
	console.log('Found ' + transactions.length + ' draft-select transactions\n');
	
	// Load all picks and players for reference
	var pickIds = transactions.map(function(t) { return t.pickId; });
	var playerIds = transactions.map(function(t) { return t.playerId; });
	
	var picks = await Pick.find({ _id: { $in: pickIds } }).lean();
	var pickMap = {};
	picks.forEach(function(p) {
		pickMap[p._id.toString()] = p;
	});
	
	var players = await Player.find({ _id: { $in: playerIds } }).lean();
	var playerMap = {};
	players.forEach(function(p) {
		playerMap[p._id.toString()] = p;
	});
	
	// Cache snapshot files by year and type
	var contractsCache = {};
	var postseasonCache = {};
	
	function getContracts(year) {
		if (contractsCache[year] === undefined) {
			contractsCache[year] = loadContractsFile(year);
		}
		return contractsCache[year];
	}
	
	function getPostseason(year) {
		if (postseasonCache[year] === undefined) {
			postseasonCache[year] = loadPostseasonFile(year);
		}
		return postseasonCache[year];
	}
	
	var updated = 0;
	var diffs = [];
	var notFound = [];
	
	for (var i = 0; i < transactions.length; i++) {
		var txn = transactions[i];
		var pick = pickMap[txn.pickId.toString()];
		var player = playerMap[txn.playerId.toString()];
		
		if (!pick || !player) {
			notFound.push({ txn: txn, reason: 'Missing pick or player' });
			continue;
		}
		
		var season = pick.season;
		var round = pick.round;
		var normalizedName = resolver.normalizePlayerName(player.name);
		
		// Primary source: contracts file for draft year
		var sourceData = getContracts(season);
		
		if (!sourceData) {
			notFound.push({ txn: txn, player: player.name, reason: 'No contracts file for ' + season });
			continue;
		}
		
		var primaryPlayerData = getPlayerFromSource(sourceData, normalizedName);
		
		if (!primaryPlayerData) {
			notFound.push({ txn: txn, player: player.name, season: season, reason: 'Player not in contracts file' });
			continue;
		}
		
		var historicalPositions = primaryPlayerData.positions;
		var salary = getRookieSalary(season, round, historicalPositions);
		var currentPositions = player.positions || [];
		
		if (diffMode) {
			// Only report if positions differ from current
			if (!positionsEqual(historicalPositions, currentPositions)) {
				var currentSalary = getRookieSalary(season, round, currentPositions);
				
				// Cross-reference multiple sources
				var sources = [];
				
				// contracts-YEAR (primary)
				sources.push({
					name: 'contracts-' + season,
					data: primaryPlayerData
				});
				
				// postseason-YEAR
				var postseasonData = getPostseason(season);
				sources.push({
					name: 'postseason-' + season,
					data: getPlayerFromSource(postseasonData, normalizedName)
				});
				
				// contracts-YEAR+1
				var nextYearData = getContracts(season + 1);
				sources.push({
					name: 'contracts-' + (season + 1),
					data: getPlayerFromSource(nextYearData, normalizedName)
				});
				
				// contracts-YEAR+2
				var twoYearsData = getContracts(season + 2);
				sources.push({
					name: 'contracts-' + (season + 2),
					data: getPlayerFromSource(twoYearsData, normalizedName)
				});
				
				// Determine consensus
				var positionCounts = {};
				var sourcesWithData = 0;
				sources.forEach(function(s) {
					if (s.data && s.data.positions) {
						sourcesWithData++;
						var key = s.data.positions.slice().sort().join('/');
						positionCounts[key] = (positionCounts[key] || 0) + 1;
					}
				});
				
				var consensusPosition = null;
				var maxCount = 0;
				Object.keys(positionCounts).forEach(function(pos) {
					if (positionCounts[pos] > maxCount) {
						maxCount = positionCounts[pos];
						consensusPosition = pos;
					}
				});
				
				var allAgree = Object.keys(positionCounts).length === 1;
				
				diffs.push({
					season: season,
					pickDisplay: formatPickNumber(pick.pickNumber, round, season),
					playerName: player.name,
					currentPositions: currentPositions,
					currentSalary: currentSalary,
					historicalPositions: historicalPositions,
					historicalSalary: salary,
					sources: sources,
					consensus: consensusPosition,
					sourcesWithData: sourcesWithData,
					allAgree: allAgree
				});
			}
		} else {
			// Update the transaction
			await Transaction.updateOne(
				{ _id: txn._id },
				{ $set: { draftedPositions: historicalPositions, salary: salary } }
			);
			updated++;
		}
	}
	
	if (diffMode) {
		// Sort by season, then pick
		diffs.sort(function(a, b) {
			if (a.season !== b.season) return a.season - b.season;
			return a.pickDisplay.localeCompare(b.pickDisplay);
		});
		
		if (diffs.length === 0) {
			console.log('No position differences found.');
		} else {
			console.log('Found ' + diffs.length + ' picks with position differences:\n');
			diffs.forEach(function(d) {
				console.log(d.season + ' ' + d.pickDisplay + ': ' + d.playerName);
				console.log('  Current:    ' + (d.currentPositions.join('/') || '(none)') + ' ($' + (d.currentSalary || '?') + ')');
				console.log('  Historical: ' + d.historicalPositions.join('/') + ' ($' + d.historicalSalary + ')');
				console.log('  Sources:');
				d.sources.forEach(function(s) {
					var displayStr = formatSourceEntry(s.data);
					var marker = '';
					if (s.data && s.data.positions) {
						var matches = positionsEqual(s.data.positions, d.historicalPositions);
						marker = matches ? ' ✓' : ' ✗';
					}
					console.log('    ' + s.name + ': ' + displayStr + marker);
				});
				if (d.allAgree) {
					console.log('  Consensus: ' + d.consensus + ' (' + d.sourcesWithData + '/' + d.sourcesWithData + ' sources agree)');
				} else {
					console.log('  Warning: sources disagree on position');
				}
				console.log('');
			});
		}
	} else {
		console.log('\n=== Summary ===');
		console.log('Updated: ' + updated + ' transactions');
	}
	
	if (notFound.length > 0) {
		console.log('\nWarnings (' + notFound.length + ' picks):');
		notFound.slice(0, 20).forEach(function(nf) {
			console.log('  - ' + (nf.player || 'Unknown') + ': ' + nf.reason);
		});
		if (notFound.length > 20) {
			console.log('  ... and ' + (notFound.length - 20) + ' more');
		}
	}
	
	await mongoose.disconnect();
}

run().catch(function(err) {
	console.error(err);
	process.exit(1);
});
