/**
 * Seed 2012 Expansion Draft transactions.
 * 
 * The 2012 expansion draft added two new franchises to the league.
 * Each selection transfers a player (with contract) or RFA rights
 * from an existing franchise to a new franchise.
 * 
 * Data source: "2012 Expansion" tab in Past Drafts Google Sheet
 * Format: Pick, Round, Owner, Player, Original Owner
 * 
 * Usage:
 *   docker compose run --rm web node data/seed/expansion-draft-2012.js
 *   docker compose run --rm web node data/seed/expansion-draft-2012.js --dry-run
 */

var dotenv = require('dotenv').config({ path: __dirname + '/../../.env' });
var mongoose = require('mongoose');
var fs = require('fs');
var path = require('path');
var request = require('superagent');

var Player = require('../../models/Player');
var Franchise = require('../../models/Franchise');
var Transaction = require('../../models/Transaction');
var PSO = require('../../config/pso.js');
var resolver = require('../utils/player-resolver');

mongoose.connect(process.env.MONGODB_URI);

// Google Sheets URL (Past Drafts sheet)
var PAST_DRAFTS_SHEET = 'https://sheets.googleapis.com/v4/spreadsheets/1O0iyyKdniwP-oVvBTwlgxJRYs_WhMsypHGBDB8AO2lM/values/';
var SHEET_NAME = '2012 Expansion';

// Expansion draft date: August 18, 2012 at 10:00 AM ET
// This was the day before the regular auction
var EXPANSION_DRAFT_DATE = new Date(Date.UTC(2012, 7, 18, 14, 0, 0)); // 10:00 AM ET = 14:00 UTC

/**
 * Fetch expansion draft data from Google Sheets.
 */
async function fetchExpansionDraft(apiKey) {
	var response = await request
		.get(PAST_DRAFTS_SHEET + encodeURIComponent(SHEET_NAME))
		.query({ alt: 'json', key: apiKey });
	
	var data = JSON.parse(response.text);
	return parseSheetData(data.values);
}

/**
 * Parse sheet rows into pick objects.
 * Format: Pick, Round, Owner, Player, Original Owner
 */
function parseSheetData(rows) {
	var picks = [];
	
	for (var i = 1; i < rows.length; i++) {  // Skip header
		var row = rows[i];
		if (!row || row.length < 5) continue;
		
		var pick = parseInt(row[0], 10);
		var round = parseInt(row[1], 10);
		
		if (isNaN(pick) || isNaN(round)) continue;
		
		picks.push({
			pick: pick,
			round: round,
			owner: row[2] ? row[2].trim() : '',
			player: row[3] ? row[3].trim() : '',
			originalOwner: row[4] ? row[4].trim() : ''
		});
	}
	
	return picks;
}

/**
 * Build owner name to franchise ID lookup for 2012.
 */
function buildOwnerMap(franchises) {
	var map = {};
	
	// Use PSO.franchiseNames for 2012
	Object.keys(PSO.franchiseNames).forEach(function(rosterId) {
		var yearMap = PSO.franchiseNames[rosterId];
		if (yearMap && yearMap[2012]) {
			map[yearMap[2012].toLowerCase()] = parseInt(rosterId);
		}
	});
	
	// Add common aliases (Pat/Quinn is often called just "Patrick")
	map['patrick'] = 1;
	
	return map;
}

