var dotenv = require('dotenv').config({ path: __dirname + '/../../.env' });
var mongoose = require('mongoose');
var request = require('superagent');
var readline = require('readline');

var Player = require('../../models/Player');
var Franchise = require('../../models/Franchise');
var Transaction = require('../../models/Transaction');
var PSO = require('../../config/pso.js');
var resolver = require('../utils/player-resolver');

var sheetLink = 'https://sheets.googleapis.com/v4/spreadsheets/1nas3AqWZtCu_UZIV77Jgxd9oriF1NQjzSjFWW86eong/values/Cuts';

mongoose.connect(process.env.MONGODB_URI);

// Global readline interface and player lookup
var rl = null;
var playersByNormalizedName = {};

// Nickname expansions for matching
var nicknameMap = {
	'matt': 'matthew',
	'mike': 'michael',
	'rob': 'robert',
	'bob': 'robert',
	'bobby': 'robert',
	'will': 'william',
	'bill': 'william',
	'billy': 'william',
	'jim': 'james',
	'jimmy': 'james',
	'joe': 'joseph',
	'joey': 'joseph',
	'dan': 'daniel',
	'danny': 'daniel',
	'dave': 'david',
	'chris': 'christopher',
	'alex': 'alexander',
	'nick': 'nicholas',
	'tony': 'anthony',
	'tom': 'thomas',
	'tommy': 'thomas',
	'steve': 'steven',
	'stevie': 'steven',
	'ben': 'benjamin',
	'benny': 'benjamin',
	'ted': 'theodore',
	'teddy': 'theodore',
	'sam': 'samuel',
	'sammy': 'samuel',
	'jake': 'jacob',
	'zach': 'zachary',
	'zack': 'zachary',
	'josh': 'joshua',
	'drew': 'andrew',
	'andy': 'andrew',
	'rich': 'richard',
	'rick': 'richard',
	'dick': 'richard',
	'ed': 'edward',
	'eddie': 'edward',
	'pat': 'patrick',
	'ken': 'kenneth',
	'kenny': 'kenneth',
	'greg': 'gregory',
	'jeff': 'jeffrey',
	'jon': 'jonathan',
	'johnny': 'john',
	'charlie': 'charles',
	'chuck': 'charles',
	'larry': 'lawrence',
	'fred': 'frederick',
	'freddy': 'frederick',
	'frank': 'francis',
	'frankie': 'francis',
	'ron': 'ronald',
	'ronnie': 'ronald',
	'ray': 'raymond',
	'wes': 'wesley',
	'gabe': 'gabriel',
	'manny': 'manuel',
	'cj': 'c.j.',
	'dj': 'd.j.',
	'tj': 't.j.',
	'aj': 'a.j.',
	'jj': 'j.j.',
	'pj': 'p.j.',
	'rj': 'r.j.',
	'bj': 'b.j.',
	'kj': 'k.j.'
};

function getSleeperRosterId(ownerName) {
	return PSO.franchiseIds[ownerName];
}

// Parse --auto-historical-before=YEAR flag
function getAutoHistoricalThreshold() {
	var flag = process.argv.find(function(arg) {
		return arg.startsWith('--auto-historical-before=');
	});
	if (flag) {
		return parseInt(flag.split('=')[1]);
	}
	return null;
}

// Parse names with disambiguation hints like "Brandon Marshall (DEN)"
function parseNameWithHint(rawName) {
	var match = rawName.match(/^(.+?)\s*\(([^)]+)\)$/);
	if (match) {
		return {
			name: match[1].trim(),
			hint: match[2].trim(),
			raw: rawName
		};
	}
	return {
		name: rawName,
		hint: null,
		raw: rawName
	};
}

async function fetchCutsData() {
	var response = await request
		.get(sheetLink)
		.query({ alt: 'json', key: process.env.GOOGLE_API_KEY });

	var dataJson = JSON.parse(response.text);
	return dataJson.values;
}

// Compute buy-outs for a cut
// Contract years get 60%/30%/15% for year 1/2/3 of contract
// Only years >= cutYear incur buy-outs (prior years were paid as salary)
function computeBuyOuts(salary, startYear, endYear, cutYear) {
	var buyOuts = [];
	var percentages = [0.60, 0.30, 0.15];
	
	// For FA contracts (single year), startYear === endYear
	if (startYear === null) {
		startYear = endYear;
	}
	
	for (var year = startYear; year <= endYear; year++) {
		var contractYearIndex = year - startYear; // 0, 1, or 2
		if (contractYearIndex >= percentages.length) break; // Max 3 years
		
		if (year >= cutYear) {
			var amount = Math.ceil(salary * percentages[contractYearIndex]);
			if (amount > 0) {
				buyOuts.push({ season: year, amount: amount });
			}
		}
	}
	
	return buyOuts;
}

