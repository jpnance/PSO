#!/usr/bin/env node
/**
 * RFA Rights Generator
 *
 * Generates rfa.json — a record of RFA rights conversions, contract expiries,
 * and unknown statuses for each season.
 *
 * Rules:
 *   2008-2018: ALL expiring contracts convey RFA rights to the owning franchise.
 *   2019+:     Only 2+ year contracts (endYear - startYear >= 1) convey RFA rights.
 *              1-year and FA contracts result in contract-expiry (player becomes UFA).
 *
 * Data sources:
 *   - postseason-YEAR.txt snapshots (available for 2008, 2014-2025): authoritative
 *   - contracts-YEAR.txt + cuts.json + trades.json (2009-2013): approximated
 *
 * Timestamp convention: January 15 at 00:00 UTC of the following year.
 *
 * Usage:
 *   node data/rfa/generate.js
 */

var fs = require('fs');
var path = require('path');

var PSO = require('../../config/pso.js');
var leagueDates = require('../../config/dates.js');
var resolver = require('../utils/player-resolver');

// Paths
var RFA_FILE = path.join(__dirname, 'rfa.json');
var SNAPSHOTS_DIR = path.join(__dirname, '../archive/snapshots');
var CUTS_FILE = path.join(__dirname, '../cuts/cuts.json');
var TRADES_FILE = path.join(__dirname, '../trades/trades.json');

// =============================================================================
// Data Loading
// =============================================================================

function ownerToRosterId(ownerName, season) {
	if (!ownerName) return null;
	var lowerOwner = ownerName.toLowerCase();

	var rosterIds = Object.keys(PSO.franchiseNames);

	for (var i = 0; i < rosterIds.length; i++) {
		var rid = parseInt(rosterIds[i]);
		var name = PSO.franchiseNames[rid][season];
		if (name && name.toLowerCase() === lowerOwner) {
			return rid;
		}
	}

	for (var i = 0; i < rosterIds.length; i++) {
		var rid = parseInt(rosterIds[i]);
		var name = PSO.franchiseNames[rid][season];
		if (name && (name.toLowerCase().indexOf(lowerOwner) >= 0 || lowerOwner.indexOf(name.toLowerCase()) >= 0)) {
			return rid;
		}
	}

	var keys = Object.keys(PSO.franchiseIds);
	for (var i = 0; i < keys.length; i++) {
		if (keys[i].toLowerCase() === lowerOwner) {
			return PSO.franchiseIds[keys[i]];
		}
	}

	return null;
}

/**
 * Parse a snapshot file (contracts or postseason).
 * Returns: [{ id, owner, name, position, startYear, endYear, salary }]
 */
function parseSnapshot(filePath, season) {
	if (!fs.existsSync(filePath)) return [];

	var content = fs.readFileSync(filePath, 'utf8');
	var lines = content.trim().split('\n');
	var players = [];

	for (var i = 1; i < lines.length; i++) {
		var parts = lines[i].split(',');
		if (parts.length < 6) continue;

		var id = parts[0];
		var owner = parts[1] ? parts[1].trim() : null;
		var name = parts[2];
		var position = parts[3];
		var startYear = parts[4] === 'FA' ? null : parseInt(parts[4]);
		var endYear = parseInt(parts[5]);
		var salaryStr = (parts[6] || '').replace(/[$,]/g, '');
		var salary = salaryStr ? parseInt(salaryStr) : 1;
		if (isNaN(salary)) salary = 1;
		if (isNaN(endYear)) endYear = season;

		if (!owner) continue; // skip unowned players

		players.push({
			id: id !== '-1' ? id : null,
			owner: owner,
			name: name,
			position: position,
			startYear: startYear,
			endYear: endYear,
			salary: salary
		});
	}

	return players;
}

/**
 * Build end-of-season roster from contracts-YEAR.txt + cuts + trades.
 *
 * Start with the preseason snapshot, then:
 * 1. Remove players who were cut during the season
 * 2. Update ownership for traded players
 * 3. Add players acquired via trade who weren't in the original snapshot
 *
 * This is approximate — mid-season FA pickups that weren't cut or traded
 * are invisible to us.
 */
