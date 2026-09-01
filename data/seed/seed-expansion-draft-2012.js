#!/usr/bin/env node

/**
 * Seed 2012 expansion draft protections and selections.
 * 
 * Usage:
 *   node data/seed/seed-expansion-draft-2012.js --dry-run
 *   node data/seed/seed-expansion-draft-2012.js
 */

require('dotenv').config({ path: __dirname + '/../../.env' });
var mongoose = require('mongoose');

var Transaction = require('../../models/Transaction');
var Player = require('../../models/Player');
var Franchise = require('../../models/Franchise');
var resolver = require('../utils/player-resolver');

var DRY_RUN = process.argv.includes('--dry-run');

// Disambiguated Sleeper IDs for names that match multiple players
var SLEEPER_ID_OVERRIDES = {
	'alex smith': '268',      // QB (not TE 661)
	'aj green': '830',        // WR (not DB 6876)
	'chris johnson': '272',   // RB "CJ2K" (not DBs 6087, 13370)
	'frank gore': '232'       // veteran RB (not 11573)
};

// 2012 owner names to roster IDs
var OWNER_TO_ROSTER = {
	'Patrick': 1,
	'Koci': 2,
	'Syed': 3,
	'John': 4,
	'Trevor': 5,
	'Keyon': 6,
	'Jake/Luke': 7,
	'Daniel': 8,
	'James': 9,
	'Schex': 10,
	'Charles': 11,  // Now Quinn
	'Mitch': 12     // Now Mitch/Karsten
};

// Reverse lookup for display
var ROSTER_TO_OWNER = {};
Object.keys(OWNER_TO_ROSTER).forEach(function(name) {
	ROSTER_TO_OWNER[OWNER_TO_ROSTER[name]] = name;
});

// Protections data: { rosterId: [{ name, rfaRights }] }
var PROTECTIONS = {
	1: [
		{ name: 'Tom Brady', rfaRights: true },
		{ name: 'Larry Fitzgerald', rfaRights: true },
		{ name: 'Marshawn Lynch', rfaRights: false },
		{ name: 'Darrius Heyward-Bey', rfaRights: false }
	],
	2: [
		{ name: 'Ryan Fitzpatrick', rfaRights: false },
		{ name: 'Denarius Moore', rfaRights: false },
		{ name: 'Darren Sproles', rfaRights: false },
		{ name: 'Ben Tate', rfaRights: false }
	],
	3: [
		{ name: 'Eli Manning', rfaRights: false },
		{ name: 'Joe Flacco', rfaRights: false },
		{ name: 'Ryan Mathews', rfaRights: false },
		{ name: 'Sam Bradford', rfaRights: false }
	],
	4: [
		{ name: 'Darren McFadden', rfaRights: false },
		{ name: 'Willis McGahee', rfaRights: false },
		{ name: 'Alex Smith', rfaRights: false },
		{ name: 'Vincent Jackson', rfaRights: false }
	],
	5: [
		{ name: 'Cam Newton', rfaRights: false },
		{ name: 'A.J. Green', rfaRights: false },
		{ name: 'Rob Gronkowski', rfaRights: false },
		{ name: 'Reggie Bush', rfaRights: false }
	],
	6: [
		{ name: 'Jordy Nelson', rfaRights: false },
		{ name: 'Aaron Hernandez', rfaRights: false },
		{ name: 'Greg Jennings', rfaRights: false },
		{ name: 'Andy Dalton', rfaRights: false }
	],
	7: [
		{ name: 'Philip Rivers', rfaRights: true },
		{ name: 'LeSean McCoy', rfaRights: true },
		{ name: 'Jimmy Graham', rfaRights: true },
		{ name: 'Mark Sanchez', rfaRights: false }
	],
	8: [
		{ name: 'Matt Ryan', rfaRights: false },
		{ name: 'Josh Freeman', rfaRights: false },
		{ name: 'Matt Forte', rfaRights: true },
		{ name: 'Roddy White', rfaRights: true }
	],
	9: [
		{ name: 'Dez Bryant', rfaRights: false },
		{ name: 'Julio Jones', rfaRights: false },
		{ name: 'DeMarco Murray', rfaRights: false },
		{ name: 'Drew Brees', rfaRights: true }
	],
	10: [
		{ name: 'Ben Roethlisberger', rfaRights: false },
		{ name: 'Calvin Johnson', rfaRights: false },
		{ name: 'Christian Ponder', rfaRights: false },
		{ name: 'Adrian Peterson', rfaRights: true }
	]
};

