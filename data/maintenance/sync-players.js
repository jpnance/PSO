/**
 * Sync players from Sleeper data.
 * 
 * This script can be run repeatedly to keep Player documents in sync with Sleeper:
 * - Updates name, positions, college, rookieYear, estimatedRookieYear, active, team, searchRank for existing players (by sleeperId)
 * - Creates new players that don't exist yet
 * - Does NOT touch historical players (those without sleeperId)
 * - Does NOT overwrite the `notes` field (manual data)
 * 
 * Usage:
 *   node data/maintenance/sync-players.js           # Sync updates only
 *   node data/maintenance/sync-players.js --clear   # Clear all Sleeper-linked players first (dangerous!)
 */

var dotenv = require('dotenv').config({ path: __dirname + '/../../.env' });
var mongoose = require('mongoose');

var Player = require('../../models/Player');
var sleeperData = require('../../public/data/sleeper-data.json');

mongoose.connect(process.env.MONGODB_URI);

var relevantPositions = ['QB', 'RB', 'WR', 'TE', 'DL', 'LB', 'DB', 'K'];

function hasRelevantPosition(player) {
	if (!player.fantasy_positions || player.fantasy_positions.length === 0) {
		return false;
	}
	return player.fantasy_positions.some(function(pos) {
		return relevantPositions.includes(pos);
	});
}

var crypto = require('crypto');

// Generate URL-friendly base slug from name
function generateBaseSlug(name) {
	if (!name) return null;
	return name
		.toLowerCase()
		.replace(/['']/g, '')
		.replace(/[^a-z0-9\s-]/g, '')
		.replace(/\s+/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '');
}

// Generate 4-char hash
function generateHash(str) {
	if (!str) return null;
	return crypto.createHash('md5').update(str).digest('hex').substring(0, 4);
}

// Generate unique slug: base-slug + 4-char hash of sleeperId
function generateUniqueSlug(name, sleeperId) {
	var baseSlug = generateBaseSlug(name);
	if (!baseSlug) return null;
	var hash = generateHash(sleeperId);
	return baseSlug + '-' + hash;
}

/**
 * Get reliable rookie year from Sleeper metadata (42% coverage).
 * Returns null if not available - do NOT fall back to estimates.
 */
function getRookieYear(player) {
	if (player.metadata && player.metadata.rookie_year) {
		var year = parseInt(player.metadata.rookie_year, 10);
		// Filter out invalid values (e.g., 0)
		if (year > 1990) {
			return year;
		}
	}
	return null;
}

/**
 * Estimate rookie year from birth_date (preferred) or years_exp (fallback).
 * 98% accurate within 2 years when using birth_date + 23.
 */
function getEstimatedRookieYear(player) {
	// Prefer birth_date + 23 (35% exact, 98% within 2 years)
	if (player.birth_date) {
		var birthYear = parseInt(player.birth_date.split('-')[0], 10);
		if (birthYear > 1950) {
			return birthYear + 23;
		}
	}
	// Fall back to years_exp calculation (less reliable)
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

		var uniqueSlug = generateUniqueSlug(p.full_name, p.player_id);
		
		// Use aggregation pipeline update to prepend new slug if not already present
		// This keeps old slugs for backwards compatibility while making current name primary
		operations.push({
			updateOne: {
				filter: { sleeperId: p.player_id },
				update: [
					{
						$set: {
							sleeperId: p.player_id,
							name: p.full_name,
							positions: p.fantasy_positions || [],
							college: p.college || null,
							rookieYear: getRookieYear(p),
							estimatedRookieYear: getEstimatedRookieYear(p),
							active: p.active || false,
							team: p.team || null,
							searchRank: p.search_rank || null,
							// Prepend new slug if not already in array, otherwise keep array as-is
							slugs: {
								$cond: {
									if: { $in: [uniqueSlug, { $ifNull: ['$slugs', []] }] },
									then: '$slugs',
									else: { $concatArrays: [[uniqueSlug], { $ifNull: ['$slugs', []] }] }
								}
							}
						}
					}
				],
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
