#!/usr/bin/env node
/**
 * Seed 2009 auction results.
 * 
 * Uses 2009.txt as the post-auction snapshot (before in-auction trades).
 * Cross-references 2008 RFA rights to determine transaction type:
 *   - auction-ufa: no RFA rights existed
 *   - auction-rfa-matched: RFA holder retained the player
 *   - auction-rfa-unmatched: different owner won the player
 * 
 * Usage:
 *   docker compose run --rm web node data/seed/auction-2009.js
 *   docker compose run --rm web node data/seed/auction-2009.js --dry-run
 */

require('dotenv').config();

var fs = require('fs');
var readline = require('readline');
var mongoose = require('mongoose');

var Franchise = require('../../models/Franchise');
var Player = require('../../models/Player');
var Regime = require('../../models/Regime');
var Transaction = require('../../models/Transaction');
var resolver = require('../utils/player-resolver');

mongoose.connect(process.env.MONGODB_URI);

// 2009 dates from summer-meetings.txt
var AUCTION_DATE = new Date(Date.UTC(2009, 7, 16, 16, 0, 0)); // Aug 16, 2009 12:00 ET
var CONTRACT_DUE_DATE = new Date(Date.UTC(2009, 8, 2, 23, 59, 33)); // Sept 2, 2009 end of day :33

var dryRun = false;
var rl = null;
var playersByNormalizedName = {};
var franchiseByRosterId = {};
var franchiseByName = {};

// Owner name mappings
var ownerAliases = {
	'Patrick': 1, 'Koci': 2, 'Syed': 3, 'John': 4, 'Trevor': 5,
	'Keyon': 6, 'Jake/Luke': 7, 'Luke': 7, 'Daniel': 8, 'James': 9, 'Schexes': 10
};

function normalizeOwner(owner) {
	if (owner === 'Jake/Luke') return 'Luke';
	return owner;
}

function getRosterId(ownerName) {
	return ownerAliases[ownerName] || ownerAliases[normalizeOwner(ownerName)] || null;
}

/**
 * Load auction results from 2009.txt
 * This file represents the post-auction state (before in-auction trades).
 * Returns map of playerName -> ownerName
 */
function loadAuctionResults() {
	var filepath = __dirname + '/../archive/sources/txt/2009.txt';
	var content = fs.readFileSync(filepath, 'utf8');
	var lines = content.split('\n');
	
	var rosters = {}; // playerName -> ownerName
	var currentOwner = null;
	
	lines.forEach(function(line) {
		line = line.trim();
		if (!line) {
			currentOwner = null;
			return;
		}
		
		// Check if this is an owner line
		if (/^(Patrick|Koci|Syed|John|Trevor|Keyon|Daniel|James|Schexes|Jake\/Luke)$/.test(line)) {
			currentOwner = line;
			return;
		}
		
		// Player line: "QB Jason Campbell" or "RB/WR Reggie Wayne"
		var match = line.match(/^(?:QB|RB|WR|TE|LB|DL|DB|DP|K|BE|RB\/WR|WR\/TE)\s+(.+)$/);
		if (match && currentOwner) {
			var playerName = match[1].trim();
			rosters[playerName] = currentOwner;
		}
	});
	
	return rosters;
}

/**
 * Load salary data from contracts-2009.txt
 * Returns map of playerName -> salary
 */
function loadSalaries() {
	var filepath = __dirname + '/../archive/snapshots/contracts-2009.txt';
	var content = fs.readFileSync(filepath, 'utf8');
	var lines = content.split('\n');
	
	var salaries = {};
	
	lines.forEach(function(line) {
		// Format: ID,Owner,Name,Position,Start,End,Salary
		var parts = line.split(',');
		if (parts.length < 7) return;
		
		var name = parts[2].trim();
		var salaryStr = parts[6].trim();
		if (!name || !salaryStr) return;
		
		// Parse salary (remove $ sign)
		var salary = parseInt(salaryStr.replace('$', ''));
		if (!isNaN(salary)) {
			salaries[name] = salary;
		}
	});
	
	return salaries;
}

/**
 * Load 2008 RFA rights from database
 * Returns map of playerId -> franchiseId
 */
async function loadRfaRights() {
	var rfaTxns = await Transaction.find({
		type: 'rfa-rights-conversion',
		timestamp: { $gte: new Date('2009-01-01'), $lt: new Date('2009-02-01') }
	});
	
	var rights = {};
	rfaTxns.forEach(function(txn) {
		rights[txn.playerId.toString()] = txn.franchiseId.toString();
	});
	
	return rights;
}

