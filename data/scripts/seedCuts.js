var dotenv = require('dotenv').config({ path: __dirname + '/../../.env' });
var mongoose = require('mongoose');
var request = require('superagent');
var readline = require('readline');

var Player = require('../../models/Player');
var Franchise = require('../../models/Franchise');
var Transaction = require('../../models/Transaction');
var PSO = require('../../pso.js');
var resolver = require('./playerResolver');

var sleeperData = Object.values(require('../../public/data/sleeper-data.json'));

var sheetLink = 'https://sheets.googleapis.com/v4/spreadsheets/1nas3AqWZtCu_UZIV77Jgxd9oriF1NQjzSjFWW86eong/values/Cuts';

mongoose.connect(process.env.MONGODB_URI);

var rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout
});

function prompt(question) {
	return new Promise(function(resolve) {
		rl.question(question, resolve);
	});
}

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

// Find player in Sleeper data (returns match info, doesn't create anything)
function findSleeperMatch(name, position, hint) {
	var searchName = name.replace(/[\. '-]/g, '').toLowerCase();
	
	// Check resolver cache first
	var cached = resolver.lookup(name, { position: position });
	
	if (cached && !cached.ambiguous) {
		return {
			type: cached.sleeperId ? 'cached' : 'historical',
			sleeperId: cached.sleeperId,
			name: cached.name
		};
	}
	
	// If there's a hint, this name is implicitly ambiguous
	var implicitlyAmbiguous = !!hint;
	
	// Search Sleeper data
	var matches = sleeperData.filter(function(p) {
		return p.search_full_name === searchName;
	});
	
	// Filter by position if we have matches
	var positionMatches = matches.filter(function(p) {
		return p.fantasy_positions && p.fantasy_positions.includes(position);
	});
	
	// If hint is a team abbreviation, filter/prioritize by team
	if (hint && positionMatches.length > 1) {
		var teamMatches = positionMatches.filter(function(p) {
			return p.team === hint;
		});
		if (teamMatches.length === 1) {
			return { type: 'hint-match', sleeperId: teamMatches[0].player_id, player: teamMatches[0], hint: hint };
		}
	}
	
	if (positionMatches.length === 1 && !cached && !implicitlyAmbiguous) {
		return { type: 'exact', sleeperId: positionMatches[0].player_id, player: positionMatches[0] };
	}
	
	if (positionMatches.length > 1 || (cached && cached.ambiguous) || implicitlyAmbiguous) {
		return { type: 'ambiguous', matches: positionMatches.length > 0 ? positionMatches : matches, hint: hint };
	}
	
	if (matches.length === 1) {
		return { type: 'exact-no-pos', sleeperId: matches[0].player_id, player: matches[0] };
	}
	
	if (matches.length > 1) {
		return { type: 'ambiguous', matches: matches, hint: hint };
	}
	
	// Try nickname expansion
	var parts = name.toLowerCase().split(' ');
	var firstName = parts[0];
	var expandedFirst = nicknameMap[firstName];
	
	if (expandedFirst) {
		var expandedSearchName = (expandedFirst + parts.slice(1).join('')).replace(/[\. '-]/g, '');
		var expandedMatches = sleeperData.filter(function(p) {
			return p.search_full_name === expandedSearchName;
		});
		
		if (expandedMatches.length === 1) {
			return { type: 'nickname', sleeperId: expandedMatches[0].player_id, player: expandedMatches[0], expandedName: expandedFirst + ' ' + parts.slice(1).join(' ') };
		}
		
		if (expandedMatches.length > 1) {
			return { type: 'ambiguous', matches: expandedMatches, hint: hint };
		}
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
		var result = findSleeperMatch(cut.name, cut.position, cut.hint);
		
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

// Resolve a player - may prompt interactively or auto-create historical
async function resolvePlayer(cut, autoHistoricalThreshold, createdHistoricalThisRun) {
	var result = findSleeperMatch(cut.name, cut.position, cut.hint);
	
	// Already cached with Sleeper ID
	if (result.type === 'cached') {
		var player = await Player.findOne({ sleeperId: result.sleeperId });
		return { type: 'cached', sleeperId: result.sleeperId, playerId: player?._id };
	}
	
	// Already marked as historical - look up by name
	if (result.type === 'historical') {
		var player = await Player.findOne({ name: result.name, historical: true });
		if (player) {
			return { type: 'historical', playerId: player._id };
		}
		// Historical player not found in DB - need to create
		// Fall through to not-found handling
		result = { type: 'not-found', hint: cut.hint };
	}
	
	// Check if we already created this historical player earlier in this run
	var histKey = cut.name.toLowerCase() + '|' + cut.position;
	if (createdHistoricalThisRun && createdHistoricalThisRun[histKey]) {
		return { type: 'already-created', playerId: createdHistoricalThisRun[histKey] };
	}
	
	// Exact match - cache and return
	if (result.type === 'exact' || result.type === 'exact-no-pos' || result.type === 'hint-match' || result.type === 'nickname') {
		resolver.addResolution(cut.name, result.sleeperId);
		return result;
	}
	
	// Not found - check if we should auto-create historical
	if (result.type === 'not-found') {
		if (autoHistoricalThreshold && cut.cutYear < autoHistoricalThreshold) {
			// Auto-create historical player
			console.log('  Auto-creating historical: ' + cut.name + ' (' + cut.position + ', ' + cut.cutYear + ')');
			var player = await Player.create({
				name: cut.name,
				positions: [cut.position],
				historical: true
			});
			resolver.addResolution(cut.name, null, cut.name);
			
			// Track so we don't create again this run
			if (createdHistoricalThisRun) {
				createdHistoricalThisRun[histKey] = player._id;
			}
			
			return { type: 'auto-historical', playerId: player._id };
		}
		
		// Need to prompt
		console.log('\n⚠️  No Sleeper match for: ' + cut.name + ' (' + cut.position + ', cut ' + cut.cutYear + ')');
		if (cut.hint) console.log('   Hint from spreadsheet: ' + cut.hint);
		
		var choice = await prompt('Enter Sleeper ID, or press Enter to create historical: ');
		
		if (choice.trim()) {
			var sleeperId = choice.trim();
			resolver.addResolution(cut.name, sleeperId);
			var player = await Player.findOne({ sleeperId: sleeperId });
			return { type: 'manual', sleeperId: sleeperId, playerId: player?._id };
		} else {
			// Create historical
			var displayName = await prompt('Display name (Enter for "' + cut.name + '"): ');
			displayName = displayName.trim() || cut.name;
			
			var player = await Player.create({
				name: displayName,
				positions: [cut.position],
				historical: true
			});
			resolver.addResolution(cut.name, null, displayName);
			
			// Track so we don't create again this run
			if (createdHistoricalThisRun) {
				createdHistoricalThisRun[histKey] = player._id;
			}
			
			return { type: 'created-historical', playerId: player._id };
		}
	}
	
	// Ambiguous - need to prompt
	if (result.type === 'ambiguous') {
		console.log('\n⚠️  Ambiguous: ' + cut.name + ' (' + cut.position + ', cut ' + cut.cutYear + ')');
		if (cut.hint) console.log('   Hint from spreadsheet: ' + cut.hint);
		
		result.matches.forEach(function(m, i) {
			var details = [
				m.full_name,
				m.team || 'FA',
				(m.fantasy_positions || []).join('/'),
				m.college || '?',
				m.years_exp != null ? '~' + (2025 - m.years_exp) : ''
			].filter(Boolean).join(' | ');
			console.log('  ' + (i + 1) + ') ' + details);
		});
		console.log('  0) Create historical player');
		
		var choice = await prompt('Select option: ');
		var idx = parseInt(choice);
		
		if (idx === 0 || isNaN(idx) || idx > result.matches.length) {
			// Create historical
			var displayName = await prompt('Display name (Enter for "' + cut.name + '"): ');
			displayName = displayName.trim() || cut.name;
			
			var player = await Player.create({
				name: displayName,
				positions: [cut.position],
				historical: true
			});
			resolver.addResolution(cut.name, null, displayName);
			
			// Track so we don't create again this run
			if (createdHistoricalThisRun) {
				createdHistoricalThisRun[histKey] = player._id;
			}
			
			return { type: 'created-historical', playerId: player._id };
		}
		
		var sleeperId = result.matches[idx - 1].player_id;
		resolver.addResolution(cut.name, sleeperId);
		var player = await Player.findOne({ sleeperId: sleeperId });
		return { type: 'disambiguated', sleeperId: sleeperId, playerId: player?._id };
	}
	
	return result;
}

async function run() {
	console.log('Fetching cuts data from spreadsheet...');
	console.log('Loaded', resolver.count(), 'cached player resolutions');
	
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
		console.log('Clearing existing fa-cut transactions...');
		await Transaction.deleteMany({ type: 'fa-cut' });
	}
	
	// Load franchises
	var franchises = await Franchise.find({});
	var franchiseByRosterId = {};
	franchises.forEach(function(f) {
		franchiseByRosterId[f.sleeperRosterId] = f._id;
	});
	
	console.log('\nProcessing ' + analysis.cuts.length + ' cuts...\n');
	
	var created = 0;
	var skipped = 0;
	var errors = [];
	var createdHistoricalThisRun = {};  // Track historical players created this run
	
	for (var i = 0; i < analysis.cuts.length; i++) {
		var cut = analysis.cuts[i];
		
		// Find franchise
		var sleeperRosterId = getSleeperRosterId(cut.owner);
		if (!sleeperRosterId) {
			errors.push({ player: cut.name, reason: 'Unknown owner: ' + cut.owner });
			skipped++;
			continue;
		}
		
		var franchiseId = franchiseByRosterId[sleeperRosterId];
		if (!franchiseId) {
			errors.push({ player: cut.name, reason: 'No franchise for rosterId: ' + sleeperRosterId });
			skipped++;
			continue;
		}
		
		// Resolve player
		var resolution = await resolvePlayer(cut, autoHistoricalThreshold, createdHistoricalThisRun);
		
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
		
		// Create fa-cut transaction
		try {
			await Transaction.create({
				type: 'fa-cut',
				timestamp: new Date(cut.cutYear, 0, 1), // Jan 1 of cut year
				source: 'snapshot',
				franchiseId: franchiseId,
				playerId: playerId,
				buyOuts: cut.buyOuts
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