async function run() {
	var args = process.argv.slice(2);
	var dryRun = args.includes('--dry-run');
	
	console.log('Seeding 2012 Expansion Draft' + (dryRun ? ' (DRY RUN)' : ''));
	console.log('');
	
	// Check for API key
	var apiKey = process.env.GOOGLE_API_KEY;
	if (!apiKey) {
		console.log('Error: GOOGLE_API_KEY environment variable required');
		process.exit(1);
	}
	
	// Fetch data from Google Sheets
	console.log('Fetching from Google Sheets: ' + SHEET_NAME);
	var picks;
	try {
		picks = await fetchExpansionDraft(apiKey);
	} catch (err) {
		console.log('Error fetching sheet: ' + err.message);
		process.exit(1);
	}
	console.log('Loaded ' + picks.length + ' picks');
	console.log('');
	
	// Load franchises
	var franchises = await Franchise.find({}).lean();
	var franchiseByRosterId = {};
	franchises.forEach(function(f) {
		franchiseByRosterId[f.rosterId] = f._id;
	});
	
	var ownerMap = buildOwnerMap(franchises);
	
	// Load players for matching
	var allPlayers = await Player.find({}).lean();
	var playersByNormalizedName = {};
	allPlayers.forEach(function(p) {
		var norm = resolver.normalizePlayerName(p.name);
		if (!playersByNormalizedName[norm]) {
			playersByNormalizedName[norm] = [];
		}
		playersByNormalizedName[norm].push(p);
	});
	
	// Load contracts snapshot for 2012 to get contract info
	var contractsPath = path.join(__dirname, '../archive/snapshots/contracts-2012.txt');
	var contractsByPlayer = {};
	if (fs.existsSync(contractsPath)) {
		var contractsContent = fs.readFileSync(contractsPath, 'utf8');
		var contractLines = contractsContent.trim().split('\n');
		for (var i = 1; i < contractLines.length; i++) {
			var cols = contractLines[i].split(',');
			if (cols.length < 7) continue;
			var playerName = cols[2].trim().toLowerCase();
			contractsByPlayer[playerName] = {
				salary: parseInt(cols[6].replace('$', '').trim(), 10),
				startYear: cols[4].trim(),
				endYear: parseInt(cols[5].trim(), 10)
			};
		}
	}
	console.log('Loaded ' + Object.keys(contractsByPlayer).length + ' contracts from 2012 snapshot');
	console.log('');
	
	var created = 0;
	var skipped = 0;
	var errors = [];
	
	for (var i = 0; i < picks.length; i++) {
		var pick = picks[i];
		console.log('Pick ' + pick.pick + ': ' + pick.player + ' (' + pick.originalOwner + ' → ' + pick.owner + ')');
		
		// Resolve acquiring franchise
		var ownerKey = pick.owner.toLowerCase();
		var rosterId = ownerMap[ownerKey];
		if (!rosterId) {
			console.log('  ✗ Could not find franchise: ' + pick.owner);
			errors.push('Could not find franchise: ' + pick.owner);
			continue;
		}
		var franchiseId = franchiseByRosterId[rosterId];
		
		// Resolve original franchise
		var originalOwnerKey = pick.originalOwner.toLowerCase();
		var originalRosterId = ownerMap[originalOwnerKey];
		if (!originalRosterId) {
			console.log('  ✗ Could not find original franchise: ' + pick.originalOwner);
			errors.push('Could not find original franchise: ' + pick.originalOwner);
			continue;
		}
		var fromFranchiseId = franchiseByRosterId[originalRosterId];
		
		// Resolve player
		var normalizedName = resolver.normalizePlayerName(pick.player);
		var candidates = playersByNormalizedName[normalizedName] || [];
		
		var player = null;
		if (candidates.length === 1) {
			player = candidates[0];
		} else if (candidates.length > 1) {
			// Try to find one without sleeperId (historical)
			var historical = candidates.filter(function(c) { return !c.sleeperId; });
			player = historical.length === 1 ? historical[0] : candidates[0];
		}
		
		// Auto-create if not found (historical player)
		if (!player && candidates.length === 0) {
			var existing = await Player.findOne({ name: pick.player, sleeperId: null });
			if (existing) {
				player = existing;
			} else {
				console.log('  Auto-creating historical: ' + pick.player);
				if (!dryRun) {
					player = await Player.create({
						name: pick.player,
						positions: [],
						sleeperId: null
					});
				} else {
					player = { _id: 'dry-run', name: pick.player };
				}
			}
		}
		
		if (!player) {
			console.log('  ✗ Could not find player: ' + pick.player);
			errors.push('Could not find player: ' + pick.player);
			continue;
		}
		
		// Check for existing transaction
		var existing = await Transaction.findOne({
			type: 'expansion-draft-select',
			playerId: player._id,
			pick: pick.pick
		});
		
		if (existing) {
			console.log('  → Already exists, skipping');
			skipped++;
			continue;
		}
		
		// Check if this player had RFA rights conveyed earlier in 2012
		// (If so, they were selected with RFA rights, not a contract)
		var rfaConversion = await Transaction.findOne({
			type: 'rfa-rights-conversion',
			playerId: player._id,
			timestamp: {
				$gte: new Date(Date.UTC(2012, 0, 1)),
				$lt: EXPANSION_DRAFT_DATE
			}
		});
		
		var isRfaRights = false;
		var salary = null;
		var startYear = null;
		var endYear = null;
		
		if (rfaConversion) {
			// Player had RFA rights conveyed this year - expansion draft got RFA rights
			isRfaRights = true;
			console.log('  → RFA rights (had rfa-rights-conversion in 2012)');
		} else {
			// Check contract snapshot
			var contract = contractsByPlayer[pick.player.toLowerCase()];
			if (contract) {
				// Check if it's RFA rights (startYear is 'FA' or contract already expired)
				if (contract.startYear === 'FA' || contract.endYear < 2012) {
					isRfaRights = true;
					console.log('  → RFA rights only');
				} else if (parseInt(contract.startYear, 10) >= 2012) {
					// Contract started in 2012 or later - likely signed at auction AFTER expansion draft
					// This means they were selected with RFA rights
					isRfaRights = true;
					console.log('  → RFA rights (contract started in 2012+, post-auction)');
				} else {
					salary = contract.salary;
					startYear = parseInt(contract.startYear, 10);
					endYear = contract.endYear;
					console.log('  → Contract: $' + salary + ' ' + startYear + '/' + endYear);
				}
			} else {
				// No contract found - assume RFA rights
				isRfaRights = true;
				console.log('  → RFA rights (no contract found)');
			}
		}
		
		// Create transaction
		if (!dryRun) {
			var txData = {
				type: 'expansion-draft-select',
				timestamp: EXPANSION_DRAFT_DATE,
				source: 'manual',
				franchiseId: franchiseId,
				fromFranchiseId: fromFranchiseId,
				playerId: player._id,
				round: pick.round,
				pick: pick.pick
			};
			
			if (isRfaRights) {
				txData.rfaRights = true;
			} else {
				txData.salary = salary;
				txData.startYear = startYear;
				txData.endYear = endYear;
			}
			
			await Transaction.create(txData);
		}
		
		created++;
	}
	
	console.log('');
	console.log('=== Summary ===');
	console.log('Created: ' + created);
	console.log('Skipped (existing): ' + skipped);
	
	if (errors.length > 0) {
		console.log('Errors: ' + errors.length);
		errors.forEach(function(e) {
			console.log('  - ' + e);
		});
	}
	
	await mongoose.disconnect();
}

run().catch(function(err) {
	console.error('Error:', err);
	process.exit(1);
});
