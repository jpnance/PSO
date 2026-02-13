#!/usr/bin/env node
/**
 * RFA Rights Generator
 *
 * Generates rfa.json — a record of RFA rights conversions, contract expiries,
 * and lapsed rights for each season.
 *
 * Rules:
 *   2008-2018: ALL expiring contracts convey RFA rights to the owning franchise.
 *   2019+:     Only 2+ year contracts (endYear - startYear >= 1) convey RFA rights.
 *              1-year and FA contracts result in contract-expiry (player becomes UFA).
 *
 * Data sources:
 *   - postseason-YEAR.txt snapshots (2008, 2014+): authoritative end-of-season rosters
 *   - contracts-YEAR.txt + fa.json + trades + cuts (2009-2013): approximated
 *   - auctions.json: to determine if player went to auction (for lapsed detection)
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
var AUCTIONS_FILE = path.join(__dirname, '../auctions/auctions.json');
var FA_FILE = path.join(__dirname, '../fa/fa.json');

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
 * Build a player key for identification.
 */
function playerKey(sleeperId, name) {
	if (sleeperId && sleeperId !== '-1' && sleeperId !== -1) {
		return 'id:' + sleeperId;
	}
	return 'name:' + resolver.normalizePlayerName(name);
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
 * Build end-of-season roster from contracts-YEAR.txt + fa.json + trades.
 *
 * Strategy: process all events chronologically to track final ownership state.
 * 1. Start with preseason snapshot (contracts-YEAR.txt)
 * 2. Process FA records chronologically (adds bring players in, drops remove them)
 * 3. Process trades to update ownership
 *
 * Note: FA records include both mid-season pickups AND cuts, so we don't need
 * to separately consult cuts.json.
 */
function buildApproximatePostseason(season, cuts, trades, faRecords) {
	var contractsFile = path.join(SNAPSHOTS_DIR, 'contracts-' + season + '.txt');
	var initialPlayers = parseSnapshot(contractsFile, season);

	// Build roster state: { playerKey: { ...player data... } }
	// Players in this map are "owned" at end of season
	var roster = {};

	// 1. Initialize with preseason snapshot (only players with contracts ending this season)
	initialPlayers.forEach(function(p) {
		if (p.endYear !== season) return;  // Only care about expiring contracts

		var key = playerKey(p.id, p.name);
		roster[key] = {
			id: p.id,
			owner: p.owner,
			name: p.name,
			position: p.position,
			startYear: p.startYear,
			endYear: p.endYear,
			salary: p.salary,
			rosterId: ownerToRosterId(p.owner, season)
		};
	});

	// 2. Process FA records chronologically
	// Each FA record can have adds (player joins roster) and drops (player leaves roster)
	// Exclude offseason records - these are PRE-auction drops from the prior contract,
	// not post-season activity. Including them would incorrectly remove players who
	// were re-acquired at auction with new contracts.
	var seasonFA = faRecords.filter(function(fa) {
		return fa.season === season && fa.source !== 'offseason';
	}).sort(function(a, b) {
		return new Date(a.timestamp) - new Date(b.timestamp);
	});

	seasonFA.forEach(function(fa) {
		// Process drops first (player leaves this owner's roster)
		(fa.drops || []).forEach(function(drop) {
			var key = playerKey(drop.sleeperId, drop.name);

			// If this player is in roster and owned by this rosterId, remove them
			if (roster[key] && roster[key].rosterId === fa.rosterId) {
				delete roster[key];
			}
		});

		// Process adds (player joins this owner's roster)
		(fa.adds || []).forEach(function(add) {
			if (add.endYear !== season) return;  // Only care about expiring contracts

			var key = playerKey(add.sleeperId, add.name);

			// Add or update player in roster
			roster[key] = {
				id: add.sleeperId || null,
				owner: null,
				name: add.name,
				position: add.position,
				startYear: null,  // FA contract
				endYear: season,
				salary: add.salary || 1,
				rosterId: fa.rosterId
			};
		});
	});

	// 3. Process trades to update ownership for players still in roster
	var snapshotCutoff = leagueDates.getContractDueDate(season) || leagueDates.getAuctionDate(season);
	var seasonTrades = trades.filter(function(t) {
		if (new Date(t.date).getFullYear() !== season) return false;
		if (snapshotCutoff && new Date(t.date) <= snapshotCutoff) return false;
		return true;
	}).sort(function(a, b) {
		return new Date(a.date) - new Date(b.date);
	});

	seasonTrades.forEach(function(trade) {
		trade.parties.forEach(function(party) {
			(party.players || []).forEach(function(tp) {
				var key = playerKey(tp.sleeperId, tp.name);

				// If player is in roster, update ownership
				if (roster[key]) {
					var newRosterId = party.rosterId || ownerToRosterId(party.owner, season);
					if (newRosterId) {
						roster[key].rosterId = newRosterId;
						roster[key].owner = party.owner;
					}

					// Update contract if specified
					if (tp.contract) {
						if (tp.contract.start !== undefined) roster[key].startYear = tp.contract.start;
						if (tp.contract.end !== undefined) roster[key].endYear = tp.contract.end;
					}
				} else {
					// Player not in roster — might be acquired via trade with expiring contract
					var endYear = tp.contract ? tp.contract.end : null;
					if (endYear === season) {
						var newRosterId = party.rosterId || ownerToRosterId(party.owner, season);
						roster[key] = {
							id: tp.sleeperId || null,
							owner: party.owner,
							name: tp.name,
							position: null,
							startYear: tp.contract ? tp.contract.start : null,
							endYear: season,
							salary: tp.salary || 1,
							rosterId: newRosterId
						};
					}
				}
			});
		});
	});

	// Convert roster map back to array
	return Object.keys(roster).map(function(key) {
		return roster[key];
	});
}

// =============================================================================
// RFA Classification
// =============================================================================

/**
 * Determine the RFA outcome for a player with an expiring contract.
 */
function classifyExpiry(player, season) {
	if (player.endYear !== season) return null;

	// Pre-2019: all expiring contracts convey RFA rights
	if (season <= 2018) {
		return 'rfa-rights-conversion';
	}

	// 2019+: only 2+ year contracts convey RFA rights
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
// Auction Lookup
// =============================================================================

function buildAuctionedPlayersByYear(auctions) {
	var byYear = {};

	auctions.forEach(function(auction) {
		var year = auction.season;
		if (!byYear[year]) {
			byYear[year] = { sleeperIds: new Set(), names: new Set() };
		}

		if (auction.sleeperId && auction.sleeperId !== '-1') {
			byYear[year].sleeperIds.add(auction.sleeperId);
		} else if (auction.name) {
			byYear[year].names.add(resolver.normalizePlayerName(auction.name));
		}
	});

	return byYear;
}

function wasAuctioned(auctionedByYear, year, sleeperId, playerName) {
	var yearData = auctionedByYear[year];
	if (!yearData) return false;

	if (sleeperId && sleeperId !== '-1') {
		return yearData.sleeperIds.has(sleeperId);
	} else if (playerName) {
		return yearData.names.has(resolver.normalizePlayerName(playerName));
	}

	return false;
}

function getRfaLapsedTimestamp(year) {
	return new Date(Date.UTC(year, 8, 1, 16, 0, 0)).toISOString();
}

// =============================================================================
// Main
// =============================================================================

function run() {
	console.log('=== RFA Rights Generator ===\n');

	var cuts = JSON.parse(fs.readFileSync(CUTS_FILE, 'utf8'));
	var trades = JSON.parse(fs.readFileSync(TRADES_FILE, 'utf8'));
	var auctions = JSON.parse(fs.readFileSync(AUCTIONS_FILE, 'utf8'));
	var faRecords = JSON.parse(fs.readFileSync(FA_FILE, 'utf8'));

	console.log('Loaded: ' + cuts.length + ' cuts, ' + trades.length + ' trades, ' +
		auctions.length + ' auctions, ' + faRecords.length + ' FA records\n');

	var auctionedByYear = buildAuctionedPlayersByYear(auctions);

	// ==========================================================================
	// Early RFA Exceptions - define first so we can skip them during processing
	// ==========================================================================
	var earlyRfaExceptions = [
		{
			playerName: 'DeMeco Ryans',
			sleeperId: '220',
			season: 2009,
			conversionTimestamp: '2009-12-29T12:00:00.000Z',
			conversionRosterId: 7,
			notes: 'Expedited RFA conveyance granted for Trade #16; rights traded to Patrick in Trade #16, who did not match at 2010 auction'
		}
	];

	// Build a set of exception player keys to skip
	var exceptionKeys = new Set();
	earlyRfaExceptions.forEach(function(ex) {
		exceptionKeys.add(playerKey(ex.sleeperId, ex.playerName) + '|' + ex.season);
	});

	var allRecords = [];

	for (var season = 2008; season <= 2025; season++) {
		var postseasonFile = path.join(SNAPSHOTS_DIR, 'postseason-' + season + '.txt');
		var hasPostseason = fs.existsSync(postseasonFile);
		var roster;

		if (hasPostseason) {
			roster = parseSnapshot(postseasonFile, season);
		} else {
			roster = buildApproximatePostseason(season, cuts, trades, faRecords);
		}

		var seasonRecords = [];
		var timestamp = new Date(Date.UTC(season + 1, 0, 15)).toISOString();

		roster.forEach(function(player) {
			var type = classifyExpiry(player, season);
			if (!type) return;

			// Skip players handled by early RFA exceptions
			var pKey = playerKey(player.id, player.name) + '|' + season;
			if (exceptionKeys.has(pKey)) return;

			var rosterId = player.rosterId || ownerToRosterId(player.owner, season);
			if (!rosterId) {
				console.warn('  Warning: Cannot resolve owner for ' + player.name + ' in ' + season);
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

		var conversions = seasonRecords.filter(function(r) { return r.type === 'rfa-rights-conversion'; }).length;
		var expiries = seasonRecords.filter(function(r) { return r.type === 'contract-expiry'; }).length;

		console.log(season + ': ' + seasonRecords.length + ' records'
			+ ' (' + conversions + ' rfa, ' + expiries + ' expiry)'
			+ (hasPostseason ? '' : ' [approximated]'));

		allRecords = allRecords.concat(seasonRecords);
	}

	// Add early RFA exception records
	console.log('\nAdding early RFA exceptions...');
	earlyRfaExceptions.forEach(function(ex) {
		console.log('  ' + ex.playerName + ' (' + ex.season + '): ' + ex.notes);

		allRecords.push({
			season: ex.season,
			type: 'rfa-rights-conversion',
			timestamp: ex.conversionTimestamp,
			rosterId: ex.conversionRosterId,
			sleeperId: ex.sleeperId,
			playerName: ex.playerName,
			position: null,
			startYear: null,
			endYear: null,
			salary: null,
			source: 'exception'
		});

		if (ex.lapsedTimestamp && ex.lapsedRosterId) {
			allRecords.push({
				season: ex.season,
				type: 'rfa-rights-lapsed',
				timestamp: ex.lapsedTimestamp,
				rosterId: ex.lapsedRosterId,
				sleeperId: ex.sleeperId,
				playerName: ex.playerName,
				position: null,
				source: 'exception'
			});
		}
	});

	// Generate rfa-rights-lapsed records
	console.log('\nGenerating RFA lapsed records...');
	var lapsedRecords = [];
	var lapsedByYear = {};

	allRecords.forEach(function(record) {
		if (record.type !== 'rfa-rights-conversion') return;

		var auctionYear = record.season + 1;

		if (!wasAuctioned(auctionedByYear, auctionYear, record.sleeperId, record.playerName)) {
			lapsedRecords.push({
				season: record.season,
				type: 'rfa-rights-lapsed',
				timestamp: getRfaLapsedTimestamp(auctionYear),
				rosterId: record.rosterId,
				sleeperId: record.sleeperId,
				playerName: record.playerName,
				position: record.position,
				source: record.source
			});

			lapsedByYear[auctionYear] = (lapsedByYear[auctionYear] || 0) + 1;
		}
	});

	Object.keys(lapsedByYear).sort().forEach(function(year) {
		console.log('  ' + year + ': ' + lapsedByYear[year] + ' lapsed');
	});
	console.log('  Total: ' + lapsedRecords.length + ' lapsed');

	allRecords = allRecords.concat(lapsedRecords);

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
