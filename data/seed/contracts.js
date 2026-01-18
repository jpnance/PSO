var dotenv = require('dotenv').config({ path: __dirname + '/../../.env' });
var mongoose = require('mongoose');
var request = require('superagent');
var readline = require('readline');

var Contract = require('../../models/Contract');
var Franchise = require('../../models/Franchise');
var Player = require('../../models/Player');
var PSO = require('../../config/pso.js');
var resolver = require('../utils/player-resolver');

var sleeperData = Object.values(require('../../public/data/sleeper-data.json'));

var sheetLink = 'https://sheets.googleapis.com/v4/spreadsheets/1nas3AqWZtCu_UZIV77Jgxd9oriF1NQjzSjFWW86eong/values/Rostered';

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

// Map owner display names to rosterId (1-12)
function getSleeperRosterId(ownerName) {
	return PSO.franchiseIds[ownerName];
}

// Match player name to Sleeper ID, with resolver cache and interactive disambiguation
// rosterInfo contains context from the spreadsheet (owner, salary, etc.)
async function findSleeperPlayerId(name, positions, rosterInfo) {
	// Build context for resolver
	var context = {
		position: positions[0],
		franchise: rosterInfo.owner.toLowerCase()
	};
	
	// Check resolver cache first
	var cached = resolver.lookup(name, context);
	
	if (cached && !cached.ambiguous && cached.sleeperId) {
		// Found cached resolution
		return cached.sleeperId;
	}
	
	if (cached && !cached.ambiguous && cached.sleeperId === null) {
		// Cached as historical player - skip for contracts (they should be current players)
		console.log('⚠️  ' + name + ' is cached as historical, skipping');
		return null;
	}
	
	// Need to search Sleeper data
	var searchName = name.replace(/[\. '-]/g, '').toLowerCase();
	
	var matches = sleeperData.filter(function(p) {
		return p.search_full_name === searchName &&
			p.fantasy_positions &&
			p.fantasy_positions.includes(positions[0]);
	});
	
	if (matches.length === 1 && !cached) {
		// Single match and not marked ambiguous - cache it and return
		resolver.addResolution(name, matches[0].player_id);
		return matches[0].player_id;
	}
	
	if (matches.length === 0) {
		// Try broader search without position filter
		matches = sleeperData.filter(function(p) {
			return p.search_full_name === searchName;
		});
	}
	
	// Show context from spreadsheet
	var sheetContext = [
		'Owner: ' + rosterInfo.owner,
		rosterInfo.salary ? '$' + rosterInfo.salary : null,
		rosterInfo.start && rosterInfo.end ? rosterInfo.start + '-' + rosterInfo.end : null
	].filter(Boolean).join(', ');
	
	if (matches.length === 0) {
		console.log('\n⚠️  No matches found for: ' + name + ' (' + positions.join('/') + ')');
		console.log('   Spreadsheet: ' + sheetContext);
		var manual = await prompt('Enter Sleeper ID manually (or press Enter to skip): ');
		var sleeperId = manual.trim() || null;
		
		if (sleeperId) {
			resolver.addResolution(name, sleeperId, null, context);
		}
		
		return sleeperId;
	}
	
	if (matches.length > 1 || (cached && cached.ambiguous)) {
		// Multiple matches or marked as ambiguous - show ALL players with this name
		var displayMatches = matches;
		
		if (cached && cached.ambiguous) {
			// For ambiguous names, show all matches regardless of position
			displayMatches = sleeperData.filter(function(p) {
				return p.search_full_name === searchName;
			});
		}
		
		// Sort candidates: position match first, then active, then on a team
		var targetPosition = positions[0];
		displayMatches.sort(function(a, b) {
			// Position match is most important
			var aPos = (a.fantasy_positions || []).includes(targetPosition) ? 0 : 1;
			var bPos = (b.fantasy_positions || []).includes(targetPosition) ? 0 : 1;
			if (aPos !== bPos) return aPos - bPos;
			
			// Active players before inactive
			var aActive = a.active ? 0 : 1;
			var bActive = b.active ? 0 : 1;
			if (aActive !== bActive) return aActive - bActive;
			
			// On a team before free agents
			var aTeam = a.team ? 0 : 1;
			var bTeam = b.team ? 0 : 1;
			return aTeam - bTeam;
		});
		
		console.log('\n⚠️  ' + (cached && cached.ambiguous ? 'Ambiguous name: ' : 'Multiple matches for: ') + name + ' (' + positions.join('/') + ')');
		console.log('   Spreadsheet: ' + sheetContext);
		displayMatches.forEach(function(m, i) {
			var details = [
				m.full_name,
				m.team || 'FA',
				(m.fantasy_positions || []).join('/'),
				m.college || '?',
				m.years_exp != null ? '~' + (2025 - m.years_exp) : '',
				m.status || 'Unknown',
				'ID: ' + m.player_id
			].filter(Boolean).join(' | ');
			console.log('  ' + (i + 1) + ') ' + details);
		});
		console.log('  0) Skip this player');
		
		var choice = await prompt('Select option: ');
		var idx = parseInt(choice);
		
		if (idx === 0 || isNaN(idx) || idx > displayMatches.length) {
			return null;
		}
		
		var sleeperId = displayMatches[idx - 1].player_id;
		resolver.addResolution(name, sleeperId, null, context);
		return sleeperId;
	}
	
	// Single match found
	resolver.addResolution(name, matches[0].player_id);
	return matches[0].player_id;
}

async function fetchRosteredPlayers() {
	var response = await request
		.get(sheetLink)
		.query({ alt: 'json', key: process.env.GOOGLE_API_KEY });

	var dataJson = JSON.parse(response.text);
	var players = [];

	dataJson.values.forEach(function(row, i) {
		// Skip header rows and footer
		if (i < 2 || i === dataJson.values.length - 1) {
			return;
		}

		var owner = row[0] !== '' ? row[0] : undefined;
		if (!owner) {
			return; // Skip free agents
		}

		players.push({
			owner: owner,
			name: row[1],
			positions: row[2].split('/'),
			start: parseInt(row[3]) || null,
			end: parseInt(row[4]) || null,
			salary: row[5] ? parseInt(row[5].replace('$', '')) : null
		});
	});

	return players;
}

async function seed() {
	console.log('Seeding contracts from spreadsheet...\n');
	console.log('Loaded', resolver.count(), 'cached player resolutions');

	var clearExisting = process.argv.includes('--clear');
	if (clearExisting) {
		console.log('Clearing existing contracts...');
		await Contract.deleteMany({});
	}

	// Load franchises (to map rosterId -> _id)
	var franchises = await Franchise.find({});
	var franchiseByRosterId = {};
	franchises.forEach(function(f) {
		franchiseByRosterId[f.rosterId] = f._id;
	});

	console.log('Loaded', franchises.length, 'franchises');

	// Fetch rostered players from spreadsheet
	var rosteredPlayers = await fetchRosteredPlayers();
	console.log('Found', rosteredPlayers.length, 'rostered players in spreadsheet\n');

	var created = 0;
	var skipped = 0;
	var errors = [];

	for (var i = 0; i < rosteredPlayers.length; i++) {
		var rp = rosteredPlayers[i];

		// Find franchise
		var rosterId = getSleeperRosterId(rp.owner);
		if (!rosterId) {
			errors.push({ player: rp.name, reason: 'Unknown owner: ' + rp.owner });
			skipped++;
			continue;
		}

		var franchiseId = franchiseByRosterId[rosterId];
		if (!franchiseId) {
			errors.push({ player: rp.name, reason: 'No franchise for rosterId: ' + rosterId });
			skipped++;
			continue;
		}

		// Find player by Sleeper ID (may prompt interactively)
		var sleeperId = await findSleeperPlayerId(rp.name, rp.positions, rp);
		if (!sleeperId) {
			errors.push({ player: rp.name, reason: 'Could not match to Sleeper player' });
			skipped++;
			continue;
		}

		var player = await Player.findOne({ sleeperId: sleeperId });
		if (!player) {
			errors.push({ player: rp.name, reason: 'Sleeper ID ' + sleeperId + ' not in Player collection' });
			skipped++;
			continue;
		}

		// Create contract
		try {
			await Contract.create({
				playerId: player._id,
				franchiseId: franchiseId,
				salary: rp.salary,
				startYear: rp.start,
				endYear: rp.end
			});
			created++;
		}
		catch (err) {
			if (err.code === 11000) {
				errors.push({ player: rp.name, reason: 'Duplicate contract' });
				skipped++;
			}
			else {
				throw err;
			}
		}
	}

	// Save any new resolutions
	resolver.save();
	rl.close();

	console.log('\nDone!');
	console.log('  Created:', created);
	console.log('  Skipped:', skipped);

	if (errors.length > 0) {
		console.log('\nErrors:');
		errors.forEach(function(e) {
			console.log('  -', e.player + ':', e.reason);
		});
	}

	process.exit(0);
}

seed().catch(function(err) {
	resolver.save(); // Save any resolutions made before error
	rl.close();
	console.error('Error:', err);
	process.exit(1);
});