// Find player match for analysis (uses DB player lookup)
function findPlayerMatch(name, position, hint, rawName) {
	var lookupName = hint ? rawName : name;
	var normalizedName = resolver.normalizePlayerName(lookupName);
	
	// Check resolver cache first
	var cached = resolver.lookup(lookupName, { position: position });
	if (cached && !cached.ambiguous) {
		return {
			type: cached.sleeperId ? 'cached' : 'historical',
			sleeperId: cached.sleeperId,
			name: cached.name
		};
	}
	
	// Get candidates from DB lookup
	var candidates = playersByNormalizedName[normalizedName] || [];
	
	// Also try without hint if no candidates
	if (candidates.length === 0 && hint) {
		var plainNormalized = resolver.normalizePlayerName(name);
		candidates = playersByNormalizedName[plainNormalized] || [];
	}
	
	// Filter by position
	var positionMatches = candidates.filter(function(p) {
		return p.positions && p.positions.includes(position);
	});
	
	// Check if ambiguous
	var isAmbiguous = resolver.isAmbiguous(normalizedName) || !!hint;
	
	if (positionMatches.length === 1 && !isAmbiguous) {
		return { type: 'exact', playerId: positionMatches[0]._id };
	}
	
	if (positionMatches.length > 1 || isAmbiguous) {
		return { type: 'ambiguous', matches: positionMatches, hint: hint };
	}
	
	if (candidates.length === 1 && !isAmbiguous) {
		return { type: 'exact-no-pos', playerId: candidates[0]._id };
	}
	
	if (candidates.length > 1) {
		return { type: 'ambiguous', matches: candidates, hint: hint };
	}
	
	// No match found
	return { type: 'not-found', hint: hint };
}

async function analyzeCuts(rows) {
	console.log('\nAnalyzing cuts data...\n');
	
	// Skip first 2 header rows
	var cuts = [];
	
	for (var i = 2; i < rows.length; i++) {
		var row = rows[i];
		
		// Skip empty rows
		if (!row[1]) continue;
		
		// Parse columns:
		// 0: Owner, 1: Name, 2: Position, 3: Start, 4: End, 5: Last (salary), 6: Cut year
		var owner = row[0];
		var rawName = row[1];
		var parsed = parseNameWithHint(rawName);
		var position = row[2];
		var startYear = row[3] === 'FA' ? null : parseInt(row[3]);
		var endYear = parseInt(row[4]);
		var salary = parseInt((row[5] || '').replace(/[$,]/g, '')) || 0;
		var cutYear = parseInt(row[6]);
		
		// Compute buy-outs
		var buyOuts = computeBuyOuts(salary, startYear, endYear, cutYear);
		
		cuts.push({
			owner: owner,
			rawName: rawName,
			name: parsed.name,
			hint: parsed.hint,
			position: position,
			startYear: startYear,
			endYear: endYear,
			salary: salary,
			cutYear: cutYear,
			buyOuts: buyOuts
		});
	}
	
	console.log('Total cuts found:', cuts.length);
	console.log('Year range:', cuts[0]?.cutYear, '-', cuts[cuts.length - 1]?.cutYear);
	
	// Analyze each cut
	var stats = {
		cached: 0,
		historical: 0,
		exact: 0,
		hintMatch: 0,
		nickname: 0,
		ambiguous: 0,
		notFound: 0
	};
	
	var wouldCreateHistorical = [];
	var ambiguousNames = [];
	var seenHistorical = {};  // Track unique historical players
	var seenAmbiguous = {};   // Track unique ambiguous names
	
	for (var i = 0; i < cuts.length; i++) {
		var cut = cuts[i];
		var result = findPlayerMatch(cut.name, cut.position, cut.hint, cut.rawName);
		
		switch (result.type) {
			case 'cached':
				stats.cached++;
				break;
			case 'historical':
				stats.historical++;
				break;
			case 'exact':
			case 'exact-no-pos':
				stats.exact++;
				break;
			case 'hint-match':
				stats.hintMatch++;
				break;
			case 'nickname':
				stats.nickname++;
				break;
			case 'ambiguous':
				stats.ambiguous++;
				var ambigKey = cut.name + '|' + cut.position;
				if (!seenAmbiguous[ambigKey]) {
					seenAmbiguous[ambigKey] = true;
					ambiguousNames.push({
						name: cut.name,
						hint: cut.hint,
						position: cut.position,
						year: cut.cutYear,
						matchCount: result.matches ? result.matches.length : 0
					});
				}
				break;
			case 'not-found':
				stats.notFound++;
				var histKey = cut.name + '|' + cut.position;
				if (!seenHistorical[histKey]) {
					seenHistorical[histKey] = true;
					wouldCreateHistorical.push({
						name: cut.name,
						hint: cut.hint,
						position: cut.position,
						year: cut.cutYear,
						owner: cut.owner
					});
				}
				break;
		}
	}
	
	console.log('\n--- Resolution Summary ---');
	console.log('Already cached (resolved):', stats.cached);
	console.log('Already marked historical:', stats.historical);
	console.log('Exact Sleeper match:', stats.exact);
	console.log('Hint-based match:', stats.hintMatch);
	console.log('Nickname expansion match:', stats.nickname);
	console.log('Ambiguous (need prompt):', stats.ambiguous, '(' + ambiguousNames.length + ' unique)');
	console.log('Not found (would create historical):', stats.notFound, '(' + wouldCreateHistorical.length + ' unique)');
	
	if (process.argv.includes('--dry-run')) {
		if (wouldCreateHistorical.length > 0) {
			// Group by year
			var byYear = {};
			wouldCreateHistorical.forEach(function(p) {
				if (!byYear[p.year]) byYear[p.year] = [];
				byYear[p.year].push(p);
			});
			
			var years = Object.keys(byYear).map(Number).sort(function(a, b) { return b - a; }); // newest first
			
			console.log('\n--- Not Found by Year (' + wouldCreateHistorical.length + ' unique) ---');
			years.forEach(function(year) {
				console.log('  ' + year + ': ' + byYear[year].length);
			});
			
			console.log('\n--- Would Create Historical Players (newest first) ---');
			years.forEach(function(year) {
				console.log('\n  ' + year + ':');
				byYear[year].forEach(function(p) {
					var hintStr = p.hint ? ' [hint: ' + p.hint + ']' : '';
					console.log('    ' + p.name + ' (' + p.position + ')' + hintStr);
				});
			});
		}
		
		if (ambiguousNames.length > 0) {
			console.log('\n--- Ambiguous Names (need prompt) (' + ambiguousNames.length + ' unique) ---');
			ambiguousNames.forEach(function(p) {
				var hintStr = p.hint ? ' [hint: ' + p.hint + ']' : '';
				console.log('  ' + p.name + ' (' + p.position + ') - ' + p.matchCount + ' matches' + hintStr);
			});
		}
	}
	
	return { cuts, stats, wouldCreateHistorical, ambiguousNames };
}

