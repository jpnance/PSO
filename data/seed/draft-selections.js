/**
 * Seed draft selections from Google Sheets into the database.
 * Uses the player resolver for matching and interactive disambiguation.
 * 
 * Usage:
 *   docker compose run --rm -it web node data/seed/draft-selections.js
 *   docker compose run --rm -it web node data/seed/draft-selections.js --clear
 */

var dotenv = require('dotenv').config({ path: __dirname + '/../../.env' });
var mongoose = require('mongoose');
var request = require('superagent');
var readline = require('readline');

var Pick = require('../../models/Pick');
var Player = require('../../models/Player');
var Transaction = require('../../models/Transaction');
var PSO = require('../../config/pso.js');
var resolver = require('../utils/player-resolver');

var sleeperData = Object.values(require('../../public/data/sleeper-data.json'));

mongoose.connect(process.env.MONGODB_URI);

// Sheet URLs
var pastDraftsSheetBaseUrl = 'https://sheets.googleapis.com/v4/spreadsheets/1O0iyyKdniwP-oVvBTwlgxJRYs_WhMsypHGBDB8AO2lM/values/';
var mainSheetBaseUrl = 'https://sheets.googleapis.com/v4/spreadsheets/1nas3AqWZtCu_UZIV77Jgxd9oriF1NQjzSjFWW86eong/values/';

var rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout
});

function prompt(question) {
	return new Promise(function(resolve) {
		rl.question(question, resolve);
	});
}

// Build reverse lookup for owner names
var ownerToFranchiseByYear = {};
Object.keys(PSO.franchiseNames).forEach(function(franchiseId) {
	var yearMap = PSO.franchiseNames[franchiseId];
	Object.keys(yearMap).forEach(function(year) {
		var ownerName = yearMap[year];
		if (!ownerToFranchiseByYear[year]) {
			ownerToFranchiseByYear[year] = {};
		}
		ownerToFranchiseByYear[year][ownerName] = parseInt(franchiseId);
	});
});

var ownerAliases = {
	'Koci': 2, 'John': 4, 'James': 9, 'Schex': 10, 'Daniel': 8,
	'Syed': 3, 'Trevor': 5, 'Terence': 8, 'Charles': 11,
	'Syed/Terence': 3, 'Syed/Kuan': 3, 'Brett/Luke': 7, 'John/Zach': 4,
	'Mitch/Mike': 12, 'James/Charles': 9, 'Schex/Jeff': 10, 'Jake/Luke': 7, 'Pat/Quinn': 1
};

function getFranchiseId(ownerName, season) {
	if (!ownerName) return null;
	var name = ownerName.trim();
	if (ownerToFranchiseByYear[season] && ownerToFranchiseByYear[season][name]) {
		return ownerToFranchiseByYear[season][name];
	}
	if (PSO.franchiseIds[name]) {
		return PSO.franchiseIds[name];
	}
	return ownerAliases[name] || null;
}

// Common nickname mappings
var nicknames = {
	'matt': 'matthew', 'matthew': 'matt',
	'mike': 'michael', 'michael': 'mike',
	'chris': 'christopher', 'christopher': 'chris',
	'rob': 'robert', 'robert': 'rob',
	'bob': 'robert',
	'will': 'william', 'william': 'will',
	'bill': 'william',
	'dan': 'daniel', 'daniel': 'dan',
	'dave': 'david', 'david': 'dave',
	'tom': 'thomas', 'thomas': 'tom',
	'jim': 'james', 'james': 'jim',
	'joe': 'joseph', 'joseph': 'joe',
	'ben': 'benjamin', 'benjamin': 'ben',
	'tony': 'anthony', 'anthony': 'tony',
	'steve': 'steven', 'steven': 'steve',
	'jon': 'jonathan', 'jonathan': 'jon',
	'nick': 'nicholas', 'nicholas': 'nick',
	'drew': 'andrew', 'andrew': 'drew',
	'alex': 'alexander', 'alexander': 'alex',
	'ed': 'edward', 'edward': 'ed',
	'ted': 'theodore', 'theodore': 'ted',
	'pat': 'patrick', 'patrick': 'pat',
	'rick': 'richard', 'richard': 'rick',
	'greg': 'gregory', 'gregory': 'greg',
	'jeff': 'jeffrey', 'jeffrey': 'jeff',
	'ken': 'kenneth', 'kenneth': 'ken',
	'josh': 'joshua', 'joshua': 'josh',
	'zach': 'zachary', 'zachary': 'zach', 'zack': 'zachary',
	'sam': 'samuel', 'samuel': 'sam',
	'tim': 'timothy', 'timothy': 'tim',
	'jake': 'jacob', 'jacob': 'jake',
	'dee': "d'wayne"
};