async function resolvePlayer(playerName, context) {
	var normalizedName = resolver.normalizePlayerName(playerName);
	var candidates = playersByNormalizedName[normalizedName] || [];
	
	// Check cache
	var cached = resolver.lookup(playerName, context);
	if (cached && cached.sleeperId) {
		var player = await Player.findOne({ sleeperId: cached.sleeperId });
		if (player) return player;
	}
	if (cached && cached.name) {
		var player = await Player.findOne({ name: cached.name });
		if (player) return player;
	}
	
	// Single non-ambiguous match
	if (candidates.length === 1 && !resolver.isAmbiguous(normalizedName)) {
		return candidates[0];
	}
	
	// Exact name match
	if (candidates.length === 0) {
		var exactMatch = await Player.findOne({ name: playerName });
		if (exactMatch) return exactMatch;
	}
	
	// Use unified prompt
	var result = await resolver.promptForPlayer({
		name: playerName,
		context: context,
		candidates: candidates,
		Player: Player,
		rl: rl,
		playerCache: playersByNormalizedName
	});
	
	if (result.action === 'quit') {
		throw new Error('User quit');
	}
	
	return result.player || null;
}

async function run() {
	dryRun = process.argv.includes('--dry-run');
	var skipUnresolved = process.argv.includes('--skip-unresolved');
	
	console.log('=== 2009 Auction Seeder ===');
	if (dryRun) console.log('[DRY RUN]');
	console.log('');
	console.log('Auction date:', AUCTION_DATE.toISOString());
	console.log('Contract due:', CONTRACT_DUE_DATE.toISOString());
	console.log('');
	
	// Setup readline
	rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout
	});
	
	// Load players
	var allPlayers = await Player.find({});
	allPlayers.forEach(function(p) {
		var normalized = resolver.normalizePlayerName(p.name);
		if (!playersByNormalizedName[normalized]) {
			playersByNormalizedName[normalized] = [];
		}
		playersByNormalizedName[normalized].push(p);
	});
	console.log('Loaded', allPlayers.length, 'players');
	
	// Load franchises
	var franchises = await Franchise.find({});
	franchises.forEach(function(f) {
		if (f.rosterId) {
			franchiseByRosterId[f.rosterId] = f;
		}
	});
	console.log('Loaded', franchises.length, 'franchises');
	
	// Load regime names for display
	var regimes = await Regime.find({});
	var regimeNames = {};
	regimes.forEach(function(r) {
		r.tenures.forEach(function(t) {
			if (t.startSeason <= 2009 && (!t.endSeason || t.endSeason >= 2009)) {
				regimeNames[t.franchiseId.toString()] = r.displayName;
			}
		});
	});
	
	// Load 2008 RFA rights
	var rfaRights = await loadRfaRights();
	console.log('Loaded', Object.keys(rfaRights).length, 'RFA rights from 2008');
	
	// Load auction results from 2009.txt (post-auction, pre-trade snapshot)
	var auctionWinners = loadAuctionResults();
	console.log('Loaded', Object.keys(auctionWinners).length, 'auction winners from 2009.txt');
	
	// Load salaries from contracts-2009.txt
	var salaries = loadSalaries();
	console.log('Loaded', Object.keys(salaries).length, 'salaries from contracts-2009.txt');
	console.log('');
	
	// Check for existing auction transactions (including lapse transactions)
	var existingCount = await Transaction.countDocuments({
		type: { $in: ['auction-ufa', 'auction-rfa-matched', 'auction-rfa-unmatched', 'rfa-rights-lapsed'] },
		timestamp: AUCTION_DATE
	});
	
	if (existingCount > 0 && !dryRun) {
		console.log('Found', existingCount, 'existing 2009 auction transactions.');
		var answer = await new Promise(function(resolve) {
			rl.question('Clear and re-seed? [y/N] ', resolve);
		});
		
		if (answer.toLowerCase() === 'y') {
			await Transaction.deleteMany({
				type: { $in: ['auction-ufa', 'auction-rfa-matched', 'auction-rfa-unmatched', 'rfa-rights-lapsed'] },
				timestamp: AUCTION_DATE
			});
			console.log('Cleared existing auction and lapse transactions.');
		} else {
			console.log('Aborting.');
			rl.close();
			process.exit(0);
		}
	}
	
	console.log('\n=== Creating Auction Transactions ===\n');
	
	var counts = { ufa: 0, rfaMatched: 0, rfaUnmatched: 0, errors: 0 };
	var exercisedRfaPlayerIds = new Set(); // Track RFA rights exercised during auction
	
	// Process each auction winner
	var playerNames = Object.keys(auctionWinners).sort();
	
	for (var playerName of playerNames) {
		var ownerName = auctionWinners[playerName];
		var rosterId = getRosterId(ownerName);
		var franchise = franchiseByRosterId[rosterId];
		
		if (!franchise) {
			console.log('ERROR: No franchise for owner', ownerName);
			counts.errors++;
			continue;
		}
		
		var context = { year: 2009, type: 'auction', franchise: ownerName };
		var player;
		
		if (skipUnresolved) {
			// Try to resolve without prompting
			var normalizedName = resolver.normalizePlayerName(playerName);
			var candidates = playersByNormalizedName[normalizedName] || [];
			
			// Check cache
			var cached = resolver.lookup(playerName, context);
			if (cached && cached.sleeperId) {
				player = await Player.findOne({ sleeperId: cached.sleeperId });
			} else if (cached && cached.name) {
				player = await Player.findOne({ name: cached.name });
			} else if (candidates.length === 1 && !resolver.isAmbiguous(normalizedName)) {
				player = candidates[0];
			} else {
				player = await Player.findOne({ name: playerName });
			}
			
			if (!player) {
				console.log('SKIPPED: Could not auto-resolve', playerName);
				counts.errors++;
				continue;
			}
		} else {
			try {
				player = await resolvePlayer(playerName, context);
			} catch (err) {
				if (err.message === 'User quit') {
					console.log('\nQuitting...');
					break;
				}
				throw err;
			}
			
			if (!player) {
				console.log('ERROR: Could not resolve player', playerName);
				counts.errors++;
				continue;
			}
		}
		
		// Determine transaction type based on RFA rights
		var rfaHolder = rfaRights[player._id.toString()];
		var type;
		
		if (!rfaHolder) {
			// No RFA rights - UFA
			type = 'auction-ufa';
			counts.ufa++;
		} else if (rfaHolder === franchise._id.toString()) {
			// RFA holder retained - matched
			type = 'auction-rfa-matched';
			counts.rfaMatched++;
			exercisedRfaPlayerIds.add(player._id.toString());
		} else {
			// Different owner got them - unmatched
			type = 'auction-rfa-unmatched';
			counts.rfaUnmatched++;
			exercisedRfaPlayerIds.add(player._id.toString());
		}
		
		// Look up salary
		var salary = salaries[playerName] || salaries[player.name];
		if (!salary) {
			console.log('WARNING: No salary found for', playerName);
		}
		
		if (!dryRun) {
			await Transaction.create({
				type: type,
				timestamp: AUCTION_DATE,
				source: 'snapshot',
				franchiseId: franchise._id,
				playerId: player._id,
				winningBid: salary
			});
		}
	}
	
	resolver.save();
	
	// Now handle RFA rights that lapsed (players with 2008 RFA rights not in 2009 auction)
	// exercisedRfaPlayerIds was populated during the main auction loop above
	
	// Find RFA rights that were not exercised
	var lapsedCount = 0;
	var rfaPlayerIds = Object.keys(rfaRights);
	
	for (var i = 0; i < rfaPlayerIds.length; i++) {
		var rfaPlayerId = rfaPlayerIds[i];
		
		if (!exercisedRfaPlayerIds.has(rfaPlayerId)) {
			// This player had RFA rights but wasn't in the auction results - rights lapsed
			var lapsedPlayer = await Player.findById(rfaPlayerId);
			console.log('RFA lapsed:', lapsedPlayer ? lapsedPlayer.name : rfaPlayerId);
			
			if (!dryRun) {
				await Transaction.create({
					type: 'rfa-rights-lapsed',
					timestamp: AUCTION_DATE,
					source: 'snapshot',
					playerId: rfaPlayerId,
					franchiseId: rfaRights[rfaPlayerId] // Original RFA holder
				});
			}
			lapsedCount++;
		}
	}
	
	console.log('\n=== Summary ===');
	console.log('UFA acquisitions:', counts.ufa);
	console.log('RFA matched:', counts.rfaMatched);
	console.log('RFA unmatched:', counts.rfaUnmatched);
	console.log('RFA lapsed:', lapsedCount);
	console.log('Errors:', counts.errors);
	console.log('Total auction:', counts.ufa + counts.rfaMatched + counts.rfaUnmatched);
	
	rl.close();
	process.exit(0);
}

run().catch(function(err) {
	console.error('Error:', err);
	if (rl) rl.close();
	process.exit(1);
});