// Resolve a player using unified prompt
async function resolvePlayer(cut, autoHistoricalThreshold) {
	var context = {
		year: cut.cutYear,
		type: 'cut',
		franchise: cut.owner
	};
	
	// Use the name with hint if present (for unique resolution)
	var lookupName = cut.hint ? cut.rawName : cut.name;
	var normalizedName = resolver.normalizePlayerName(lookupName);
	var candidates = playersByNormalizedName[normalizedName] || [];
	
	// Also try without hint if no candidates found
	if (candidates.length === 0 && cut.hint) {
		var plainNormalized = resolver.normalizePlayerName(cut.name);
		candidates = playersByNormalizedName[plainNormalized] || [];
	}
	
	// For auto-historical threshold, skip prompting for old cuts with no candidates
	if (autoHistoricalThreshold && cut.cutYear < autoHistoricalThreshold) {
		// Check cache first
		var cached = resolver.lookup(lookupName, context);
		if (cached && cached.sleeperId) {
			var player = await Player.findOne({ sleeperId: cached.sleeperId });
			if (player) return { playerId: player._id };
		}
		if (cached && cached.name) {
			var player = await Player.findOne({ name: cached.name, sleeperId: null });
			if (player) return { playerId: player._id };
		}
		
		// Single non-ambiguous match
		if (candidates.length === 1 && !resolver.isAmbiguous(normalizedName)) {
			return { playerId: candidates[0]._id };
		}
		
		// No match - auto-create historical
		if (candidates.length === 0) {
			var existing = await Player.findOne({ name: cut.name, sleeperId: null });
			if (existing) {
				resolver.addResolution(lookupName, null, cut.name, context);
				resolver.save();
				return { playerId: existing._id };
			}
			
			console.log('  Auto-creating historical: ' + cut.name + ' (' + cut.position + ')');
			var player = await Player.create({
				name: cut.name,
				positions: cut.position ? [cut.position] : [],
				sleeperId: null
			});
			resolver.addResolution(lookupName, null, cut.name, context);
			resolver.save();
			return { playerId: player._id };
		}
	}
	
	// Use unified prompt
	var result = await resolver.promptForPlayer({
		name: lookupName,
		context: context,
		candidates: candidates,
		position: cut.position,
		Player: Player,
		rl: rl,
		playerCache: playersByNormalizedName
	});
	
	if (result.action === 'quit') {
		console.log('\nQuitting...');
		rl.close();
		resolver.save();
		await mongoose.disconnect();
		process.exit(130);
	}
	
	if (result.action === 'skipped' || !result.player) {
		return { playerId: null };
	}
	
	return { playerId: result.player._id };
}

