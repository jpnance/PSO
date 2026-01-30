var dotenv = require('dotenv').config({ path: __dirname + '/../../.env' });
var mongoose = require('mongoose');
var request = require('superagent');
var readline = require('readline');

var Contract = require('../../models/Contract');
var Franchise = require('../../models/Franchise');
var Player = require('../../models/Player');
var PSO = require('../../config/pso.js');
var resolver = require('../utils/player-resolver');

var sheetLink = 'https://sheets.googleapis.com/v4/spreadsheets/1nas3AqWZtCu_UZIV77Jgxd9oriF1NQjzSjFWW86eong/values/Rostered';

mongoose.connect(process.env.MONGODB_URI);

// Global readline interface and player lookup
var rl = null;
var playersByNormalizedName = {};

// Map owner display names to rosterId (1-12)
function getSleeperRosterId(ownerName) {
	return PSO.franchiseIds[ownerName];
}

// Find player using unified prompt
async function findPlayer(name, positions, rosterInfo) {
	var context = {
		year: PSO.season,
		type: 'contract',
		franchise: rosterInfo.owner
	};
	
	var normalizedName = resolver.normalizePlayerName(name);
	var candidates = playersByNormalizedName[normalizedName] || [];
	
	var result = await resolver.promptForPlayer({
		name: name,
		context: context,
		candidates: candidates,
		position: positions.join('/'),
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
	
	return result.player;
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

		// Find player using unified prompt
		var player = await findPlayer(rp.name, rp.positions, rp);
		if (!player) {
			errors.push({ player: rp.name, reason: 'Could not match to player' });
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
