var dotenv = require('dotenv').config({ path: __dirname + '/../../.env' });
var mongoose = require('mongoose');
var request = require('superagent');

var Pick = require('../../models/Pick');
var Franchise = require('../../models/Franchise');
var PSO = require('../../pso.js');

// Main PSO spreadsheet (for future drafts like "2025 Draft")
var mainSheetBaseUrl = 'https://sheets.googleapis.com/v4/spreadsheets/1nas3AqWZtCu_UZIV77Jgxd9oriF1NQjzSjFWW86eong/values/';

// Past Drafts spreadsheet (tabs named by year: "2024", "2023", etc.)
var pastDraftsSheetBaseUrl = 'https://sheets.googleapis.com/v4/spreadsheets/1O0iyyKdniwP-oVvBTwlgxJRYs_WhMsypHGBDB8AO2lM/values/';

mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });

// Build reverse lookup: { season: { ownerName: franchiseId } }
// Uses PSO.franchiseNames which maps franchiseId -> { year -> ownerName }
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

// Static alias map for shorthand names and historical owners
// Used as fallback when season-specific lookup fails
var ownerAliases = {
	// Shorthand names
	'Koci': 2,
	'John': 4,
	'James': 9,
	'Schex': 10,
	'Daniel': 8,
	'Syed': 3,
	'Trevor': 5,
	'Terence': 8,
	'Charles': 11,
	// Historical co-owner names
	'Syed/Terence': 3,
	'Syed/Kuan': 3,
	'Brett/Luke': 7,
	'John/Zach': 4,
	'Mitch/Mike': 12,
	'James/Charles': 9,
	'Schex/Jeff': 10,
	'Jake/Luke': 7,
	'Pat/Quinn': 1
};

// Map owner display names to sleeperRosterId (1-12) for a given season
function getSleeperRosterId(ownerName, season) {
	if (!ownerName) return null;
	var name = ownerName.trim();
	
	// First try season-specific lookup (for historical names)
	if (ownerToFranchiseByYear[season] && ownerToFranchiseByYear[season][name]) {
		return ownerToFranchiseByYear[season][name];
	}
	
	// Try current franchiseIds
	if (PSO.franchiseIds[name]) {
		return PSO.franchiseIds[name];
	}
	
	// Fall back to static alias map
	return ownerAliases[name] || null;
}

