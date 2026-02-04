/**
 * Seed auction and contract transactions from contract snapshot files.
 * 
 * For players with Start=YEAR (new contracts this year):
 *   - If not a rookie draft pick: create auction-ufa transaction
 *   - Create contract transaction with salary and years
 * 
 * Timestamps:
 *   - Auction wins: 9:00:00 AM ET on auction day
 *   - Contract signings: 12:00:00 PM ET on contract due date
 * 
 * Usage:
 *   docker compose run --rm -it web node data/seed/auction.js 2025
 *   docker compose run --rm -it web node data/seed/auction.js 2025 --dry-run
 *   docker compose run --rm -it web node data/seed/auction.js 2025 --dry-run --skip-ambiguous
 *   docker compose run --rm -it web node data/seed/auction.js 2025 --auto-historical
 */

var dotenv = require('dotenv').config({ path: __dirname + '/../../.env' });
var mongoose = require('mongoose');
var fs = require('fs');
var path = require('path');
var readline = require('readline');

var Franchise = require('../../models/Franchise');
var Player = require('../../models/Player');
var Transaction = require('../../models/Transaction');
var PSO = require('../../config/pso.js');
var resolver = require('../utils/player-resolver');
var snapshotFacts = require('../facts/snapshot-facts');

mongoose.connect(process.env.MONGODB_URI);

/**
 * Find who holds RFA rights for a player at auction time.
 * Returns { holderId, conversionTx } or null if no RFA rights exist.
 * 
 * RFA rights are only valid for the immediately following auction.
 * Conversion happens Jan 15 of year Y, auction is Aug of year Y.
 * So we only look for conversions from the same calendar year.
 * 
 * RFA rights can come from:
 *   - rfa-rights-conversion (contract expired)
 *   - expansion-draft-select with rfaRights: true
 */
async function findRfaHolder(playerId, auctionTimestamp) {
	var auctionYear = auctionTimestamp.getUTCFullYear();
	
	// Find rfa-rights-conversion or expansion-draft-select with rfaRights for this player
	var conversion = await Transaction.findOne({
		$or: [
			{ type: 'rfa-rights-conversion' },
			{ type: 'expansion-draft-select', rfaRights: true }
		],
		playerId: playerId,
		timestamp: {
			$gte: new Date(Date.UTC(auctionYear, 0, 1)),
			$lt: auctionTimestamp
		}
	}).sort({ timestamp: -1 });
	
	if (!conversion) {
		return null;
	}
	
	// Start with the franchise that received RFA rights
	var currentHolder = conversion.franchiseId;
	
	// Look for trades that transferred these RFA rights after conversion but before auction
	var trades = await Transaction.find({
		type: 'trade',
		'parties.receives.rfaRights.playerId': playerId,
		timestamp: {
			$gt: conversion.timestamp,
			$lt: auctionTimestamp
		}
	}).sort({ timestamp: 1 });
	
	// Trace through each trade
	for (var i = 0; i < trades.length; i++) {
		var trade = trades[i];
		for (var j = 0; j < trade.parties.length; j++) {
			var party = trade.parties[j];
			var hasRfaRights = party.receives.rfaRights && party.receives.rfaRights.some(function(r) {
				return r.playerId.toString() === playerId.toString();
			});
			if (hasRfaRights) {
				currentHolder = party.franchiseId;
				break;
			}
		}
	}
	
	return {
		holderId: currentHolder,
		conversionTx: conversion
	};
}

// Normalize player name for matching
function normalizeForMatch(name) {
	return resolver.normalizePlayerName(name);
}

// Key dates by year (from doc/summer-meetings.txt)
var auctionDates = {
	2008: '2008-08-18', 2009: '2009-08-16', 2010: '2010-08-22', 2011: '2011-08-20',
	2012: '2012-08-25', 2013: '2013-08-24', 2014: '2014-08-23', 2015: '2015-08-29',
	2016: '2016-08-20', 2017: '2017-08-19', 2018: '2018-08-25', 2019: '2019-08-24',
	2020: '2020-08-29', 2021: '2021-08-28', 2022: '2022-08-27', 2023: '2023-08-26',
	2024: '2024-08-24', 2025: '2025-08-23'
};

