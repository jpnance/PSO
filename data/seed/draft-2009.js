#!/usr/bin/env node
/**
 * Seed 2009 rookie draft picks and selections from inference.
 * 
 * This creates:
 *   - Pick documents for all 100 picks (10 rounds × 10 owners)
 *   - draft-select Transaction documents for the 26 identified selections
 * 
 * Usage:
 *   docker compose run --rm -it web node data/seed/draft-2009.js
 *   docker compose run --rm -it web node data/seed/draft-2009.js --clear
 *   docker compose run --rm -it web node data/seed/draft-2009.js --dry-run
 */

var dotenv = require('dotenv').config({ path: __dirname + '/../../.env' });
var mongoose = require('mongoose');
var fs = require('fs');
var readline = require('readline');

var Franchise = require('../../models/Franchise');
var Pick = require('../../models/Pick');
var Player = require('../../models/Player');
var Transaction = require('../../models/Transaction');
var PSO = require('../../config/pso.js');
var resolver = require('../utils/player-resolver');
var facts = require('../facts');

mongoose.connect(process.env.MONGODB_URI);

// 2009 draft order (same every round, not snake)
var DRAFT_ORDER = ['Daniel', 'Patrick', 'Syed', 'John', 'Koci', 'Luke', 'Trevor', 'James', 'Keyon', 'Schexes'];

// 2009 rookie salaries - averages of top 10 salaries (from rookies.php)
var POSITION_AVERAGES = {
	'DB': 12.4, 'DL': 13.4, 'K': 2.2, 'LB': 14,
	'QB': 124.5, 'RB': 270.2, 'TE': 53, 'WR': 137.3
};

function computeSalary(avg, round) {
	return Math.ceil(avg * (11 - round) / 10);
}

function buildSalaryToRound() {
	var lookup = {};
	Object.keys(POSITION_AVERAGES).forEach(function(pos) {
		lookup[pos] = {};
		var avg = POSITION_AVERAGES[pos];
		for (var round = 1; round <= 10; round++) {
			var salary = computeSalary(avg, round);
			if (!lookup[pos][salary]) {
				lookup[pos][salary] = round;
			}
		}
	});
	return lookup;
}

function normalizeOwner(owner) {
	if (owner === 'Jake/Luke') return 'Luke';
	return owner;
}

// Map owner names to rosterId for 2009
var ownerAliases = {
	'Daniel': 8, 'Patrick': 1, 'Syed': 3, 'John': 4, 'Koci': 2,
	'Luke': 7, 'Trevor': 5, 'James': 9, 'Keyon': 6, 'Schexes': 10
};

function getRosterId(ownerName) {
	return ownerAliases[normalizeOwner(ownerName)] || null;
}

// Load NFL draft for 2009
function loadNflDraft() {
	var filepath = __dirname + '/../archive/snapshots/nfl-draft-2009.txt';
	if (!fs.existsSync(filepath)) {
		console.error('NFL draft file not found:', filepath);
		return {};
	}
	
	var content = fs.readFileSync(filepath, 'utf8');
	var players = {};
	
	content.split('\n').forEach(function(line) {
		if (line.startsWith('Rnd') || line.startsWith('from ') || !line.trim()) return;
		var cols = line.split(',');
		if (cols.length < 5) return;
		var name = cols[3].trim();
		if (name) {
			players[name.toLowerCase()] = {
				nflRound: parseInt(cols[0]),
				nflPick: parseInt(cols[1]),
				nflPos: cols[4].trim()
			};
		}
	});
	
	return players;
}

// Find drafted rookies from snapshot facts
function findDraftedRookies(nflDraft, salaryToRound) {
	var snapshots = facts.snapshots.loadAll(2009, 2009);
	var seen = {};
	var rookies = [];
	
	snapshots.forEach(function(s) {
		if (s.startYear !== 2009 || !s.owner) return;
		var key = s.playerName.toLowerCase();
		if (seen[key]) return;
		seen[key] = true;
		
		var nflInfo = nflDraft[key];
		if (!nflInfo) return;
		
		var pos = s.position ? s.position.split('/')[0] : null;
		var round = pos && salaryToRound[pos] ? salaryToRound[pos][s.salary] : null;
		
		if (!round) return;
		
		var owner = normalizeOwner(s.owner);
		var slot = DRAFT_ORDER.indexOf(owner);
		if (slot < 0) return;
		
		var pick = (round - 1) * 10 + slot + 1;
		
		rookies.push({
			pickNumber: pick,
			round: round,
			slot: slot + 1,
			owner: s.owner,
			name: s.playerName,
			pos: s.position,
			salary: s.salary,
			nflInfo: nflInfo
		});
	});
	
	return rookies;
}

// Global state
var rl = null;
var playersByNormalizedName = {};
var franchiseByRosterId = {};