// Selections data from CSV (Pick, Round, Owner, Player, Original Owner)
var SELECTIONS = [
	{ pick: 1, round: 1, owner: 'Mitch', player: 'Brandon Lloyd', fromOwner: 'Koci' },
	{ pick: 2, round: 1, owner: 'Charles', player: 'Jake Locker', fromOwner: 'Koci' },
	{ pick: 3, round: 2, owner: 'Charles', player: 'Matt Schaub', fromOwner: 'Daniel' },
	{ pick: 4, round: 2, owner: 'Mitch', player: 'Jermaine Gresham', fromOwner: 'Keyon' },
	{ pick: 5, round: 3, owner: 'Mitch', player: 'LeGarrette Blount', fromOwner: 'Patrick' },
	{ pick: 6, round: 3, owner: 'Charles', player: 'Percy Harvin', fromOwner: 'Patrick' },
	{ pick: 7, round: 4, owner: 'Charles', player: 'Malcom Floyd', fromOwner: 'Keyon' },
	{ pick: 8, round: 4, owner: 'Mitch', player: 'Peyton Manning', fromOwner: 'Trevor' },
	{ pick: 9, round: 5, owner: 'Mitch', player: 'DeMarcus Ware', fromOwner: 'James' },
	{ pick: 10, round: 5, owner: 'Charles', player: 'Jason Pierre-Paul', fromOwner: 'Jake/Luke' },
	{ pick: 11, round: 6, owner: 'Charles', player: 'Stevan Ridley', fromOwner: 'Syed' },
	{ pick: 12, round: 6, owner: 'Mitch', player: 'Eric Decker', fromOwner: 'James' },
	{ pick: 13, round: 7, owner: 'Mitch', player: 'Chris Johnson', fromOwner: 'Trevor' },
	{ pick: 14, round: 7, owner: 'Charles', player: 'Jamaal Charles', fromOwner: 'John' },
	{ pick: 15, round: 8, owner: 'Charles', player: 'Titus Young', fromOwner: 'John' },
	{ pick: 16, round: 8, owner: 'Mitch', player: 'Frank Gore', fromOwner: 'Daniel' }
];

// Timestamps
// Protections due: August 17, 2012 at 11:59pm ET (same as cuts)
var PROTECTION_TIMESTAMP = new Date('2012-08-18T03:59:00Z'); // 11:59pm ET = 03:59 UTC next day

// Expansion draft: August 21, 2012 at 8pm ET
var DRAFT_START = new Date('2012-08-22T00:00:00Z'); // 8pm ET = midnight UTC next day