var contractDueDates = {
	2008: '2008-08-24', 2009: '2009-09-02', 2010: '2010-08-31', 2011: '2011-08-26',
	2012: '2012-09-01', 2013: '2013-08-31', 2014: '2014-08-31', 2015: '2015-09-05',
	2016: '2016-08-28', 2017: '2017-08-27', 2018: '2018-09-01', 2019: '2019-09-01',
	2020: '2020-09-07', 2021: '2021-09-06', 2022: '2022-09-05', 2023: '2023-09-04',
	2024: '2024-09-02', 2025: '2025-09-01'
};

// Convert ET to UTC (handles DST)
function etToUtc(year, month, day, hours, mins, secs) {
	// Find 2nd Sunday of March (DST start)
	var marchFirst = new Date(Date.UTC(year, 2, 1));
	var marchFirstDay = marchFirst.getUTCDay();
	var dstStartDay = 8 + (7 - marchFirstDay) % 7;
	var dstStart = Date.UTC(year, 2, dstStartDay, 7, 0);
	
	// Find 1st Sunday of November (DST end)
	var novFirst = new Date(Date.UTC(year, 10, 1));
	var novFirstDay = novFirst.getUTCDay();
	var dstEndDay = 1 + (7 - novFirstDay) % 7;
	var dstEnd = Date.UTC(year, 10, dstEndDay, 6, 0);
	
	var utcAsEt = Date.UTC(year, month, day, hours, mins, secs || 0);
	var offset = (utcAsEt >= dstStart && utcAsEt < dstEnd) ? 4 : 5;
	
	return new Date(utcAsEt + offset * 60 * 60 * 1000);
}

// Parse date string and create timestamp at given ET time
function makeTimestamp(dateStr, hours, mins, secs) {
	var parts = dateStr.split('-');
	var year = parseInt(parts[0], 10);
	var month = parseInt(parts[1], 10) - 1;
	var day = parseInt(parts[2], 10);
	return etToUtc(year, month, day, hours, mins, secs || 0);
}

// Build reverse lookup for owner names
// Maps year -> ownerName -> franchiseId
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

function getFranchiseId(ownerName, season) {
	if (!ownerName) return null;
	var name = ownerName.trim();
	// Try exact match for the season
	if (ownerToFranchiseByYear[season] && ownerToFranchiseByYear[season][name]) {
		return ownerToFranchiseByYear[season][name];
	}
	// Fallback to franchiseIds (current aliases)
	if (PSO.franchiseIds[name]) {
		return PSO.franchiseIds[name];
	}
	return null;
}