async function run() {
	console.log('Fetching cuts data from spreadsheet...');
	console.log('Loaded', resolver.count(), 'cached player resolutions');
	
	// Create readline interface
	rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout
	});
	
	// Load all players and build lookup
	var allPlayers = await Player.find({});
	allPlayers.forEach(function(p) {
		var normalized = resolver.normalizePlayerName(p.name);
		if (!playersByNormalizedName[normalized]) {
			playersByNormalizedName[normalized] = [];
		}
		playersByNormalizedName[normalized].push(p);
	});
	console.log('Loaded', allPlayers.length, 'players from database');
	
	var rows = await fetchCutsData();
	
	// Show first few rows to understand format
	if (process.argv.includes('--show-format')) {
		console.log('\n--- First 20 rows ---');
		rows.slice(0, 20).forEach(function(row, i) {
			console.log(i + ':', JSON.stringify(row));
		});
		rl.close();
		process.exit(0);
	}
	
	var analysis = await analyzeCuts(rows);
	
	// If just dry-run, exit here
	if (process.argv.includes('--dry-run')) {
		rl.close();
		process.exit(0);
	}
	
	// Actual seeding
	var autoHistoricalThreshold = getAutoHistoricalThreshold();
	if (autoHistoricalThreshold) {
		console.log('\nAuto-creating historical players for cuts before ' + autoHistoricalThreshold);
	}
	
	var clearExisting = process.argv.includes('--clear');
	if (clearExisting) {
		console.log('Clearing existing FA cut transactions...');
		await Transaction.deleteMany({ type: 'fa', adds: { $size: 0 } });
	}
	
	// Load franchises
	var franchises = await Franchise.find({});
	var franchiseByRosterId = {};
	franchises.forEach(function(f) {
		franchiseByRosterId[f.rosterId] = f._id;
	});
	
	console.log('\nProcessing ' + analysis.cuts.length + ' cuts...\n');
	
	var created = 0;
	var skipped = 0;
	var errors = [];
	var fixupRefCounter = 1;  // Sequential ID for fixup targeting
	
	for (var i = 0; i < analysis.cuts.length; i++) {
		var cut = analysis.cuts[i];
		
		// Find franchise
		var rosterId = getSleeperRosterId(cut.owner);
		if (!rosterId) {
			errors.push({ player: cut.name, reason: 'Unknown owner: ' + cut.owner });
			skipped++;
			continue;
		}
		
		var franchiseId = franchiseByRosterId[rosterId];
		if (!franchiseId) {
			errors.push({ player: cut.name, reason: 'No franchise for rosterId: ' + rosterId });
			skipped++;
			continue;
		}
		
		// Resolve player
		var resolution = await resolvePlayer(cut, autoHistoricalThreshold);
		
		var playerId = resolution.playerId;
		if (!playerId && resolution.sleeperId) {
			var player = await Player.findOne({ sleeperId: resolution.sleeperId });
			playerId = player?._id;
		}
		
		if (!playerId) {
			errors.push({ player: cut.name, reason: 'Could not resolve player' });
			skipped++;
			continue;
		}
		
		// Create FA transaction (drop only)
		try {
			await Transaction.create({
				type: 'fa',
				timestamp: new Date(Date.UTC(cut.cutYear, 0, 15, 12, 0, 0)), // Jan 15 noon UTC - placeholder date in dead period
				source: 'snapshot',
				franchiseId: franchiseId,
				adds: [],
				drops: [{
					playerId: playerId,
					salary: cut.salary,
					startYear: cut.startYear,
					endYear: cut.endYear,
					buyOuts: cut.buyOuts
				}],
				fixupRef: fixupRefCounter++
			});
			created++;
		} catch (err) {
			if (err.code === 11000) {
				skipped++;
			} else {
				throw err;
			}
		}
		
		// Progress
		if ((i + 1) % 100 === 0) {
			console.log('  Processed ' + (i + 1) + '/' + analysis.cuts.length + '...');
		}
	}
	
	// Save resolutions
	resolver.save();
	
	console.log('\nDone!');
	console.log('  Created:', created);
	console.log('  Skipped:', skipped);
	
	if (errors.length > 0) {
		console.log('\nErrors:');
		errors.slice(0, 20).forEach(function(e) {
			console.log('  -', e.player + ':', e.reason);
		});
		if (errors.length > 20) {
			console.log('  ... and', errors.length - 20, 'more');
		}
	}
	
	rl.close();
	process.exit(0);
}

run().catch(function(err) {
	rl.close();
	console.error('Error:', err);
	process.exit(1);
});