function buildApproximatePostseason(season, cuts, trades) {
	var contractsFile = path.join(SNAPSHOTS_DIR, 'contracts-' + season + '.txt');
	var players = parseSnapshot(contractsFile, season);

	// Index players by normalized name for updates
	var byName = {};
	players.forEach(function(p) {
		var key = resolver.normalizePlayerName(p.name);
		if (key) byName[key] = p;
	});

	// Also index by sleeper ID
	var byId = {};
	players.forEach(function(p) {
		if (p.id) byId[p.id] = p;
	});

	// 1. Remove players who were cut (non-offseason) during this season
	var seasonCuts = cuts.filter(function(c) {
		return c.cutYear === season && !c.offseason;
	});

	seasonCuts.forEach(function(cut) {
		var key = cut.sleeperId ? null : resolver.normalizePlayerName(cut.name);
		var player = null;

		if (cut.sleeperId && byId[cut.sleeperId]) {
			player = byId[cut.sleeperId];
		} else if (key && byName[key]) {
			player = byName[key];
		}

		if (player) {
			// Verify the cut is from the same owner
			var cutRosterId = cut.rosterId;
			var playerRosterId = ownerToRosterId(player.owner, season);
			if (cutRosterId === playerRosterId) {
				// Mark as cut — remove from roster
				player._cut = true;
			}
		}
	});

	// 2. Process trades — update ownership and add new players.
	// Only apply trades that happened AFTER the contracts due date, since
	// contracts-YEAR.txt is a post-contracts-due snapshot and earlier
	// trades are already reflected in it. Fall back to auction date if
	// no contracts due date is available.
	var snapshotCutoff = leagueDates.getContractDueDate(season) || leagueDates.getAuctionDate(season);
	var seasonTrades = trades.filter(function(t) {
		if (new Date(t.date).getFullYear() !== season) return false;
		if (snapshotCutoff && new Date(t.date) <= snapshotCutoff) return false;
		return true;
	});

	seasonTrades.forEach(function(trade) {
		trade.parties.forEach(function(party) {
			(party.players || []).forEach(function(tp) {
				var key = resolver.normalizePlayerName(tp.name);
				var player = null;

				if (tp.sleeperId && byId[tp.sleeperId]) {
					player = byId[tp.sleeperId];
				} else if (key && byName[key]) {
					player = byName[key];
				}

				if (player) {
					// Transfer ownership — this party RECEIVES the player
					player.owner = party.owner;
					player._cut = false; // un-cut if previously cut and re-acquired

					// Update contract if trade specifies it
					if (tp.contract) {
						if (tp.contract.start !== undefined) player.startYear = tp.contract.start;
						if (tp.contract.end !== undefined) player.endYear = tp.contract.end;
					}
				} else {
					// Player not in preseason snapshot — must have been picked up
					// mid-season (FA) and then traded. Add them.
					var newPlayer = {
						id: tp.sleeperId || null,
						owner: party.owner,
						name: tp.name,
						position: null,
						startYear: tp.contract ? tp.contract.start : null,
						endYear: tp.contract ? tp.contract.end : season,
						salary: tp.salary || 1
					};
					players.push(newPlayer);
					if (key) byName[key] = newPlayer;
					if (newPlayer.id) byId[newPlayer.id] = newPlayer;
				}
			});
		});
	});

	// Filter out cut players
	return players.filter(function(p) { return !p._cut; });
}

// =============================================================================
// RFA Classification
// =============================================================================

/**
 * Determine the RFA outcome for a player with an expiring contract.
 *
 * @param {object} player - Player record from snapshot
 * @param {number} season - The season that just ended
 * @returns {string} 'rfa-rights-conversion', 'contract-expiry', or null (not expiring)
 */
function classifyExpiry(player, season) {
	if (player.endYear !== season) return null;

	// Pre-2019: all expiring contracts convey RFA rights
	if (season <= 2018) {
		return 'rfa-rights-conversion';
	}

	// 2019+: only 2+ year contracts convey RFA rights
	// FA contracts (startYear === null) are end-of-season contracts — no RFA
	if (player.startYear === null) {
		return 'contract-expiry';
	}

	var contractLength = player.endYear - player.startYear + 1;
	if (contractLength >= 2) {
		return 'rfa-rights-conversion';
	}

	return 'contract-expiry';
}