async function main() {
	await mongoose.connect(process.env.MONGODB_URI);
	console.log('Connected to MongoDB\n');

	if (DRY_RUN) {
		console.log('DRY RUN - no changes will be made\n');
	}

	// Check for existing expansion draft transactions
	var existing = await Transaction.countDocuments({ 
		type: { $in: ['expansion-draft-protect', 'expansion-draft-select'] } 
	});
	if (existing > 0) {
		console.log('Found ' + existing + ' existing expansion draft transactions.');
		console.log('Delete them first if you want to re-seed.\n');
		await mongoose.disconnect();
		return;
	}

	// Build lookups
	var players = await Player.find({}).lean();
	var playerByName = {};
	var playerBySleeperId = {};
	players.forEach(function(p) {
		playerByName[resolver.normalizePlayerName(p.name)] = p;
		if (p.sleeperId) {
			playerBySleeperId[p.sleeperId] = p;
		}
	});
	
	// Helper to resolve player, checking Sleeper ID overrides first
	function resolvePlayer(name) {
		var normalized = resolver.normalizePlayerName(name);
		if (SLEEPER_ID_OVERRIDES[normalized]) {
			return playerBySleeperId[SLEEPER_ID_OVERRIDES[normalized]];
		}
		return playerByName[normalized];
	}

	var franchises = await Franchise.find({}).lean();
	var franchiseByRosterId = {};
	franchises.forEach(function(f) {
		franchiseByRosterId[f.rosterId] = f;
	});

	var transactions = [];
	var errors = [];

	// Create protection transactions
	console.log('=== Protections (August 17, 2012) ===\n');
	Object.keys(PROTECTIONS).forEach(function(rosterId) {
		var franchise = franchiseByRosterId[parseInt(rosterId)];
		if (!franchise) {
			errors.push('Unknown roster ID: ' + rosterId);
			return;
		}

		PROTECTIONS[rosterId].forEach(function(prot) {
			var player = resolvePlayer(prot.name);
			if (!player) {
				errors.push('Player not found: ' + prot.name);
				return;
			}

			console.log('  ' + ROSTER_TO_OWNER[rosterId] + ' protects ' + player.name + 
				(prot.rfaRights ? ' (RFA)' : ''));

			transactions.push({
				type: 'expansion-draft-protect',
				timestamp: PROTECTION_TIMESTAMP,
				source: 'manual',
				franchiseId: franchise._id,
				playerId: player._id,
				rfaRights: prot.rfaRights || false
			});
		});
	});

	// Create selection transactions
	console.log('\n=== Selections (August 21, 2012 at 8pm ET) ===\n');
	SELECTIONS.forEach(function(sel, idx) {
		var franchise = franchiseByRosterId[OWNER_TO_ROSTER[sel.owner]];
		var fromFranchise = franchiseByRosterId[OWNER_TO_ROSTER[sel.fromOwner]];
		var player = resolvePlayer(sel.player);

		if (!franchise) {
			errors.push('Unknown owner: ' + sel.owner);
			return;
		}
		if (!fromFranchise) {
			errors.push('Unknown original owner: ' + sel.fromOwner);
			return;
		}
		if (!player) {
			errors.push('Player not found: ' + sel.player);
			return;
		}

		// Increment timestamp by 1 minute per pick
		var timestamp = new Date(DRAFT_START.getTime() + (idx * 60 * 1000));

		console.log('  Pick ' + sel.pick + ' (Round ' + sel.round + '): ' + 
			sel.owner + ' selects ' + player.name + ' from ' + sel.fromOwner);

		transactions.push({
			type: 'expansion-draft-select',
			timestamp: timestamp,
			source: 'manual',
			franchiseId: franchise._id,
			playerId: player._id,
			fromFranchiseId: fromFranchise._id,
			round: sel.round,
			pick: sel.pick
		});
	});

	if (errors.length > 0) {
		console.log('\n=== Errors ===');
		errors.forEach(function(e) { console.log('  ' + e); });
		console.log('\nAborting due to errors.');
		await mongoose.disconnect();
		process.exit(1);
	}

	console.log('\n=== Summary ===');
	console.log('Protections: ' + (transactions.length - SELECTIONS.length));
	console.log('Selections: ' + SELECTIONS.length);
	console.log('Total: ' + transactions.length);

	if (!DRY_RUN) {
		await Transaction.insertMany(transactions);
		console.log('\nInserted ' + transactions.length + ' transactions.');
	}

	await mongoose.disconnect();
	console.log('\nDone.');
}

main().catch(function(err) {
	console.error(err);
	process.exit(1);
});