async function run() {
	var args = process.argv.slice(2);
	var year = parseInt(args.find(function(a) { return !a.startsWith('--'); }), 10);
	var dryRun = args.includes('--dry-run');
	var skipAmbiguous = args.includes('--skip-ambiguous');
	var autoHistorical = args.includes('--auto-historical');
	
	if (!year || isNaN(year)) {
		console.log('Usage: node data/seed/auction.js <year> [--dry-run] [--skip-ambiguous] [--auto-historical]');
		process.exit(1);
	}
	
	console.log('Processing contracts for ' + year + (dryRun ? ' (DRY RUN)' : ''));
	console.log('');
	
	// Load contract file
	var contractsPath = path.join(__dirname, '../archive/snapshots/contracts-' + year + '.txt');
	if (!fs.existsSync(contractsPath)) {
		console.log('File not found: ' + contractsPath);
		process.exit(1);
	}
	
	var content = fs.readFileSync(contractsPath, 'utf8');
	var lines = content.trim().split('\n');
	var header = snapshotFacts.parseCSVLine(lines[0]);
	
	// Parse CSV (format: ID,Owner,Name,Position,Start,End,Salary)
	// Uses parseCSVLine to handle quoted fields like "Ted Ginn, Jr."
	var contracts = [];
	for (var i = 1; i < lines.length; i++) {
		var cols = snapshotFacts.parseCSVLine(lines[i]);
		if (cols.length < 7) continue;
		
		var espnId = cols[0];
		contracts.push({
			espnId: espnId !== '-1' ? espnId : null,
			owner: cols[1],
			player: cols[2],
			position: cols[3],
			start: cols[4],
			end: cols[5],
			salary: parseInt(cols[6].replace('$', ''), 10)
		});
	}
	
	console.log('Loaded ' + contracts.length + ' contracts from file');
	console.log('');
	
	// Get dates
	var auctionDate = auctionDates[year];
	var contractDueDate = contractDueDates[year];
	
	if (!auctionDate || !contractDueDate) {
		console.log('No dates configured for year ' + year);
		process.exit(1);
	}
	
	console.log('Auction date: ' + auctionDate);
	console.log('Contract due date: ' + contractDueDate);
	console.log('');
	
	// Load franchises for ID lookup
	var franchises = await Franchise.find({}).lean();
	var franchiseById = {};
	franchises.forEach(function(f) {
		franchiseById[f.rosterId] = f._id;
	});
	
	// Load trades to find unsigned players traded before signing
	// If Owner A wins a player at auction, trades them unsigned to Owner B,
	// and Owner B signs them, the contract snapshot shows Owner B
	// but we want to credit Owner A for the auction win
	var tradeFacts = require('../facts/trade-facts');
	var allTrades = tradeFacts.checkAvailability() ? tradeFacts.loadAll() : [];
	
	// Build map: playerName (lowercase) -> original owner who traded away an unsigned player
	var unsignedTradedBy = {};
	allTrades.forEach(function(trade) {
		if (trade.date.getFullYear() !== year) return;
		if (trade.parties.length !== 2) return;
		
		trade.parties.forEach(function(receivingParty, idx) {
			var givingParty = trade.parties[idx === 0 ? 1 : 0];
			receivingParty.players.forEach(function(player) {
				// Only care about unsigned players
				if (player.contractStr !== 'unsigned') return;
				
				var key = player.name.toLowerCase();
				if (!unsignedTradedBy[key]) {
					unsignedTradedBy[key] = givingParty.owner;
				}
			});
		});
	});
	
	if (Object.keys(unsignedTradedBy).length > 0) {
		console.log('Found ' + Object.keys(unsignedTradedBy).length + ' unsigned players traded this year');
		console.log('');
	}
	
	// Get existing draft picks for this year (to identify rookies)
	var draftPicks = await Transaction.find({
		type: 'draft-select',
		timestamp: {
			$gte: new Date(year, 0, 1),
			$lt: new Date(year + 1, 0, 1)
		}
	}).populate('playerId', 'name').lean();
	
	var rookiePlayerIds = new Set();
	draftPicks.forEach(function(dp) {
		if (dp.playerId) {
			rookiePlayerIds.add(dp.playerId._id.toString());
		}
	});
	
	console.log('Found ' + rookiePlayerIds.size + ' rookie draft picks for ' + year);
	console.log('');
	
	// Filter to new contracts this year
	var newContracts = contracts.filter(function(c) {
		return c.start === String(year);
	});
	
	console.log('New contracts (Start=' + year + '): ' + newContracts.length);
	console.log('');
	
	var stats = {
		auctionCreated: 0,
		contractCreated: 0,
		skippedRookie: 0,
		skippedExisting: 0,
		errors: []
	};
	
	// Timestamps
	var auctionTimestamp = makeTimestamp(auctionDate, 9, 0, 0); // 9:00:00 AM ET
	var contractTimestamp = makeTimestamp(contractDueDate, 12, 0, 0); // 12:00:00 PM ET
	
	// Load all players for matching
	var allPlayers = await Player.find({}).lean();
	var playersByNormalizedName = {};
	allPlayers.forEach(function(p) {
		var norm = normalizeForMatch(p.name);
		if (!playersByNormalizedName[norm]) {
			playersByNormalizedName[norm] = [];
		}
		playersByNormalizedName[norm].push(p);
	});
	
	// Build ESPN ID → Player lookup from Sleeper data
	var sleeperDataPath = path.join(__dirname, '../../public/data/sleeper-data.json');
	var sleeperData = JSON.parse(fs.readFileSync(sleeperDataPath, 'utf8'));
	var playerByEspnId = {};
	Object.values(sleeperData).forEach(function(sp) {
		if (sp.espn_id) {
			// Find the Player document with this sleeperId
			var player = allPlayers.find(function(p) { return p.sleeperId === sp.player_id; });
			if (player) {
				playerByEspnId[String(sp.espn_id)] = player;
			}
		}
	});
	console.log('Built ESPN ID lookup with ' + Object.keys(playerByEspnId).length + ' entries');
	console.log('');
	
	// Create readline interface for prompts
	var readline = require('readline');
	var rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout
	});
	
	for (var i = 0; i < newContracts.length; i++) {
		var c = newContracts[i];
		
		// Skip rows with no owner (free agents)
		if (!c.owner || c.owner.trim() === '') {
			continue;
		}
		
		console.log('--- ' + c.player + ' (' + c.owner + ') ---');
		
		// Build context with franchise for strong keys
		var context = { year: year, type: 'auction', franchise: c.owner };
		
		var playerResult = null;
		var resultAction = null;
		
		// Try ESPN ID lookup first (for historical data with IDs)
		// But verify name matches - old ESPN IDs don't always match Sleeper's ESPN ID mappings
		if (c.espnId && playerByEspnId[c.espnId]) {
			var espnMatch = playerByEspnId[c.espnId];
			var inputNorm = normalizeForMatch(c.player);
			var matchNorm = normalizeForMatch(espnMatch.name);
			
			if (inputNorm === matchNorm) {
				playerResult = espnMatch;
				resultAction = 'matched';
				console.log('  → ' + playerResult.name + ' (via ESPN ID)');
			} else {
				console.log('  ✗ ESPN ID mismatch: "' + c.player + '" vs "' + espnMatch.name + '" - falling back to name');
			}
		}
		
		if (!playerResult) {
			// Get candidates by normalized name
			var normalizedName = normalizeForMatch(c.player);
			var candidates = playersByNormalizedName[normalizedName] || [];
			
			// Use unified prompt
			var result = await resolver.promptForPlayer({
				name: c.player,
				context: context,
				candidates: candidates,
				position: c.position,
				Player: Player,
				rl: skipAmbiguous ? null : rl,
				playerCache: playersByNormalizedName,
				autoHistorical: autoHistorical,
				dryRun: dryRun
			});
			
			if (result.action === 'quit') {
				console.log('\nQuitting...');
				rl.close();
				await mongoose.disconnect();
				process.exit(130);
			}
			
			if (result.action === 'skipped' || !result.player) {
				stats.errors.push('Skipped: ' + c.player);
				continue;
			}
			
			playerResult = result.player;
			resultAction = result.action;
		}
		
		if (resultAction === 'matched') {
			// Already logged for ESPN ID matches
		} else if (resultAction === 'created') {
			console.log('  + Created: ' + playerResult.name);
		}
		
		var playerId = playerResult._id;
		var isRookie = rookiePlayerIds.has(playerId.toString());
		
		// Resolve current owner (for contract)
		var rosterId = getFranchiseId(c.owner, year);
		if (!rosterId) {
			console.log('  ✗ Could not resolve franchise: ' + c.owner);
			stats.errors.push('Could not resolve franchise: ' + c.owner + ' for ' + c.player);
			continue;
		}
		var franchiseId = franchiseById[rosterId];
		
		// Check if this player was traded while unsigned - if so, auction goes to original owner
		var auctionFranchiseId = franchiseId;
		var playerKey = c.player.toLowerCase();
		if (unsignedTradedBy[playerKey]) {
			var originalOwner = unsignedTradedBy[playerKey];
			console.log('  → Player was traded unsigned from ' + originalOwner + ' to ' + c.owner);
			var originalRosterId = getFranchiseId(originalOwner, year);
			if (originalRosterId && franchiseById[originalRosterId]) {
				auctionFranchiseId = franchiseById[originalRosterId];
			}
		}
		if (!franchiseId) {
			console.log('  ✗ No franchise found for rosterId: ' + rosterId);
			stats.errors.push('No franchise for rosterId ' + rosterId);
			continue;
		}
		
		var startYear = parseInt(c.start, 10);
		var endYear = parseInt(c.end, 10);
		
		// Skip rows with invalid years
		if (isNaN(startYear) || isNaN(endYear)) {
			console.log('  ✗ Invalid years (start=' + c.start + ', end=' + c.end + '), skipping');
			stats.errors.push('Invalid years for ' + c.player + ' (start=' + c.start + ', end=' + c.end + ')');
			continue;
		}
		
		// Check for existing transactions
		var existingAuction = await Transaction.findOne({
			type: { $in: ['auction-ufa', 'auction-rfa-matched', 'auction-rfa-unmatched'] },
			playerId: playerId,
			timestamp: {
				$gte: new Date(year, 0, 1),
				$lt: new Date(year + 1, 0, 1)
			}
		});
		
		var existingContract = await Transaction.findOne({
			type: 'contract',
			playerId: playerId,
			timestamp: {
				$gte: new Date(year, 0, 1),
				$lt: new Date(year + 1, 0, 1)
			}
		});
		
		// Create auction transaction (if not a rookie)
		if (isRookie) {
			console.log('  → Rookie (skipping auction)');
			stats.skippedRookie++;
		} else if (existingAuction) {
			console.log('  → Auction already exists (skipping)');
			stats.skippedExisting++;
		} else {
			var auctionOwnerName = unsignedTradedBy[playerKey] || c.owner;
			
			// Determine auction type: check for RFA rights
			var rfaInfo = await findRfaHolder(playerId, auctionTimestamp);
			var auctionType = 'auction-ufa';
			var rfaHolderId = null;
			
			if (rfaInfo) {
				rfaHolderId = rfaInfo.holderId;
				if (rfaInfo.holderId.toString() === auctionFranchiseId.toString()) {
					auctionType = 'auction-rfa-matched';
				} else {
					auctionType = 'auction-rfa-unmatched';
				}
			}
			
			console.log('  + ' + auctionType + ': ' + playerResult.name + ' → ' + auctionOwnerName);
			
			if (!dryRun) {
				var txData = {
					type: auctionType,
					timestamp: auctionTimestamp,
					source: 'snapshot',
					franchiseId: auctionFranchiseId,
					playerId: playerId,
					salary: c.salary
				};
				
				// For RFA auctions, track the RFA holder
				if (rfaHolderId) {
					txData.rfaHolderId = rfaHolderId;
				}
				
				await Transaction.create(txData);
			}
			stats.auctionCreated++;
		}
		
		// Create contract transaction
		if (existingContract) {
			console.log('  → Contract already exists (skipping)');
			stats.skippedExisting++;
		} else {
			console.log('  + contract: $' + c.salary + ' ' + startYear + '-' + endYear);
			
			if (!dryRun) {
				await Transaction.create({
					type: 'contract',
					timestamp: contractTimestamp,
					source: 'snapshot',
					franchiseId: franchiseId,
					playerId: playerId,
					salary: c.salary,
					startYear: startYear,
					endYear: endYear
				});
			}
			stats.contractCreated++;
		}
		
		console.log('');
	}
	
	// Summary
	console.log('=== Summary ===');
	console.log('Auction transactions created: ' + stats.auctionCreated);
	console.log('Contract transactions created: ' + stats.contractCreated);
	console.log('Skipped (rookie): ' + stats.skippedRookie);
	console.log('Skipped (existing): ' + stats.skippedExisting);
	
	if (stats.errors.length > 0) {
		console.log('');
		console.log('Errors (' + stats.errors.length + '):');
		stats.errors.forEach(function(e) {
			console.log('  - ' + e);
		});
	}
	
	rl.close();
	process.exit(0);
}

run().catch(function(err) {
	console.error('Error:', err);
	process.exit(1);
});