async function fetchPicksForSeason(season, isFutureDraft) {
	// Future drafts: main spreadsheet, "{Year} Draft" tabs
	// Past drafts: separate spreadsheet, tabs named just "{Year}"
	var sheetName = isFutureDraft ? (season + ' Draft') : String(season);
	var baseUrl = isFutureDraft ? mainSheetBaseUrl : pastDraftsSheetBaseUrl;

	try {
		var response = await request
			.get(baseUrl + encodeURIComponent(sheetName))
			.query({ alt: 'json', key: process.env.GOOGLE_API_KEY });

		var dataJson = JSON.parse(response.text);
		var picks = [];

		dataJson.values.forEach(function(row, i) {
			// Skip header row(s) - assume first row is header
			if (i === 0) return;

			// 2020 has an extra column at the start, shifting everything right by 1
			var offset = (season === 2020) ? 1 : 0;

			var pickNumber = parseInt(row[0 + offset]);
			var round = parseInt(row[1 + offset]);
			var currentOwner = row[2 + offset];
			var player = row[3 + offset]; // Player name, "Pass", or empty
			var originRaw = row[4 + offset]; // "From X" or "From X (via Y)" or empty

			if (isNaN(round)) return; // Skip non-data rows

			// Parse origin to extract original owner
			// Formats seen:
			//   "From X" -> X
			//   "From X (via Y, via Z)" -> X
			//   "X" (just owner name) -> X
			//   "X (from Y)" -> X (strip parenthetical)
			var originalOwner = currentOwner;
			if (originRaw) {
				var cleaned = originRaw.trim();
				
				// Try "From X" format first
				var fromMatch = cleaned.match(/^From\s+(.+?)(?:\s+\(via|$)/i);
				if (fromMatch) {
					originalOwner = fromMatch[1].trim();
				} else {
					// Strip any parenthetical like "(from X)" or "(via X)"
					// Handle both regular parens and any unicode variants
					var stripped = cleaned.split(/\s*[\(\[]/).shift().trim();
					originalOwner = stripped || cleaned;
				}
			}

			// Determine status:
			// - "Pass" = passed
			// - Has player name = used
			// - Empty and future draft = available
			// - Empty and past draft = passed (shouldn't happen but fallback)
			var status;
			if (player && player.toLowerCase() === 'pass') {
				status = 'passed';
				player = null; // Clear the "Pass" text
			} else if (player) {
				status = 'used';
			} else if (isFutureDraft) {
				status = 'available';
			} else {
				status = 'passed';
			}

			picks.push({
				season: season,
				pickNumber: pickNumber,
				round: round,
				currentOwner: currentOwner,
				originalOwner: originalOwner,
				player: player || null,
				status: status
			});
		});

		return picks;
	}
	catch (err) {
		console.log('Could not fetch ' + sheetName + ':', err.message);
		return [];
	}
}

async function seed() {
	console.log('Seeding picks from spreadsheet...\n');

	var clearExisting = process.argv.includes('--clear');
	if (clearExisting) {
		console.log('Clearing existing picks...');
		await Pick.deleteMany({});
	}

	// Load franchises (to map sleeperRosterId -> _id)
	var franchises = await Franchise.find({});
	var franchiseByRosterId = {};
	franchises.forEach(function(f) {
		franchiseByRosterId[f.sleeperRosterId] = f._id;
	});

	console.log('Loaded', franchises.length, 'franchises');

	var currentYear = new Date().getFullYear();
	var allPicks = [];

	// Fetch past drafts (from "Past Drafts" sheet tabs named just by year)
	// Note: "2012 Expansion" tab is intentionally skipped — that was a one-time
	// expansion draft when the league went from 10 to 12 franchises. Those were
	// acquisitions of existing players/RFA rights, not rookie picks. May want to
	// preserve that data separately as static history.
	var startYear = 2010; // First year tracked in the spreadsheet
	console.log('Fetching past drafts (' + startYear + '-' + (currentYear - 1) + ')...');
	for (var year = startYear; year < currentYear; year++) {
		var picks = await fetchPicksForSeason(year, false);
		if (picks.length > 0) {
			console.log('  ' + year + ': ' + picks.length + ' picks');
			allPicks = allPicks.concat(picks);
		}
	}

	// Fetch future drafts (tabs named "{Year} Draft")
	var futureSeasons = [currentYear, currentYear + 1, currentYear + 2];
	console.log('\nFetching future drafts...');
	for (var i = 0; i < futureSeasons.length; i++) {
		var season = futureSeasons[i];
		var picks = await fetchPicksForSeason(season, true);
		if (picks.length > 0) {
			console.log('  ' + season + ' Draft: ' + picks.length + ' picks');
			allPicks = allPicks.concat(picks);
		}
	}

	console.log('\nProcessing', allPicks.length, 'total picks...\n');

	var created = 0;
	var skipped = 0;
	var errors = [];

	for (var i = 0; i < allPicks.length; i++) {
		var p = allPicks[i];

		// Map current owner to franchise
		var currentRosterId = getSleeperRosterId(p.currentOwner, p.season);
		if (!currentRosterId) {
			errors.push({ pick: p.season + ' R' + p.round + ' #' + p.pickNumber, reason: 'Unknown current owner: ' + p.currentOwner });
			skipped++;
			continue;
		}
		var currentFranchiseId = franchiseByRosterId[currentRosterId];

		// Map original owner to franchise
		var originalRosterId = getSleeperRosterId(p.originalOwner, p.season);
		if (!originalRosterId) {
			errors.push({ pick: p.season + ' R' + p.round + ' #' + p.pickNumber, reason: 'Unknown original owner: ' + p.originalOwner });
			skipped++;
			continue;
		}
		var originalFranchiseId = franchiseByRosterId[originalRosterId];

		// Create pick
		try {
			await Pick.create({
				round: p.round,
				season: p.season,
				originalFranchiseId: originalFranchiseId,
				currentFranchiseId: currentFranchiseId,
				status: p.status
			});
			created++;
		}
		catch (err) {
			if (err.code === 11000) {
				errors.push({ pick: p.season + ' R' + p.round + ' #' + p.pickNumber, reason: 'Duplicate pick' });
				skipped++;
			}
			else {
				throw err;
			}
		}
	}

	console.log('Done!');
	console.log('  Created:', created);
	console.log('  Skipped:', skipped);

	if (errors.length > 0) {
		console.log('\nErrors:');
		errors.forEach(function(e) {
			console.log('  -', e.pick + ':', e.reason);
		});
	}

	process.exit(0);
}

seed().catch(function(err) {
	console.error('Error:', err);
	process.exit(1);
});

