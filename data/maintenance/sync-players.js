/**
 * Sync players from Sleeper data and DynastyProcess external IDs.
 * 
 * This script can be run repeatedly to keep Player documents in sync with Sleeper:
 * - Updates name, positions, college, rookieYear, estimatedRookieYear, birthday, active, team, searchRank for existing players (by sleeperId)
 * - Updates espnId and pfrId from DynastyProcess data (fetched if stale)
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
var https = require('https');
var fs = require('fs');
var path = require('path');

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
 * Estimate rookie year from known rookieYear (preferred), birth_date, or years_exp (fallback).
 * If rookieYear is known, just use that - no need to estimate.
 */
function getEstimatedRookieYear(player) {
	// If we know the actual rookie year, use it
	var knownRookieYear = getRookieYear(player);
	if (knownRookieYear) {
		return knownRookieYear;
	}
	// Fall back to birth_date + 23 (35% exact, 98% within 2 years)
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

/**
 * Extract birthday in MM-DD format from Sleeper birth_date (YYYY-MM-DD).
 * Returns null if not available.
 */
function getBirthday(player) {
	if (player.birth_date) {
		// birth_date format: "YYYY-MM-DD"
		var parts = player.birth_date.split('-');
		if (parts.length === 3) {
			return parts[1] + '-' + parts[2]; // "MM-DD"
		}
	}
	return null;
}

// DynastyProcess external IDs configuration
var DP_DATA_FILE = path.join(__dirname, '../../public/data/dynastyprocess-ids.json');
var DP_CSV_URL = 'https://github.com/DynastyProcess/data/raw/master/files/db_playerids.csv';
var DP_MAX_AGE_DAYS = 7;
var DP_MIN_ROWS = 10000;

/**
 * Parse CSV string into array of objects.
 */
function parseCSV(csvText) {
	var lines = csvText.trim().split('\n');
	var headers = lines[0].split(',');
	var rows = [];
	
	for (var i = 1; i < lines.length; i++) {
		var values = lines[i].split(',');
		var row = {};
		for (var j = 0; j < headers.length; j++) {
			row[headers[j]] = values[j] || null;
		}
		rows.push(row);
	}
	
	return rows;
}

/**
 * Fetch DynastyProcess player IDs CSV and convert to JSON.
 * Returns promise that resolves when complete.
 */
function fetchDynastyProcessData() {
	return new Promise(function(resolve, reject) {
		console.log('  Fetching from ' + DP_CSV_URL + '...');
		
		https.get(DP_CSV_URL, function(res) {
			// Handle redirects (GitHub raw URLs redirect)
			if (res.statusCode === 301 || res.statusCode === 302) {
				https.get(res.headers.location, function(res2) {
					handleResponse(res2);
				}).on('error', reject);
				return;
			}
			handleResponse(res);
			
			function handleResponse(response) {
				if (response.statusCode !== 200) {
					reject(new Error('DynastyProcess returned status ' + response.statusCode));
					return;
				}
				
				var data = '';
				response.on('data', function(chunk) { data += chunk; });
				response.on('end', function() {
					try {
						var rows = parseCSV(data);
						
						// Health check: minimum row count
						if (rows.length < DP_MIN_ROWS) {
							reject(new Error('DynastyProcess data has only ' + rows.length + ' rows (expected >=' + DP_MIN_ROWS + ')'));
							return;
						}
						
						// Health check: required columns
						var requiredCols = ['sleeper_id', 'espn_id', 'pfr_id'];
						var firstRow = rows[0];
						for (var i = 0; i < requiredCols.length; i++) {
							if (!(requiredCols[i] in firstRow)) {
								reject(new Error('DynastyProcess data missing required column: ' + requiredCols[i]));
								return;
							}
						}
						
						// Convert to JSON keyed by sleeper_id
						var bySleeperID = {};
						var withEspn = 0;
						var withPfr = 0;
						
						for (var j = 0; j < rows.length; j++) {
							var row = rows[j];
							if (row.sleeper_id) {
								bySleeperID[row.sleeper_id] = {
									espn_id: row.espn_id || null,
									pfr_id: row.pfr_id || null
								};
								if (row.espn_id) withEspn++;
								if (row.pfr_id) withPfr++;
							}
						}
						
						var sleeperCount = Object.keys(bySleeperID).length;
						console.log('  Parsed ' + rows.length + ' rows, ' + sleeperCount + ' with Sleeper IDs');
						console.log('  ESPN coverage: ' + withEspn + '/' + sleeperCount + ' (' + (100 * withEspn / sleeperCount).toFixed(1) + '%)');
						console.log('  PFR coverage: ' + withPfr + '/' + sleeperCount + ' (' + (100 * withPfr / sleeperCount).toFixed(1) + '%)');
						
						// Health check: coverage should be high
						if (withEspn / sleeperCount < 0.9) {
							console.log('  WARNING: ESPN coverage below 90% - data quality may have degraded');
						}
						
						// Save to file
						fs.writeFileSync(DP_DATA_FILE, JSON.stringify(bySleeperID, null, 2));
						console.log('  Saved to ' + DP_DATA_FILE);
						
						resolve(bySleeperID);
					} catch (err) {
						reject(new Error('Failed to parse DynastyProcess CSV: ' + err.message));
					}
				});
			}
		}).on('error', reject);
	});
}

/**
 * Ensure DynastyProcess data is available and fresh.
 * Fetches if missing or older than DP_MAX_AGE_DAYS.
 * Returns the data object (or empty object if unavailable).
 */
async function ensureDynastyProcessData() {
	console.log('Checking DynastyProcess data...');
	
	var needsFetch = false;
	
	if (!fs.existsSync(DP_DATA_FILE)) {
		console.log('  DynastyProcess data not found. Fetching...');
		needsFetch = true;
	} else {
		var stats = fs.statSync(DP_DATA_FILE);
		var ageMs = Date.now() - stats.mtimeMs;
		var ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
		
		if (ageDays >= DP_MAX_AGE_DAYS) {
			console.log('  DynastyProcess data is ' + ageDays + ' day(s) old. Refreshing...');
			needsFetch = true;
		} else {
			console.log('  DynastyProcess data is ' + ageDays + ' day(s) old (max: ' + DP_MAX_AGE_DAYS + '). Using cached.');
		}
	}
	
	if (needsFetch) {
		try {
			return await fetchDynastyProcessData();
		} catch (err) {
			console.log('  WARNING: Failed to fetch DynastyProcess data: ' + err.message);
			console.log('  Continuing without external IDs...');
			// Try to load existing file as fallback
			if (fs.existsSync(DP_DATA_FILE)) {
				console.log('  Using stale cached data as fallback.');
				return JSON.parse(fs.readFileSync(DP_DATA_FILE, 'utf8'));
			}
			return {};
		}
	}
	
	// Load existing file
	try {
		return JSON.parse(fs.readFileSync(DP_DATA_FILE, 'utf8'));
	} catch (err) {
		console.log('  WARNING: Failed to read DynastyProcess data: ' + err.message);
		return {};
	}
}

async function sync() {
	console.log('Syncing players from Sleeper data...\n');

	// Ensure DynastyProcess data is available
	var dpData = await ensureDynastyProcessData();
	var dpCount = Object.keys(dpData).length;
	console.log('  DynastyProcess IDs loaded: ' + dpCount + '\n');

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
		
		// Look up external IDs from DynastyProcess
		var dpPlayer = dpData[p.player_id] || {};
		
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
							birthday: getBirthday(p),
							active: p.active || false,
							team: p.team || null,
							searchRank: p.search_rank || null,
							espnId: dpPlayer.espn_id || null,
							pfrId: dpPlayer.pfr_id || null,
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