// =============================================================================
// Main
// =============================================================================

function run() {
	console.log('=== RFA Rights Generator ===\n');

	var cuts = JSON.parse(fs.readFileSync(CUTS_FILE, 'utf8'));
	var trades = JSON.parse(fs.readFileSync(TRADES_FILE, 'utf8'));

	var allRecords = [];

	for (var season = 2008; season <= 2025; season++) {
		var postseasonFile = path.join(SNAPSHOTS_DIR, 'postseason-' + season + '.txt');
		var hasPostseason = fs.existsSync(postseasonFile);
		var roster;

		if (hasPostseason) {
			roster = parseSnapshot(postseasonFile, season);
		} else {
			roster = buildApproximatePostseason(season, cuts, trades);
		}

		var seasonRecords = [];
		var timestamp = new Date(Date.UTC(season + 1, 0, 15)).toISOString(); // Jan 15 of season+1

		roster.forEach(function(player) {
			var type = classifyExpiry(player, season);
			if (!type) return;

			var rosterId = ownerToRosterId(player.owner, season);
			if (!rosterId) {
				console.warn('  Warning: Cannot resolve owner "' + player.owner + '" for ' + player.name + ' in ' + season);
				return;
			}

			seasonRecords.push({
				season: season,
				type: type,
				timestamp: timestamp,
				rosterId: rosterId,
				sleeperId: player.id || null,
				playerName: player.name,
				position: player.position,
				startYear: player.startYear,
				endYear: player.endYear,
				salary: player.salary,
				source: hasPostseason ? 'postseason' : 'approximated'
			});
		});

		// For approximated seasons, flag players who were cut mid-season and
		// thus we can't confirm their end-of-season status
		if (!hasPostseason) {
			var seasonFACuts = cuts.filter(function(c) {
				return c.cutYear === season && !c.offseason && c.startYear === null;
			});

			seasonFACuts.forEach(function(cut) {
				// Only flag if the player isn't already accounted for
				// (e.g., they might have been re-acquired and appear in trades)
				var alreadyHandled = seasonRecords.some(function(r) {
					if (cut.sleeperId && r.sleeperId === cut.sleeperId) return true;
					return resolver.normalizePlayerName(r.playerName) === resolver.normalizePlayerName(cut.name);
				});

				if (!alreadyHandled) {
					seasonRecords.push({
						season: season,
						type: 'rfa-unknown',
						timestamp: timestamp,
						rosterId: cut.rosterId,
						sleeperId: cut.sleeperId || null,
						playerName: cut.name,
						position: cut.position,
						startYear: null,
						endYear: season,
						salary: cut.salary || 1,
						source: 'approximated'
					});
				}
			});
		}

		var conversions = seasonRecords.filter(function(r) { return r.type === 'rfa-rights-conversion'; }).length;
		var expiries = seasonRecords.filter(function(r) { return r.type === 'contract-expiry'; }).length;
		var unknowns = seasonRecords.filter(function(r) { return r.type === 'rfa-unknown'; }).length;

		console.log(season + ': ' + seasonRecords.length + ' records'
			+ ' (' + conversions + ' rfa, ' + expiries + ' expiry, ' + unknowns + ' unknown)'
			+ (hasPostseason ? '' : ' [approximated]'));

		allRecords = allRecords.concat(seasonRecords);
	}

	// Sort by timestamp, then season
	allRecords.sort(function(a, b) {
		return new Date(a.timestamp) - new Date(b.timestamp);
	});

	console.log('\n=== Summary ===');
	var byType = {};
	allRecords.forEach(function(r) {
		byType[r.type] = (byType[r.type] || 0) + 1;
	});
	console.log('Total records: ' + allRecords.length);
	Object.keys(byType).sort().forEach(function(type) {
		console.log('  ' + type + ': ' + byType[type]);
	});

	fs.writeFileSync(RFA_FILE, JSON.stringify(allRecords, null, '\t'));
	console.log('\nWrote ' + RFA_FILE);
}

run();
