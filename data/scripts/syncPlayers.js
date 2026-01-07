/**
 * Sync players from Sleeper data.
 * 
 * This script can be run repeatedly to keep Player documents in sync with Sleeper:
 * - Updates name, positions, college, rookieYear, active, team, searchRank for existing players (by sleeperId)
 * - Creates new players that don't exist yet
 * - Does NOT touch historical players (those without sleeperId)
 * - Does NOT overwrite the `notes` field (manual data)
 * 
 * Usage:
 *   node data/scripts/syncPlayers.js           # Sync updates only
 *   node data/scripts/syncPlayers.js --clear   # Clear all Sleeper-linked players first (dangerous!)
 */

var dotenv = require('dotenv').config({ path: __dirname + '/../../.env' });
var mongoose = require('mongoose');

var Player = require('../../models/Player');
var sleeperData = require('../../public/data/sleeper-data.json');

mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });

var relevantPositions = ['QB', 'RB', 'WR', 'TE', 'DL', 'LB', 'DB', 'K'];

function hasRelevantPosition(player) {
	if (!player.fantasy_positions || player.fantasy_positions.length === 0) {
		return false;
	}
	return player.fantasy_positions.some(function(pos) {
		return relevantPositions.includes(pos);
	});
}

function getRookieYear(player) {
	// Try metadata first
	if (player.metadata && player.metadata.rookie_year) {
		return parseInt(player.metadata.rookie_year, 10);
	}
	// Fall back to calculating from years_exp
	if (player.years_exp !== undefined && player.years_exp !== null) {
		return new Date().getFullYear() - player.years_exp;
	}
	return null;
}

async function sync() {
	console.log('Syncing players from Sleeper data...\n');

	var clearExisting = process.argv.includes('--clear');
	if (clearExisting) {
		console.log('Clearing existing Sleeper-linked players...');
		var deleteResult = await Player.deleteMany({ sleeperId: { $ne: null } });
		console.log('  Deleted', deleteResult.deletedCount, 'players\n');
	}

	var players = Object.values(sleeperData);
	console.log('Total players in Sleeper data:', players.length);

	var created = 0;
	var updated = 0;
	var skipped = 0;

	// Build bulk operations
	var operations = [];

	for (var i = 0; i < players.length; i++) {
		var p = players[i];

		// Skip players without a name or without relevant positions
		if (!p.full_name || !hasRelevantPosition(p)) {
			skipped++;
			continue;
		}

		operations.push({
			updateOne: {
				filter: { sleeperId: p.player_id },
				update: {
					$set: {
						sleeperId: p.player_id,
						name: p.full_name,
						positions: p.fantasy_positions || [],
						college: p.college || null,
						rookieYear: getRookieYear(p),
						active: p.active || false,
						team: p.team || null,
						searchRank: p.search_rank || null
					}
					// Note: `notes` is NOT included, so it won't be overwritten
				},
				upsert: true
			}
		});
	}

	console.log('Relevant players to sync:', operations.length);
	console.log('Skipped (no name or irrelevant position):', skipped);

	// Execute in batches
	var batchSize = 1000;
	for (var i = 0; i < operations.length; i += batchSize) {
		var batch = operations.slice(i, i + batchSize);
		var result = await Player.bulkWrite(batch, { ordered: false });
		
		created += result.upsertedCount || 0;
		updated += result.modifiedCount || 0;

		console.log('  Processed', Math.min(i + batchSize, operations.length), 'of', operations.length, '...');
	}

	console.log('\nDone!');
	console.log('  Created:', created);
	console.log('  Updated:', updated);
	console.log('  Unchanged:', operations.length - created - updated);

	process.exit(0);
}

sync().catch(function(err) {
	console.error('Error:', err);
	process.exit(1);
});