function findSleeperMatches(name, draftYear) {
	var searchName = resolver.normalizePlayerName(name).replace(/\s+/g, '').toLowerCase();
	var currentYear = parseInt(process.env.SEASON, 10) || new Date().getFullYear();
	var expectedYearsExp = currentYear - draftYear;
	
	// Try exact match first
	var matches = sleeperData.filter(function(p) {
		return p.search_full_name === searchName;
	});
	
	// Try nickname expansion if no exact match
	if (matches.length === 0) {
		var nameParts = name.split(' ');
		var firstName = nameParts[0].toLowerCase();
		var lastName = nameParts.slice(1).join('');
		
		if (nicknames[firstName] && lastName) {
			var altFirstName = nicknames[firstName];
			var altSearchName = (altFirstName + lastName).replace(/[\.\s'-]/g, '').toLowerCase();
			
			matches = sleeperData.filter(function(p) {
				return p.search_full_name === altSearchName;
			});
		}
	}
	
	// Fuzzy match: try last name with hyphenated extension (e.g., "Tryon" -> "Tryon-Shoyinka")
	if (matches.length === 0) {
		var nameParts = name.split(' ');
		var lastName = nameParts[nameParts.length - 1].toLowerCase();
		var firstName = nameParts[0].toLowerCase();
		
		matches = sleeperData.filter(function(p) {
			if (!p.last_name || !p.first_name) return false;
			var sleeperLast = p.last_name.toLowerCase();
			var sleeperFirst = p.first_name.toLowerCase();
			// Sleeper last name starts with our last name (hyphenated)
			return sleeperLast.indexOf(lastName) === 0 && 
			       sleeperLast !== lastName &&
			       sleeperFirst === firstName;
		});
	}
	
	// Fuzzy match: strip punctuation
	if (matches.length === 0) {
		var stripped = resolver.normalizePlayerName(name).replace(/['\-\.]/g, '').replace(/\s+/g, '').toLowerCase();
		matches = sleeperData.filter(function(p) {
			if (!p.search_full_name) return false;
			var sleeperStripped = p.search_full_name.replace(/['\-\.]/g, '');
			return sleeperStripped === stripped;
		});
	}
	
	// Filter by years_exp if multiple matches
	if (matches.length > 1) {
		var expFiltered = matches.filter(function(m) {
			return m.years_exp !== undefined && Math.abs(m.years_exp - expectedYearsExp) <= 1;
		});
		if (expFiltered.length >= 1) {
			matches = expFiltered;
		}
	}
	
	// Sort: active first, then by team, then by position
	matches.sort(function(a, b) {
		if (a.active !== b.active) return a.active ? -1 : 1;
		if ((a.team || 'ZZZ') !== (b.team || 'ZZZ')) return (a.team || 'ZZZ').localeCompare(b.team || 'ZZZ');
		return 0;
	});
	
	return matches;
}

async function findOrCreatePlayer(playerName, draftYear, pickInfo) {
	var normalizedName = resolver.normalizePlayerName(playerName);
	var context = { 
		year: draftYear, 
		type: 'draft',
		pickNumber: pickInfo.pickNumber
	};
	
	// Check resolver cache first
	var cached = resolver.lookup(normalizedName, context);
	
	if (cached && cached.sleeperId) {
		// Found Sleeper ID in cache
		var player = await Player.findOne({ sleeperId: cached.sleeperId });
		if (player) {
			return player._id;
		}
		// Player not in DB yet - create from Sleeper data
		var sleeperPlayer = sleeperData.find(function(p) { return p.player_id === cached.sleeperId; });
		if (sleeperPlayer) {
			player = await Player.create({
				sleeperId: cached.sleeperId,
				name: sleeperPlayer.full_name,
				positions: sleeperPlayer.fantasy_positions || []
			});
			return player._id;
		}
	}
	
	if (cached && cached.name && !cached.sleeperId) {
		// Historical player in cache
		var player = await Player.findOne({ name: cached.name, sleeperId: null });
		if (player) {
			return player._id;
		}
		// Create historical player
		player = await Player.create({
			sleeperId: null,
			name: cached.name,
			positions: []
		});
		console.log('  Created historical player:', cached.name);
		return player._id;
	}
	
	// Check for ambiguous name
	if (cached && cached.ambiguous) {
		console.log('\n⚠️ Ambiguous name: ' + playerName);
		console.log('  Draft context: ' + draftYear + ' R' + pickInfo.round + ' #' + pickInfo.pickNumber);
	}
	
	// Search Sleeper data
	var matches = findSleeperMatches(playerName, draftYear);
	
	if (matches.length === 1 && !cached?.ambiguous) {
		// Single match - use it
		var m = matches[0];
		var player = await Player.findOne({ sleeperId: m.player_id });
		if (!player) {
			player = await Player.create({
				sleeperId: m.player_id,
				name: m.full_name,
				positions: m.fantasy_positions || []
			});
		}
		// Save resolution for future
		resolver.addResolution(normalizedName, m.player_id, null, context);
		resolver.save();
		return player._id;
	}
	
	// Need interactive resolution
	if (!cached?.ambiguous) {
		console.log('\n⚠️ No unique match for: ' + playerName);
		console.log('  Draft context: ' + draftYear + ' R' + pickInfo.round + ' #' + pickInfo.pickNumber);
	}
	
	if (matches.length > 0) {
		console.log('  Candidates:');
		matches.forEach(function(m, i) {
			var details = [
				m.full_name,
				m.team || 'FA',
				(m.fantasy_positions || []).join('/'),
				m.college || '?',
				m.years_exp != null ? '~' + (2025 - m.years_exp) : '',
				m.active ? 'Active' : 'Inactive',
				'ID: ' + m.player_id
			].filter(Boolean).join(' | ');
			console.log('    ' + (i + 1) + ') ' + details);
		});
	}
	
	// Check for existing historical player
	var existingHistorical = await Player.findOne({ 
		name: { $regex: new RegExp('^' + normalizedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
		sleeperId: null 
	});
	
	if (existingHistorical) {
		console.log('    H) Use existing historical: ' + existingHistorical.name);
	}
	
	console.log('    0) Create as NEW historical player');
	console.log('    S) Skip this player');
	
	var choice = await prompt('  Select option: ');
	
	if (choice.toLowerCase() === 's') {
		return null;
	}
	
	if (choice.toLowerCase() === 'h' && existingHistorical) {
		resolver.addResolution(normalizedName, null, existingHistorical.name, context);
		resolver.save();
		return existingHistorical._id;
	}
	
	var idx = parseInt(choice);
	
	if (idx > 0 && idx <= matches.length) {
		var selected = matches[idx - 1];
		var player = await Player.findOne({ sleeperId: selected.player_id });
		if (!player) {
			player = await Player.create({
				sleeperId: selected.player_id,
				name: selected.full_name,
				positions: selected.fantasy_positions || []
			});
		}
		resolver.addResolution(normalizedName, selected.player_id, null, context);
		resolver.save();
		return player._id;
	}
	
	if (idx === 0) {
		// Create historical player - use original name with proper casing
		var displayName = playerName.replace(/\s+(III|II|IV|V|Jr\.|Sr\.)$/i, '').trim();
		var nameChoice = await prompt('  Enter display name (or press Enter for "' + displayName + '"): ');
		if (nameChoice.trim()) {
			displayName = nameChoice.trim();
		}
		
		// Check if historical player with this name already exists
		var existing = await Player.findOne({ name: displayName, sleeperId: null });
		if (existing) {
			console.log('  Using existing historical player: ' + displayName);
			resolver.addResolution(normalizedName, null, displayName, context);
			resolver.save();
			return existing._id;
		}
		
		var player = await Player.create({
			sleeperId: null,
			name: displayName,
			positions: []
		});
		console.log('  Created historical player: ' + displayName);
		resolver.addResolution(normalizedName, null, displayName, context);
		resolver.save();
		return player._id;
	}
	
	return null;
}

async function fetchDraftData(season, apiKey, useMainSheet) {
	var sheetName = useMainSheet ? (season + ' Draft') : String(season);
	var baseUrl = useMainSheet ? mainSheetBaseUrl : pastDraftsSheetBaseUrl;
	
	try {
		var response = await request
			.get(baseUrl + encodeURIComponent(sheetName))
			.query({ alt: 'json', key: apiKey });

		var dataJson = JSON.parse(response.text);
		var picks = [];

		dataJson.values.forEach(function(row, i) {
			if (i === 0) return;

			var offset = (season === 2020) ? 1 : 0;

			var pickNumber = parseInt(row[0 + offset]);
			var round = parseInt(row[1 + offset]);
			var currentOwner = row[2 + offset];
			var player = row[3 + offset];

			if (isNaN(round)) return;

			if (player && player.toLowerCase() !== 'pass') {
				picks.push({
					season: season,
					pickNumber: pickNumber,
					round: round,
					currentOwner: currentOwner,
					franchiseId: getFranchiseId(currentOwner, season),
					playerName: player
				});
			}
		});

		return picks;
	}
	catch (err) {
		console.log('Could not fetch ' + season + ':', err.message);
		return [];
	}
}

async function seed() {
	var apiKey = process.env.GOOGLE_API_KEY;
	if (!apiKey) {
		console.error('GOOGLE_API_KEY required');
		process.exit(1);
	}

	console.log('Seeding draft selections from Google Sheets...\n');

	var clearExisting = process.argv.includes('--clear');
	if (clearExisting) {
		console.log('Clearing existing draft-select transactions...');
		await Transaction.deleteMany({ type: 'draft-select' });
		await Pick.updateMany({ status: 'used' }, { $unset: { transactionId: 1 } });
	}

	var currentYear = parseInt(process.env.SEASON, 10) || new Date().getFullYear();
	var startYear = 2010;
	
	var created = 0;
	var skipped = 0;
	var errors = [];

	// Process past drafts (2010 through currentYear-1)
	for (var year = startYear; year < currentYear; year++) {
		console.log('\nFetching ' + year + ' (past drafts sheet)...');
		var picks = await fetchDraftData(year, apiKey, false);
		
		for (var i = 0; i < picks.length; i++) {
			var sel = picks[i];
			
			// Find the Pick document
			var pick = await Pick.findOne({
				season: sel.season,
				pickNumber: sel.pickNumber
			});
			
			if (!pick) {
				errors.push(sel.season + ' R' + sel.round + ' #' + sel.pickNumber + ': Pick not found in DB');
				skipped++;
				continue;
			}
			
			// Skip if already processed
			if (pick.transactionId) {
				continue;
			}
			
			// Resolve player
			var playerId = await findOrCreatePlayer(sel.playerName, sel.season, sel);
			if (!playerId) {
				errors.push(sel.season + ' R' + sel.round + ' #' + sel.pickNumber + ': Could not resolve player "' + sel.playerName + '"');
				skipped++;
				continue;
			}
			
			// Create transaction
			var timestamp = new Date(sel.season + '-08-15T12:00:00Z');
			
			try {
				var transaction = await Transaction.create({
					type: 'draft-select',
					timestamp: timestamp,
					source: 'snapshot',
					franchiseId: pick.currentFranchiseId,
					playerId: playerId,
					pickId: pick._id
				});
				
				pick.transactionId = transaction._id;
				pick.status = 'used';
				await pick.save();
				
				created++;
			}
			catch (err) {
				errors.push(sel.season + ' R' + sel.round + ' #' + sel.pickNumber + ': ' + err.message);
				skipped++;
			}
		}
	}

	// Process current year from main sheet
	console.log('\nFetching ' + currentYear + ' (main sheet)...');
	var currentPicks = await fetchDraftData(currentYear, apiKey, true);
	
	for (var i = 0; i < currentPicks.length; i++) {
		var sel = currentPicks[i];
		
		var pick = await Pick.findOne({
			season: sel.season,
			pickNumber: sel.pickNumber
		});
		
		if (!pick) {
			errors.push(sel.season + ' R' + sel.round + ' #' + sel.pickNumber + ': Pick not found in DB');
			skipped++;
			continue;
		}
		
		if (pick.transactionId) {
			continue;
		}
		
		var playerId = await findOrCreatePlayer(sel.playerName, sel.season, sel);
		if (!playerId) {
			errors.push(sel.season + ' R' + sel.round + ' #' + sel.pickNumber + ': Could not resolve player "' + sel.playerName + '"');
			skipped++;
			continue;
		}
		
		var timestamp = new Date(sel.season + '-08-15T12:00:00Z');
		
		try {
			var transaction = await Transaction.create({
				type: 'draft-select',
				timestamp: timestamp,
				source: 'snapshot',
				franchiseId: pick.currentFranchiseId,
				playerId: playerId,
				pickId: pick._id
			});
			
			pick.transactionId = transaction._id;
			pick.status = 'used';
			await pick.save();
			
			created++;
		}
		catch (err) {
			errors.push(sel.season + ' R' + sel.round + ' #' + sel.pickNumber + ': ' + err.message);
			skipped++;
		}
	}

	console.log('\n\n=== Done ===');
	console.log('  Created:', created, 'draft-select transactions');
	console.log('  Skipped:', skipped);

	if (errors.length > 0) {
		console.log('\nErrors:');
		errors.forEach(function(e) {
			console.log('  - ' + e);
		});
	}

	rl.close();
	process.exit(0);
}

seed().catch(function(err) {
	rl.close();
	console.error('Error:', err);
	process.exit(1);
});