async function resolvePlayer(playerName, context) {
	var normalizedName = resolver.normalizePlayerName(playerName);
	var candidates = playersByNormalizedName[normalizedName] || [];
	
	// Check cache
	var cached = resolver.lookup(playerName, context);
	if (cached && cached.sleeperId) {
		var player = await Player.findOne({ sleeperId: cached.sleeperId });
		if (player) return player._id;
	}
	if (cached && cached.name) {
		var player = await Player.findOne({ name: cached.name, sleeperId: null });
		if (player) return player._id;
	}
	
	// Single non-ambiguous match
	if (candidates.length === 1 && !resolver.isAmbiguous(normalizedName)) {
		return candidates[0]._id;
	}
	
	// Auto-create for 2009 (historical)
	if (candidates.length === 0) {
		var existing = await Player.findOne({ name: playerName, sleeperId: null });
		if (existing) {
			resolver.addResolution(playerName, null, playerName, context);
			resolver.save();
			return existing._id;
		}
		
		console.log('  Auto-creating historical: ' + playerName);
		var player = await Player.create({
			name: playerName,
			positions: [],
			sleeperId: null
		});
		if (!playersByNormalizedName[normalizedName]) {
			playersByNormalizedName[normalizedName] = [];
		}
		playersByNormalizedName[normalizedName].push(player);
		resolver.addResolution(playerName, null, playerName, context);
		resolver.save();
		return player._id;
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
	
	return result.player ? result.player._id : null;
}

async function run() {
	var args = {
		dryRun: process.argv.includes('--dry-run'),
		clear: process.argv.includes('--clear')
	};
	
	console.log('Seeding 2009 rookie draft');
	if (args.dryRun) console.log('[DRY RUN]');
	console.log('');
	
	// Load player resolutions
	console.log('Loaded', resolver.count(), 'cached player resolutions');
	
	// Create readline interface
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
	console.log('Loaded', allPlayers.length, 'players from database');
	
	// Load franchises
	var franchises = await Franchise.find({});
	franchises.forEach(function(f) {
		if (f.rosterId) {
			franchiseByRosterId[f.rosterId] = f._id;
		}
	});
	console.log('Loaded', franchises.length, 'franchises');
	
	// Clear existing if requested
	if (args.clear && !args.dryRun) {
		console.log('\nClearing existing 2009 draft data...');
		
		// Find 2009 picks
		var existingPicks = await Pick.find({ season: 2009 });
		var pickIds = existingPicks.map(function(p) { return p._id; });
		
		// Delete transactions linked to these picks
		await Transaction.deleteMany({ pickId: { $in: pickIds } });
		
		// Delete the picks
		var deleted = await Pick.deleteMany({ season: 2009 });
		console.log('  Deleted', deleted.deletedCount, 'picks');
	}
	
	// Load NFL draft data
	var nflDraft = loadNflDraft();
	console.log('Loaded', Object.keys(nflDraft).length, 'NFL draft picks');
	
	// Build salary lookup
	var salaryToRound = buildSalaryToRound();
	
	// Find drafted rookies
	var draftedRookies = findDraftedRookies(nflDraft, salaryToRound);
	console.log('Found', draftedRookies.length, 'drafted rookies from inference');
	
	// Build lookup by pick number
	var rookieByPick = {};
	draftedRookies.forEach(function(r) {
		rookieByPick[r.pickNumber] = r;
	});
	
	console.log('\n=== Creating Pick documents ===\n');
	
	// Draft timestamp: August 15, 2009
	var draftTimestamp = new Date('2009-08-15T12:00:00Z');
	
	var picksCreated = 0;
	var selectionsCreated = 0;
	var errors = [];
	
	// Create all 100 picks
	for (var pickNum = 1; pickNum <= 100; pickNum++) {
		var round = Math.ceil(pickNum / 10);
		var slot = ((pickNum - 1) % 10);
		var ownerName = DRAFT_ORDER[slot];
		var rosterId = getRosterId(ownerName);
		var franchiseId = franchiseByRosterId[rosterId];
		
		if (!franchiseId) {
			errors.push('Pick #' + pickNum + ': No franchise for ' + ownerName);
			continue;
		}
		
		// Check if pick already exists
		var existingPick = await Pick.findOne({ season: 2009, pickNumber: pickNum });
		if (existingPick) {
			continue;
		}
		
		var rookie = rookieByPick[pickNum];
		var status = rookie ? 'used' : 'passed';
		
		if (!args.dryRun) {
			var pick = await Pick.create({
				pickNumber: pickNum,
				round: round,
				season: 2009,
				originalFranchiseId: franchiseId,
				currentFranchiseId: franchiseId,
				status: status
			});
			
			// Create transaction if player was selected
			if (rookie) {
				var context = { year: 2009, type: 'draft', franchise: rookie.owner };
				var playerId;
				
				try {
					playerId = await resolvePlayer(rookie.name, context);
				} catch (err) {
					if (err.message === 'User quit') {
						console.log('\nQuitting...');
						break;
					}
					throw err;
				}
				
				if (playerId) {
					var transaction = await Transaction.create({
						type: 'draft-select',
						timestamp: draftTimestamp,
						source: 'snapshot',
						franchiseId: franchiseId,
						playerId: playerId,
						pickId: pick._id,
						salary: rookie.salary
					});
					
					pick.transactionId = transaction._id;
					await pick.save();
					
					selectionsCreated++;
					console.log('  #' + pickNum + ' R' + round + ' ' + ownerName + ': ' + rookie.name + ' ($' + rookie.salary + ')');
				} else {
					errors.push('Pick #' + pickNum + ': Could not resolve ' + rookie.name);
				}
			}
		}
		
		picksCreated++;
	}
	
	// Save resolutions
	resolver.save();
	
	console.log('\nDone!');
	console.log('  Picks created:', picksCreated);
	console.log('  Selections created:', selectionsCreated);
	console.log('  Passed picks:', picksCreated - selectionsCreated);
	
	if (errors.length > 0) {
		console.log('\nErrors:');
		errors.forEach(function(e) {
			console.log('  - ' + e);
		});
	}
	
	rl.close();
	process.exit(0);
}

run().catch(function(err) {
	console.error('Error:', err);
	if (rl) rl.close();
	process.exit(1);
});
