#!/usr/bin/env node
/**
 * FA Transaction Generator
 *
 * Generates fa.json from platform transaction data (2020+), cuts.json, trades.json,
 * and snapshot inference (pre-2020).
 *
 * Usage:
 *   node data/fa/generate.js
 */

var fs = require('fs');
var path = require('path');

var PSO = require('../../config/pso.js');
var leagueDates = require('../../config/dates.js');

// Paths
var FA_FILE = path.join(__dirname, 'fa.json');
var CUTS_FILE = path.join(__dirname, '../cuts/cuts.json');
var TRADES_FILE = path.join(__dirname, '../trades/trades.json');
var SNAPSHOTS_DIR = path.join(__dirname, '../archive/snapshots');
var CONFIG_DIR = path.join(__dirname, '../config');
var TRADE_FACILITATION_FILE = path.join(CONFIG_DIR, 'trade-facilitation-fixups.json');

// Facts layer
var sleeperFacts = require('../facts/sleeper-facts');
var fantraxFacts = require('../facts/fantrax-facts');
var resolver = require('../utils/player-resolver');

// =============================================================================
// Data Loading
// =============================================================================

/**
 * Build a name -> sleeperId lookup from snapshot files.
 * Used to resolve Fantrax player names to Sleeper IDs.
 */
function buildSleeperIdLookup() {
	var lookup = {};  // normalized name -> sleeperId (only stored when unambiguous)
	var ambiguous = new Set();

	var files = fs.readdirSync(SNAPSHOTS_DIR).filter(function(f) {
		return f.match(/^(contracts|postseason)-\d{4}\.txt$/);
	});

	files.forEach(function(f) {
		var lines = fs.readFileSync(path.join(SNAPSHOTS_DIR, f), 'utf8').split('\n');
		lines.forEach(function(line) {
			if (!line.trim() || line.startsWith('ID,')) return;
			var parts = line.split(',');
			var id = parts[0];
			var name = parts[2];
			if (!id || !name || id === '-1') return;

			var normalized = resolver.normalizePlayerName(name);
			if (!normalized) return;

			if (ambiguous.has(normalized)) return;

			if (lookup[normalized] && lookup[normalized] !== id) {
				// Two different IDs for the same name — ambiguous, remove
				delete lookup[normalized];
				ambiguous.add(normalized);
				return;
			}

			lookup[normalized] = id;
		});
	});

	return lookup;
}

/**
 * Load auction dates from config.
 * Returns: { year: Date }
 */
function loadAuctionDates() {
	return leagueDates.getAllAuctionDates();
}

/**
 * Get cut day timestamp for a given year from config.
 */
function getCutDayTimestamp(year) {
	return leagueDates.getCutDueDate(year);
}

/**
 * Load all fixup data.
 * Returns: { sleeperIgnored: Set, fantraxIgnored: Set, fantraxIncluded: Set,
 *            sleeperIncluded: Set, tradeFacilitation: {} }
 */
function loadFixups() {
	var result = {
		sleeperIgnored: new Set(),
		fantraxIgnored: new Set(),
		sleeperIncluded: new Set(),
		fantraxIncluded: new Set(),
		tradeFacilitation: {}
	};

	// Sleeper fixups (by year)
	var sleeperFiles = fs.readdirSync(CONFIG_DIR).filter(function(f) {
		return f.match(/^sleeper-fixups-\d+\.json$/);
	});

	sleeperFiles.forEach(function(file) {
		try {
			var fixups = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, file), 'utf8'));
			(fixups.sleeperIgnored || []).forEach(function(item) {
				if (item.sleeperTxId) result.sleeperIgnored.add(item.sleeperTxId);
			});
			(fixups.sleeperCommissionerAuditIncluded || []).forEach(function(item) {
				if (item.sleeperTxId) result.sleeperIncluded.add(item.sleeperTxId);
			});
		} catch (e) {
			console.warn('Warning: Could not load ' + file + ':', e.message);
		}
	});

	// Fantrax fixups
	var fantraxFixupsPath = path.join(CONFIG_DIR, 'fantrax-fixups.json');
	if (fs.existsSync(fantraxFixupsPath)) {
		try {
			var fixups = JSON.parse(fs.readFileSync(fantraxFixupsPath, 'utf8'));
			(fixups.fantraxIgnored || []).forEach(function(item) {
				if (item.transactionId) result.fantraxIgnored.add(item.transactionId);
			});
			(fixups.fantraxCommissionerAuditIncluded || []).forEach(function(item) {
				if (item.transactionId) result.fantraxIncluded.add(item.transactionId);
			});
		} catch (e) {
			console.warn('Warning: Could not load fantrax-fixups.json:', e.message);
		}
	}

	// Trade facilitation fixups
	if (fs.existsSync(TRADE_FACILITATION_FILE)) {
		try {
			result.tradeFacilitation = JSON.parse(fs.readFileSync(TRADE_FACILITATION_FILE, 'utf8'));
		} catch (e) {
			console.warn('Warning: Could not load trade-facilitation-fixups.json:', e.message);
		}
	}

	return result;
}

/**
 * Load cuts.json.
 */
function loadCuts() {
	return JSON.parse(fs.readFileSync(CUTS_FILE, 'utf8'));
}

/**
 * Load trades.json.
 */
function loadTrades() {
	return JSON.parse(fs.readFileSync(TRADES_FILE, 'utf8'));
}

/**
 * Build a lookup of cuts by sleeperId + cutYear and by name + cutYear for contract data on drops.
 * Returns: { bySleeperId: { "sleeperId|cutYear": [cut] }, byName: { "name|cutYear|rosterId": [cut] } }
 */
function buildCutsLookup(cuts) {
	var bySleeperId = {};
	var byName = {};

	cuts.forEach(function(cut) {
		if (cut.sleeperId) {
			var key = cut.sleeperId + '|' + cut.cutYear;
			if (!bySleeperId[key]) bySleeperId[key] = [];
			bySleeperId[key].push(cut);
		}

		// Also index by name + year + rosterId for Fantrax lookups
		if (cut.name) {
			var nameKey = cut.name.toLowerCase() + '|' + cut.cutYear + '|' + cut.rosterId;
			if (!byName[nameKey]) byName[nameKey] = [];
			byName[nameKey].push(cut);
		}
	});

	return { bySleeperId: bySleeperId, byName: byName };
}

/**
 * Resolve owner name to rosterId using PSO.franchiseNames.
 * Matches owner names against the year-specific franchise names.
 */
function ownerToRosterId(ownerName, season) {
	if (!ownerName) return null;
	var lowerOwner = ownerName.toLowerCase();

	var rosterIds = Object.keys(PSO.franchiseNames);

	// Season-specific exact match (authoritative for historical data)
	for (var i = 0; i < rosterIds.length; i++) {
		var rid = parseInt(rosterIds[i]);
		var name = PSO.franchiseNames[rid][season];
		if (name && name.toLowerCase() === lowerOwner) {
			return rid;
		}
	}

	// Season-specific partial match (e.g., "Schexes" matches "Schex/Jeff", "Koci" matches "Koci/Mueller")
	for (var i = 0; i < rosterIds.length; i++) {
		var rid = parseInt(rosterIds[i]);
		var name = PSO.franchiseNames[rid][season];
		if (name && (name.toLowerCase().indexOf(lowerOwner) >= 0 || lowerOwner.indexOf(name.toLowerCase()) >= 0)) {
			return rid;
		}
	}

	// Fall back to current franchiseIds (for cases without season context)
	var keys = Object.keys(PSO.franchiseIds);
	for (var i = 0; i < keys.length; i++) {
		if (keys[i].toLowerCase() === lowerOwner) {
			return PSO.franchiseIds[keys[i]];
		}
	}

	return null;
}

/**
 * Parse a postseason snapshot file.
 * Returns: [{ id, owner, name, position, startYear, endYear, salary }]
 */
function parsePostseasonSnapshot(year) {
	var file = path.join(SNAPSHOTS_DIR, 'postseason-' + year + '.txt');
	if (!fs.existsSync(file)) return [];

	var content = fs.readFileSync(file, 'utf8');
	var lines = content.trim().split('\n');
	var players = [];

	for (var i = 1; i < lines.length; i++) {
		var parts = lines[i].split(',');
		if (parts.length < 7) continue;

		var id = parts[0];
		var owner = parts[1];
		var name = parts[2];
		var position = parts[3];
		var startYear = parts[4] === 'FA' ? null : parseInt(parts[4]);
		var endYear = parseInt(parts[5]);
		var salaryStr = parts[6].replace(/[$,]/g, '');
		var salary = salaryStr ? parseInt(salaryStr) : 1;
		if (isNaN(salary)) salary = 1;
		if (isNaN(endYear)) endYear = year;

		players.push({
			id: id,
			owner: owner ? owner.trim() : null,
			name: name,
			position: position,
			startYear: startYear,
			endYear: endYear,
			salary: salary
		});
	}

	return players;
}

// =============================================================================
// Offseason Cuts (all years)
// =============================================================================

/**
 * Generate offseason cut records grouped by franchise.
 */
function generateOffseasonCuts(cuts, auctionDates) {
	var records = [];

	// Group offseason cuts by (cutYear, rosterId)
	var groups = {};
	cuts.forEach(function(cut) {
		if (!cut.offseason) return;
		var key = cut.cutYear + '|' + cut.rosterId;
		if (!groups[key]) {
			groups[key] = {
				season: cut.cutYear,
				rosterId: cut.rosterId,
				cuts: []
			};
		}
		groups[key].cuts.push(cut);
	});

	Object.keys(groups).forEach(function(key) {
		var group = groups[key];
		var timestamp = getCutDayTimestamp(group.season);
		if (!timestamp) {
			console.warn('Warning: No cut due date for ' + group.season + ', skipping offseason cuts');
			return;
		}

		var drops = group.cuts.map(function(cut) {
			var drop = {
				name: cut.name,
				position: cut.position,
				salary: cut.salary,
				startYear: cut.startYear,
				endYear: cut.endYear
			};
			if (cut.sleeperId) drop.sleeperId = cut.sleeperId;
			return drop;
		});

		records.push({
			season: group.season,
			timestamp: timestamp.toISOString(),
			rosterId: group.rosterId,
			adds: [],
			drops: drops,
			source: 'offseason',
			sourceId: null,
			tradeId: null,
			inferred: false
		});
	});

	return records;
}

// =============================================================================
// Platform Data (2020+)
// =============================================================================

/**
 * Determine if a commissioner transaction should be imported.
 */
function shouldImportCommissioner(tx, fixups) {
	// Force-include if explicitly listed
	if (tx.factSource === 'sleeper' && fixups.sleeperIncluded.has(tx.transactionId)) {
		return true;
	}
	if (tx.factSource === 'fantrax' && fixups.fantraxIncluded.has(tx.transactionId)) {
		return true;
	}

	// Import manual_assist and trade_facilitation
	if (tx.confidence === 'manual_assist' || tx.confidence === 'trade_facilitation') {
		return true;
	}

	// Skip rollback_likely, reversal_pair, unknown
	return false;
}

/**
 * Generate records from Sleeper platform data (2022+).
 */
function generateSleeperRecords(fixups, cutsLookup) {
	var records = [];
	var years = sleeperFacts.getAvailableYears();

	years.forEach(function(season) {
		var raw = sleeperFacts.loadSeason(season);
		raw.forEach(function(tx) { tx.season = season; tx.factSource = 'sleeper'; });

		// Regular FA transactions (in-season)
		var faTx = sleeperFacts.getFATransactions(raw);
		var allFaTx = sleeperFacts.filterRealFaab(faTx);
		var processedTxIds = new Set();

		allFaTx.forEach(function(tx) {
			if (fixups.sleeperIgnored.has(tx.transactionId)) return;
			processedTxIds.add(tx.transactionId);

			var rosterId = tx.rosterIds ? tx.rosterIds[0] : null;
			if (!rosterId && tx.adds && tx.adds.length > 0) rosterId = tx.adds[0].rosterId;
			if (!rosterId && tx.drops && tx.drops.length > 0) rosterId = tx.drops[0].rosterId;

			var record = buildPlatformRecord(tx, season, rosterId, 'sleeper', cutsLookup, fixups);
			if (record) records.push(record);
		});

		// Commissioner actions (from findCommissionerActions, which applies filterRealFaab)
		var commissionerTx = sleeperFacts.findCommissionerActions(raw);
		var processedCommissionerIds = new Set();

		commissionerTx.forEach(function(tx) {
			tx.season = season;
			tx.factSource = 'sleeper';
			tx.isCommissionerAction = true;
			processedCommissionerIds.add(tx.transactionId);

			if (fixups.sleeperIgnored.has(tx.transactionId)) return;
			if (!shouldImportCommissioner(tx, fixups)) return;

			var rosterId = tx.rosterIds ? tx.rosterIds[0] : null;
			var record = buildPlatformRecord(tx, season, rosterId, 'sleeper', cutsLookup, fixups);
			if (record) records.push(record);
		});

		// Force-included transactions that may have been filtered out by filterRealFaab
		raw.forEach(function(tx) {
			if (processedTxIds.has(tx.transactionId)) return;
			if (processedCommissionerIds.has(tx.transactionId)) return;
			if (fixups.sleeperIgnored.has(tx.transactionId)) return;
			if (!fixups.sleeperIncluded.has(tx.transactionId)) return;

			tx.season = season;
			tx.factSource = 'sleeper';
			tx.isCommissionerAction = true;

			var rosterId = tx.rosterIds ? tx.rosterIds[0] : null;
			var record = buildPlatformRecord(tx, season, rosterId, 'sleeper', cutsLookup, fixups);
			if (record) records.push(record);
		});
	});

	return records;
}

/**
 * Generate records from Fantrax platform data (2020-2021).
 */
function generateFantraxRecords(fixups, cutsLookup, sleeperIdLookup) {
	var records = [];

	[2020, 2021].forEach(function(season) {
		var raw = fantraxFacts.loadSeason(season);
		raw.forEach(function(tx) { tx.season = season; tx.factSource = 'fantrax'; });

		// Regular waiver transactions
		var waiverTx = fantraxFacts.getWaivers(raw);
		waiverTx = fantraxFacts.filterRealFaab(waiverTx);
		waiverTx = waiverTx.filter(function(tx) { return !tx.isCommissioner; });

		// Standalone claims
		var claimTx = fantraxFacts.getClaims(raw);
		claimTx = fantraxFacts.filterRealFaab(claimTx);
		claimTx = claimTx.filter(function(tx) { return !tx.isCommissioner; });

		// Standalone drops
		var dropTx = fantraxFacts.getDrops(raw);
		dropTx = fantraxFacts.filterRealFaab(dropTx);
		dropTx = dropTx.filter(function(tx) { return !tx.isCommissioner; });

		var allTx = waiverTx.concat(claimTx).concat(dropTx);

		allTx.forEach(function(tx) {
			if (fixups.fantraxIgnored.has(tx.transactionId)) return;

			// Map Fantrax team ID to rosterId
			var fantraxMapping = PSO.fantraxIds[season];
			var rosterId = fantraxMapping ? fantraxMapping[tx.franchiseTeamId] : null;

			if (!rosterId && tx.owner) {
				rosterId = ownerToRosterId(tx.owner, season);
			}

			var record = buildPlatformRecord(tx, season, rosterId, 'fantrax', cutsLookup, fixups, sleeperIdLookup);
			if (record) records.push(record);
		});

		// Commissioner actions
		var commissionerTx = fantraxFacts.findCommissionerActions(raw);
		commissionerTx.forEach(function(tx) {
			tx.season = season;
			tx.factSource = 'fantrax';
			tx.isCommissionerAction = true;

			if (fixups.fantraxIgnored.has(tx.transactionId)) return;
			if (!shouldImportCommissioner(tx, fixups)) return;

			var fantraxMapping = PSO.fantraxIds[season];
			var rosterId = fantraxMapping ? fantraxMapping[tx.franchiseTeamId] : null;
			if (!rosterId && tx.owner) {
				rosterId = ownerToRosterId(tx.owner, season);
			}

			var record = buildPlatformRecord(tx, season, rosterId, 'fantrax', cutsLookup, fixups, sleeperIdLookup);
			if (record) records.push(record);
		});
	});

	return records;
}

/**
 * Build an fa.json record from a platform transaction.
 */
function buildPlatformRecord(tx, season, rosterId, source, cutsLookup, fixups, sleeperIdLookup) {
	if (!rosterId) {
		console.warn('Warning: No rosterId for ' + source + ' tx ' + tx.transactionId);
		return null;
	}

	var adds = (tx.adds || []).map(function(add) {
		var sleeperId = add.playerId;
		// For Fantrax, playerId is a Fantrax ID, not a Sleeper ID — resolve via name
		if (source === 'fantrax') {
			sleeperId = null;
			if (sleeperIdLookup && add.playerName) {
				var resolved = sleeperIdLookup[resolver.normalizePlayerName(add.playerName)];
				if (resolved) sleeperId = resolved;
			}
		}

		var entry = {
			name: add.playerName,
			position: add.position || add.positions || null,
			salary: tx.waiverBid || tx.bid || 0,
			startYear: null,
			endYear: season
		};
		if (sleeperId) entry.sleeperId = sleeperId;
		return entry;
	});

	var drops = (tx.drops || []).map(function(drop) {
		var sleeperId = drop.playerId;
		// For Fantrax, resolve via name
		if (source === 'fantrax') {
			sleeperId = null;
			if (sleeperIdLookup && drop.playerName) {
				var resolved = sleeperIdLookup[resolver.normalizePlayerName(drop.playerName)];
				if (resolved) sleeperId = resolved;
			}
		}

		var entry = {
			name: drop.playerName,
			position: drop.position || drop.positions || null,
			salary: null,
			startYear: null,
			endYear: null
		};
		if (sleeperId) entry.sleeperId = sleeperId;

		// Try to get contract data from cuts.json
		var cutEntries = null;
		if (sleeperId) {
			cutEntries = cutsLookup.bySleeperId[sleeperId + '|' + season];
		}
		if (!cutEntries && drop.playerName) {
			// Fallback to name-based lookup (needed for Fantrax)
			cutEntries = cutsLookup.byName[drop.playerName.toLowerCase() + '|' + season + '|' + rosterId];
		}
		if (cutEntries && cutEntries.length > 0) {
			// Find the cut that matches this drop (by owner/rosterId)
			var matchingCut = cutEntries.find(function(c) {
				return c.rosterId === rosterId && !c.offseason;
			});
			if (matchingCut) {
				entry.salary = matchingCut.salary;
				entry.startYear = matchingCut.startYear;
				entry.endYear = matchingCut.endYear;
			} else if (cutEntries.length === 1) {
				// Only one cut for this player/year, use it
				entry.salary = cutEntries[0].salary;
				entry.startYear = cutEntries[0].startYear;
				entry.endYear = cutEntries[0].endYear;
			}
		}

		return entry;
	});

	if (adds.length === 0 && drops.length === 0) return null;

	// Check for trade facilitation linkage
	var tradeId = null;
	if (fixups.tradeFacilitation[tx.transactionId] !== undefined) {
		tradeId = fixups.tradeFacilitation[tx.transactionId];
	}

	return {
		season: season,
		timestamp: tx.timestamp instanceof Date ? tx.timestamp.toISOString() : tx.timestamp,
		rosterId: rosterId,
		adds: adds,
		drops: drops,
		source: source,
		sourceId: tx.transactionId || null,
		tradeId: tradeId,
		inferred: false
	};
}

// =============================================================================
// Pre-2020 In-Season Cuts
// =============================================================================

/**
 * Generate records for pre-2020 in-season cuts from cuts.json.
 * Each non-offseason cut becomes a standalone drop record.
 */
function generatePrePlatformCuts(cuts, trades) {
	var records = [];

	// Build a trade index: for each player+season+owner, find the latest trade
	// that brought the player to that owner. Cut timestamps must be after such trades.
	var tradeReceiptMap = {};  // "playerKey|season|owner" -> latest trade date
	(trades || []).forEach(function(trade) {
		var year = new Date(trade.date).getFullYear();
		trade.parties.forEach(function(party) {
			party.players.forEach(function(p) {
				var playerKey = p.sleeperId || p.name.toLowerCase();
				var key = playerKey + '|' + year + '|' + party.owner.toLowerCase();
				var tradeDate = new Date(trade.date);
				if (!tradeReceiptMap[key] || tradeDate > tradeReceiptMap[key]) {
					tradeReceiptMap[key] = tradeDate;
				}
			});
		});
	});

	// Track per-player cut count per season so repeated cuts get advancing timestamps.
	// cuts.json is chronologically ordered, so we just increment for each additional cut.
	var playerCutCount = {};

	cuts.forEach(function(cut) {
		if (cut.offseason) return;
		if (cut.cutYear >= 2020) return;

		var drop = {
			name: cut.name,
			position: cut.position,
			salary: cut.salary,
			startYear: cut.startYear,
			endYear: cut.endYear
		};
		if (cut.sleeperId) drop.sleeperId = cut.sleeperId;

		// For pre-2020 cuts, we don't have exact timestamps.
		// Use a :33 conventional timestamp. Place in the middle of the season.
		// When the same player is cut multiple times in a season, advance by 1 day
		// per additional cut so the timeline chains correctly with inferred adds.
		var playerKey = (cut.sleeperId || cut.name.toLowerCase()) + '|' + cut.cutYear;
		var cutIndex = playerCutCount[playerKey] || 0;
		playerCutCount[playerKey] = cutIndex + 1;

		var conventionalTimestamp = new Date(Date.UTC(cut.cutYear, 9, 15 + cutIndex, 12, 0, 33));

		// If this player was traded to this owner in this season, the cut must
		// come after the trade (e.g., Mostert traded to Patrick Nov 8, cut later)
		var tradeKey = (cut.sleeperId || cut.name.toLowerCase()) + '|' + cut.cutYear + '|' + cut.owner.toLowerCase();
		var tradeDate = tradeReceiptMap[tradeKey];
		var timestamp = conventionalTimestamp;
		if (tradeDate && tradeDate >= conventionalTimestamp) {
			// Place cut 1 minute after the trade, preserving :33 convention
			timestamp = new Date(tradeDate.getTime());
			timestamp.setUTCSeconds(33);
			timestamp.setUTCMilliseconds(0);
			timestamp = new Date(timestamp.getTime() + 60000);
		}

		records.push({
			season: cut.cutYear,
			timestamp: timestamp.toISOString(),
			rosterId: cut.rosterId,
			adds: [],
			drops: [drop],
			source: 'cuts',
			sourceId: null,
			tradeId: null,
			inferred: false
		});
	});

	return records;
}

// =============================================================================
// Pre-2020 Inferred Adds
// =============================================================================

/**
 * Build a map of trades by season for quick lookup.
 * Returns: { season: [{ tradeId, date, year, parties: [...] }] }
 * Each party has: { owner, players: [{ name, sleeperId, startYear, endYear }] }
 */
function buildTradesBySeason(trades) {
	var bySeason = {};

	trades.forEach(function(trade) {
		var year = new Date(trade.date).getFullYear();
		if (!bySeason[year]) bySeason[year] = [];

		var parsedParties = trade.parties.map(function(party) {
			var players = (party.players || []).map(function(p) {
				return {
					name: p.name,
					sleeperId: p.sleeperId || null,
					startYear: p.contract ? p.contract.start : null,
					endYear: p.contract ? p.contract.end : null,
					contractStr: p.contractStr || null,
					salary: p.salary || null
				};
			});
			return {
				owner: party.owner,
				players: players
			};
		});

		bySeason[year].push({
			tradeId: trade.tradeId,
			date: trade.date,
			year: year,
			parties: parsedParties
		});
	});

	// Sort by date within each season
	Object.keys(bySeason).forEach(function(year) {
		bySeason[year].sort(function(a, b) {
			return new Date(a.date) - new Date(b.date);
		});
	});

	return bySeason;
}

/**
 * Find the original acquirer of a player with an FA contract by tracing trades backward.
 *
 * If the player was traded during this season, walk backward through the trade chain
 * to find who had the player first (that's who picked them up off FA).
 *
 * @param {string} sleeperId - Player's Sleeper ID (or null for historical)
 * @param {string} playerName - Player name
 * @param {string} knownOwner - The owner we know had the player
 * @param {number} season - The season year
 * @param {Array} seasonTrades - Trades for this season, sorted by date
 * @param {Date|null} notBefore - Don't trace through trades before this date (e.g., a prior cut means the trade chain is broken)
 * @returns {{ owner: string, upperBound: Date|null }} The original acquirer and the trade date (upper bound for timestamp)
 */
function traceOriginalAcquirer(sleeperId, playerName, knownOwner, season, seasonTrades, notBefore) {
	var currentOwner = knownOwner;
	var upperBound = null;
	var lowerName = playerName ? playerName.toLowerCase() : '';

	// Walk trades in reverse chronological order
	for (var i = seasonTrades.length - 1; i >= 0; i--) {
		var trade = seasonTrades[i];

		// Don't trace through trades that happened before the notBefore date.
		// This prevents tracing through a trade chain that was broken by a cut —
		// e.g. if an owner received a player via trade, cut them, then re-acquired
		// from FA, the trade is no longer relevant to the re-acquisition.
		if (notBefore && new Date(trade.date) < notBefore) continue;

		// Check each party's received players
		for (var j = 0; j < trade.parties.length; j++) {
			var party = trade.parties[j];

			var playerInReceived = party.players.some(function(p) {
				if (sleeperId && p.sleeperId) return p.sleeperId === sleeperId;
				return p.name && p.name.toLowerCase() === lowerName;
			});

			if (playerInReceived && party.owner.toLowerCase() === currentOwner.toLowerCase()) {
				// This trade brought the player to currentOwner.
				// Find who sent them (the other party).
				// For 2-party trades, it's the other party.
				if (trade.parties.length === 2) {
					var otherParty = trade.parties[1 - j];
					upperBound = new Date(trade.date);
					currentOwner = otherParty.owner;
				}
				// For 3+ party trades, we can't easily determine sender.
				// Just use the trade date as the upper bound.
				break;
			}
		}
	}

	return { owner: currentOwner, upperBound: upperBound };
}

/**
 * Generate inferred FA add records for pre-2020 seasons.
 *
 * Sources of evidence:
 * 1. cuts.json: player cut with startYear=null -> was picked up as FA
 * 2. trades.json: player traded with startYear=null contract -> was picked up as FA
 * 3. Postseason snapshots: owned player with FA contract -> was picked up as FA
 */
function generateInferredAdds(cuts, trades, auctionDates) {
	var records = [];
	var tradesBySeason = buildTradesBySeason(trades);

	// Track FA pickups we've already emitted to avoid duplicates.
	// Key: "sleeperId|season|owner" or "name|season|owner"
	var emitted = new Set();

	// Build a trade receipt index for trade-aware cut timestamps
	// (mirrors generatePrePlatformCuts's tradeReceiptMap)
	var tradeReceiptMap = {};
	(trades || []).forEach(function(trade) {
		var year = new Date(trade.date).getFullYear();
		trade.parties.forEach(function(party) {
			party.players.forEach(function(p) {
				var playerKey = p.sleeperId || p.name.toLowerCase();
				var key = playerKey + '|' + year + '|' + party.owner.toLowerCase();
				var tradeDate = new Date(trade.date);
				if (!tradeReceiptMap[key] || tradeDate > tradeReceiptMap[key]) {
					tradeReceiptMap[key] = tradeDate;
				}
			});
		});
	});

	// Process seasons 2008-2019
	for (var season = 2008; season <= 2019; season++) {
		var seasonTrades = tradesBySeason[season] || [];
		var faabOpen = sleeperFacts.faabOpenDates[season] || fantraxFacts.faabOpenDates[season];
		if (!faabOpen) {
			// Construct from first Wednesday after Labor Day
			faabOpen = getFaabOpenDate(season);
		}
		var seasonEnd = new Date(Date.UTC(season, 11, 31));

		// 1. Cuts with FA contracts
		var seasonCuts = cuts.filter(function(c) {
			return c.cutYear === season && c.startYear === null && !c.offseason;
		});

		// Build per-player index for ALL cuts (FA and non-FA) in this season.
		// This mirrors generatePrePlatformCuts's timestamp logic (Oct 15 + N days)
		// and lets us use non-FA cuts as lower bounds for inferred adds.
		var allSeasonCuts = cuts.filter(function(c) {
			return c.cutYear === season && !c.offseason && c.cutYear < 2020;
		});

		// Map each cut object to its per-player ordinal position (and thus its timestamp)
		var cutPositionMap = new Map();
		var playerCutCount = {};
		allSeasonCuts.forEach(function(c) {
			var pk = c.sleeperId || c.name.toLowerCase();
			var idx = playerCutCount[pk] || 0;
			playerCutCount[pk] = idx + 1;
			cutPositionMap.set(c, idx);
		});

		// Build per-player last cut timestamp so sections 2 and 3 can use it as a lower bound.
		// Uses trade-adjusted timestamps (matching generatePrePlatformCuts) so that cuts
		// placed after trades aren't underestimated by the conventional Oct 15 + N formula.
		// Also track cuts by owner (playerKey + rosterId) for re-acquisition detection.
		var playerLastCutTimestamp = {};
		var playerCutByOwner = {};  // playerKey + '|' + rosterId -> cut timestamp
		allSeasonCuts.forEach(function(c) {
			var pk = c.sleeperId || c.name.toLowerCase();
			var idx = cutPositionMap.get(c);
			var conventionalTs = new Date(Date.UTC(season, 9, 15 + idx, 12, 0, 33));

			// Check for trade-adjusted timestamp
			var tradeKey = pk + '|' + season + '|' + c.owner.toLowerCase();
			var tradeDate = tradeReceiptMap[tradeKey];
			var ts = conventionalTs;
			if (tradeDate && tradeDate >= conventionalTs) {
				ts = new Date(tradeDate.getTime());
				ts.setUTCSeconds(33);
				ts.setUTCMilliseconds(0);
				ts = new Date(ts.getTime() + 60000);
			}

			if (!playerLastCutTimestamp[pk] || ts > playerLastCutTimestamp[pk]) {
				playerLastCutTimestamp[pk] = ts;
			}
			
			// Track cuts by owner for re-acquisition detection
			var ownerCutKey = pk + '|' + c.rosterId;
			if (!playerCutByOwner[ownerCutKey] || ts > playerCutByOwner[ownerCutKey]) {
				playerCutByOwner[ownerCutKey] = ts;
			}
		});

		seasonCuts.forEach(function(cut) {
			// If this is a repeat cut of the same player (perPlayerIdx > 0),
			// don't trace through trades that happened before the prior cut.
			// The prior cut breaks the trade chain — the re-acquisition came
			// from the FA pool, not from the original trade.
			var perPlayerIdx = cutPositionMap.get(cut) || 0;
			var notBefore = null;
			if (perPlayerIdx > 0) {
				var pk = cut.sleeperId || cut.name.toLowerCase();
				// Use the prior cut's timestamp (trade-adjusted if applicable)
				// We find the Nth cut's timestamp by looking at allSeasonCuts
				var priorConventional = new Date(Date.UTC(season, 9, 15 + (perPlayerIdx - 1), 12, 0, 33));
				// Check trade-adjusted version
				var priorCutObj = allSeasonCuts.filter(function(c) {
					return (c.sleeperId || c.name.toLowerCase()) === pk;
				})[perPlayerIdx - 1];
				if (priorCutObj) {
					var tradeKey = pk + '|' + season + '|' + priorCutObj.owner.toLowerCase();
					var tradeDate = tradeReceiptMap[tradeKey];
					if (tradeDate && tradeDate >= priorConventional) {
						notBefore = new Date(tradeDate.getTime());
						notBefore.setUTCSeconds(33);
						notBefore.setUTCMilliseconds(0);
						notBefore = new Date(notBefore.getTime() + 60000);
					} else {
						notBefore = priorConventional;
					}
				} else {
					notBefore = priorConventional;
				}
			}

			var result = traceOriginalAcquirer(
				cut.sleeperId, cut.name, cut.owner, season, seasonTrades, notBefore
			);

			var rosterId = ownerToRosterId(result.owner, season);
			if (!rosterId) {
				console.warn('Warning: Cannot resolve owner "' + result.owner + '" for season ' + season);
				return;
			}

			// Include perPlayerIdx in emit key so the same owner can pick up and cut
			// the same player multiple times in one season (e.g. Cody Parkey 2018)
			var baseKey = (cut.sleeperId || cut.name.toLowerCase()) + '|' + season + '|' + rosterId;
			var emitKey = baseKey + '|' + perPlayerIdx;
			if (emitted.has(emitKey)) return;
			emitted.add(emitKey);
			// Also add base key so sections 2 and 3 know this player+season+owner was handled
			emitted.add(baseKey);
			var cutTimestamp = new Date(Date.UTC(season, 9, 15 + perPlayerIdx, 12, 0, 33));

			// Lower bound: if there's a prior cut of this player (any type), the add
			// must come after it. Otherwise, FAAB open.
			var lowerBound = faabOpen;
			if (perPlayerIdx > 0) {
				var priorCutTimestamp = new Date(Date.UTC(season, 9, 15 + (perPlayerIdx - 1), 12, 0, 33));
				lowerBound = new Date(priorCutTimestamp.getTime() + 60000);
			}

			// Upper bound: trade date if available, otherwise the cut's own timestamp
			var timestamp = inferTimestamp(lowerBound, result.upperBound || cutTimestamp);

			var add = {
				name: cut.name,
				position: cut.position,
				salary: cut.salary || 1,
				startYear: null,
				endYear: cut.endYear
			};
			if (cut.sleeperId) add.sleeperId = cut.sleeperId;

			records.push({
				season: season,
				timestamp: timestamp.toISOString(),
				rosterId: rosterId,
				adds: [add],
				drops: [],
				source: 'inferred',
				sourceId: null,
				tradeId: null,
				inferred: true
			});
		});

		// 2. Trades with FA-contracted players
		seasonTrades.forEach(function(trade) {
			trade.parties.forEach(function(party) {
				party.players.forEach(function(player) {
					// Check if player has FA contract (startYear=null or contractStr='unsigned')
					var isFA = player.startYear === null ||
						player.contractStr === 'unsigned' ||
						(player.contractStr && player.contractStr.startsWith('FA/'));
					if (!isFA) return;
					if (!player.endYear) return;

					var playerKey = player.sleeperId || player.name.toLowerCase();

					// If the trade happened after the player's last cut this season,
					// this is a re-acquisition (e.g. Schex cuts King, re-picks up, trades).
					// Don't let Section 1's base key block it.
					var tradeDate = new Date(trade.date);
					var lastCut = playerLastCutTimestamp[playerKey];
					var isReacquisition = lastCut && tradeDate > lastCut;

					// For re-acquisitions, don't trace through trades before the last cut —
					// the trade chain is broken by the cut + FA re-pickup.
					var notBefore = isReacquisition ? lastCut : null;

					var result = traceOriginalAcquirer(
						player.sleeperId, player.name, party.owner, season, seasonTrades, notBefore
					);

					var rosterId = ownerToRosterId(result.owner, season);
					if (!rosterId) return;

					var emitKey = playerKey + '|' + season + '|' + rosterId;

					if (!isReacquisition && emitted.has(emitKey)) return;
					emitted.add(emitKey);

					var lowerBound = faabOpen;
					if (lastCut) {
						var afterLastCut = new Date(lastCut.getTime() + 60000);
						if (afterLastCut > lowerBound) lowerBound = afterLastCut;
					}

					var upperBound = result.upperBound || tradeDate;
					var timestamp = inferTimestamp(lowerBound, upperBound);

				var add = {
					name: player.name,
					position: null,
					salary: player.salary || 1,
					startYear: null,
					endYear: player.endYear
				};
				if (player.sleeperId) add.sleeperId = player.sleeperId;

					records.push({
						season: season,
						timestamp: timestamp.toISOString(),
						rosterId: rosterId,
						adds: [add],
						drops: [],
						source: 'inferred',
						sourceId: null,
						tradeId: null,
						inferred: true
					});
				});
			});
		});

		// 3. Postseason snapshot: owned FA players
		var postseason = parsePostseasonSnapshot(season);
		postseason.forEach(function(player) {
			if (player.startYear !== null) return;  // Not an FA contract
			if (!player.owner) return;               // Not owned

			// If this player was cut during the season, don't trace through
			// trades before the last cut — the cut breaks the trade chain.
			var playerKey3 = (player.id !== '-1' ? player.id : null) || player.name.toLowerCase();
			var notBefore3 = playerLastCutTimestamp[playerKey3] || null;

			var result = traceOriginalAcquirer(
				player.id !== '-1' ? player.id : null,
				player.name,
				player.owner,
				season,
				seasonTrades,
				notBefore3
			);

			var rosterId = ownerToRosterId(result.owner, season);
			if (!rosterId) return;

			var playerId = player.id !== '-1' ? player.id : null;
			var playerKey = playerId || player.name.toLowerCase();
			var lastCut = playerLastCutTimestamp[playerKey];

			// Check if this owner cut this player during the season (re-acquisition case)
			var ownerCutKey = playerKey + '|' + rosterId;
			var ownerCutTimestamp = playerCutByOwner[ownerCutKey];

			// If the same player+season+owner was already emitted (from section 1 or 2),
			// skip unless this owner cut and re-acquired the player.
			var baseKey = (playerId || player.name.toLowerCase()) + '|' + season + '|' + rosterId;
			
			if (emitted.has(baseKey)) {
				// baseKey exists - section 1 or 2 already generated an add for this owner.
				// Only emit again if this owner also cut the player (proving re-acquisition).
				if (!ownerCutTimestamp) return;
				// This is a re-acquisition - use a distinct key
				var emitKey = baseKey + '|reacquisition';
				if (emitted.has(emitKey)) return;
				emitted.add(emitKey);
			} else {
				var emitKey = lastCut ? baseKey + '|postseason' : baseKey;
				if (emitted.has(emitKey)) return;
				emitted.add(emitKey);
				// Also add base key so section 4 knows this player+season+owner was handled
				emitted.add(baseKey);
			}

			var lowerBound = faabOpen;
			// For re-acquisitions, lower bound is after this owner's cut
			// For other cases, use the general last cut timestamp
			var relevantCut = ownerCutTimestamp || lastCut;
			if (relevantCut) {
				var afterCut = new Date(relevantCut.getTime() + 60000);
				if (afterCut > lowerBound) lowerBound = afterCut;
			}

			var timestamp = inferTimestamp(lowerBound, result.upperBound || seasonEnd);

			var add = {
				name: player.name,
				position: player.position,
				salary: player.salary || 1,
				startYear: null,
				endYear: player.endYear
			};
			if (playerId) add.sleeperId = playerId;

			records.push({
				season: season,
				timestamp: timestamp.toISOString(),
				rosterId: rosterId,
				adds: [add],
				drops: [],
				source: 'inferred',
				sourceId: null,
				tradeId: null,
				inferred: true
			});
		});

		// 4. Traded RFA rights (pre-2019): if RFA rights for a player appear in
		// a trade, the giver must have owned the player when their contract expired.
		// Pre-2019, all expiring contracts (including FA) conveyed RFA rights.
		// If the player was previously cut, this proves an FA pickup happened.
		if (season < 2019) {
			trades.forEach(function(trade) {
				if (trade.parties.length !== 2) return;

				var tradeDate = new Date(trade.date);
				var tradeYear = tradeDate.getUTCFullYear();

				// Determine if this trade's RFA rights are for this season.
				// Trades before the auction → rights from end of previous season.
				// Trades during/after the season → rights from end of this season.
				var auctionDate = auctionDates[tradeYear];
				var rightsSeason;
				if (auctionDate && tradeDate < auctionDate) {
					rightsSeason = tradeYear - 1;
				} else {
					rightsSeason = tradeYear;
				}
				if (rightsSeason !== season) return;

				trade.parties.forEach(function(receivingParty, partyIdx) {
					if (!receivingParty.rfaRights || receivingParty.rfaRights.length === 0) return;

					var givingParty = trade.parties[1 - partyIdx];

					receivingParty.rfaRights.forEach(function(rfa) {
						var normalizedRfaName = resolver.normalizePlayerName(rfa.name);
						if (!normalizedRfaName) return;

						// Find the player's most recent cut at or before this season.
						// Only look at cuts in this season or the immediately preceding
						// season — older cuts are too likely to have been followed by
						// a re-acquisition via auction/draft/trade.
						var matchingCuts = [];
						cuts.forEach(function(cut) {
							if (cut.offseason) return;
							if (cut.cutYear > season) return;
							if (cut.cutYear < season - 1) return;

							// If the rfa entry has a sleeperId, match precisely on it
							if (rfa.sleeperId) {
								if (cut.sleeperId !== rfa.sleeperId) return;
							} else {
								var normalizedCutName = resolver.normalizePlayerName(cut.name);
								if (normalizedCutName !== normalizedRfaName) return;
							}

							matchingCuts.push(cut);
						});

						if (matchingCuts.length === 0) return; // No recent cut — player was continuously owned

						// Check for name collisions: if cuts match different sleeperIds,
						// we can't reliably determine which player the RFA rights belong to.
						// (Only relevant when matching by name — sleeperId match is precise.)
						if (!rfa.sleeperId) {
							var sleeperIds = {};
							matchingCuts.forEach(function(c) {
								if (c.sleeperId) sleeperIds[c.sleeperId] = true;
							});
							if (Object.keys(sleeperIds).length > 1) return; // Ambiguous — skip
						}

						// Use the most recent matching cut
						var matchingCut = matchingCuts.sort(function(a, b) {
							return b.cutYear - a.cutYear;
						})[0];

						// If the cut is from the previous season (gap of 1), verify the
						// player wasn't re-acquired by checking the postseason snapshot.
						// If the player appears in the cutYear snapshot, they were picked
						// up that same season and their ownership continued via auction —
						// no FA gap to fill.
						if (matchingCut.cutYear === season - 1) {
							var cutYearSnapshot = parsePostseasonSnapshot(matchingCut.cutYear);
							var reacquired = cutYearSnapshot.some(function(p) {
								if (rfa.sleeperId && p.id) return p.id === rfa.sleeperId;
								return resolver.normalizePlayerName(p.name) === normalizedRfaName;
							});
							if (reacquired) return;
						}

						var giverOwner = givingParty.owner;
						var sleeperId = rfa.sleeperId || matchingCut.sleeperId || null;
						var playerKey = sleeperId || rfa.name.toLowerCase();

						// Trace back through trade chain to find the original FA acquirer
						var lastCut = playerLastCutTimestamp[playerKey] || null;
						var result = traceOriginalAcquirer(
							sleeperId, rfa.name, giverOwner,
							season, seasonTrades, lastCut
						);

						var rosterId = ownerToRosterId(result.owner, season);
						if (!rosterId) return;

						var emitKey = playerKey + '|' + season + '|' + rosterId;
						if (emitted.has(emitKey)) return;
						emitted.add(emitKey);

						var lowerBound = faabOpen;
						if (lastCut) {
							var afterLastCut = new Date(lastCut.getTime() + 60000);
							if (afterLastCut > lowerBound) lowerBound = afterLastCut;
						}

						var upperBound = result.upperBound || seasonEnd;
						var timestamp = inferTimestamp(lowerBound, upperBound);

					var add = {
						name: rfa.name,
						position: matchingCut.position || null,
						salary: matchingCut.salary || 1,
						startYear: null,
						endYear: season
					};
						if (sleeperId) add.sleeperId = sleeperId;

						records.push({
							season: season,
							timestamp: timestamp.toISOString(),
							rosterId: rosterId,
							adds: [add],
							drops: [],
							source: 'inferred',
							sourceId: null,
							tradeId: null,
							inferred: true
						});
					});
				});
			});
		}
	}

	return records;
}

/**
 * Infer a :33 timestamp at the midpoint between two bounds.
 */
function inferTimestamp(lowerBound, upperBound) {
	var lower = lowerBound instanceof Date ? lowerBound.getTime() : new Date(lowerBound).getTime();
	var upper = upperBound instanceof Date ? upperBound.getTime() : new Date(upperBound).getTime();

	if (upper <= lower) {
		// Bounds don't make sense; use lower + 1 day
		upper = lower + 86400000;
	}

	var midpoint = lower + Math.floor((upper - lower) / 2);
	var date = new Date(midpoint);

	// Set seconds to :33
	date.setUTCSeconds(33);
	date.setUTCMilliseconds(0);

	return date;
}

/**
 * Get FAAB open date for a season (Wednesday before Thursday NFL kickoff,
 * which is approximately the Wednesday after Labor Day).
 */
function getFaabOpenDate(season) {
	// Labor Day is first Monday in September
	var laborDay = new Date(Date.UTC(season, 8, 1));
	while (laborDay.getUTCDay() !== 1) {
		laborDay.setUTCDate(laborDay.getUTCDate() + 1);
	}
	// Wednesday after Labor Day
	var wednesday = new Date(laborDay);
	wednesday.setUTCDate(wednesday.getUTCDate() + 2);
	return wednesday;
}

// =============================================================================
// Main
// =============================================================================

function run() {
	console.log('=== FA Transaction Generator ===\n');

	console.log('Loading data...');
	var auctionDates = loadAuctionDates();
	console.log('  Auction dates: ' + Object.keys(auctionDates).length + ' years');

	var fixups = loadFixups();
	console.log('  Sleeper ignored: ' + fixups.sleeperIgnored.size);
	console.log('  Sleeper included: ' + fixups.sleeperIncluded.size);
	console.log('  Fantrax ignored: ' + fixups.fantraxIgnored.size);
	console.log('  Fantrax included: ' + fixups.fantraxIncluded.size);
	console.log('  Trade facilitation links: ' + Object.keys(fixups.tradeFacilitation).length);

	var cuts = loadCuts();
	console.log('  Cuts: ' + cuts.length);

	var trades = loadTrades();
	console.log('  Trades: ' + trades.length);

	var cutsLookup = buildCutsLookup(cuts);

	var allRecords = [];

	// 1. Offseason cuts (all years)
	console.log('\nGenerating offseason cuts...');
	var offseasonRecords = generateOffseasonCuts(cuts, auctionDates);
	console.log('  ' + offseasonRecords.length + ' offseason cut groups');
	allRecords = allRecords.concat(offseasonRecords);

	// 2. Sleeper platform data (2022+)
	console.log('\nGenerating Sleeper records...');
	var sleeperRecords = generateSleeperRecords(fixups, cutsLookup);
	console.log('  ' + sleeperRecords.length + ' Sleeper records');
	allRecords = allRecords.concat(sleeperRecords);

	// 3. Fantrax platform data (2020-2021)
	console.log('\nGenerating Fantrax records...');
	var sleeperIdLookup = buildSleeperIdLookup();
	var fantraxRecords = generateFantraxRecords(fixups, cutsLookup, sleeperIdLookup);
	console.log('  ' + fantraxRecords.length + ' Fantrax records');
	allRecords = allRecords.concat(fantraxRecords);

	// 4. Pre-2020 in-season cuts
	console.log('\nGenerating pre-2020 in-season cuts...');
	var prePlatformCuts = generatePrePlatformCuts(cuts, trades);
	console.log('  ' + prePlatformCuts.length + ' pre-2020 cut records');
	allRecords = allRecords.concat(prePlatformCuts);

	// 5. Pre-2020 inferred adds
	console.log('\nGenerating pre-2020 inferred adds...');
	var inferredAdds = generateInferredAdds(cuts, trades, auctionDates);
	console.log('  ' + inferredAdds.length + ' inferred add records');
	allRecords = allRecords.concat(inferredAdds);

	// Sort all records by timestamp
	allRecords.sort(function(a, b) {
		return new Date(a.timestamp) - new Date(b.timestamp);
	});

	// Summary stats
	console.log('\n=== Summary ===');
	var bySource = {};
	var totalAdds = 0;
	var totalDrops = 0;
	allRecords.forEach(function(r) {
		bySource[r.source] = (bySource[r.source] || 0) + 1;
		totalAdds += r.adds.length;
		totalDrops += r.drops.length;
	});
	console.log('Total records: ' + allRecords.length);
	console.log('Total adds: ' + totalAdds);
	console.log('Total drops: ' + totalDrops);
	console.log('By source:');
	Object.keys(bySource).sort().forEach(function(source) {
		console.log('  ' + source + ': ' + bySource[source]);
	});

	// Write output
	fs.writeFileSync(FA_FILE, JSON.stringify(allRecords, null, '\t'));
	console.log('\nWrote ' + FA_FILE);

	// Audit: every cuts.json record should have a corresponding drop in fa.json
	console.log('\n=== Cuts Audit ===');
	var dropIndex = {};
	allRecords.forEach(function(r) {
		r.drops.forEach(function(d) {
			// Index by name|cutYear|rosterId for matching
			var key = d.name.toLowerCase() + '|' + r.season + '|' + r.rosterId;
			if (!dropIndex[key]) dropIndex[key] = [];
			dropIndex[key].push(r);

			// Also index by sleeperId if available
			if (d.sleeperId) {
				var sidKey = d.sleeperId + '|' + r.season + '|' + r.rosterId;
				if (!dropIndex[sidKey]) dropIndex[sidKey] = [];
				dropIndex[sidKey].push(r);
			}
		});
	});

	var unmatched = [];
	cuts.forEach(function(cut) {
		var matched = false;

		// Try sleeperId match first
		if (cut.sleeperId) {
			var sidKey = cut.sleeperId + '|' + cut.cutYear + '|' + cut.rosterId;
			if (dropIndex[sidKey] && dropIndex[sidKey].length > 0) {
				matched = true;
			}
		}

		// Fall back to name match
		if (!matched) {
			var nameKey = cut.name.toLowerCase() + '|' + cut.cutYear + '|' + cut.rosterId;
			if (dropIndex[nameKey] && dropIndex[nameKey].length > 0) {
				matched = true;
			}
		}

		if (!matched) {
			unmatched.push(cut);
		}
	});

	if (unmatched.length === 0) {
		console.log('All ' + cuts.length + ' cuts.json records matched in fa.json');
	} else {
		console.log(unmatched.length + ' of ' + cuts.length + ' cuts.json records NOT found in fa.json:');
		unmatched.forEach(function(cut) {
			console.log('  ' + cut.name + ' (' + cut.position + ') ' + cut.cutYear + ' by ' + cut.owner + ' (rosterId:' + cut.rosterId + ')' + (cut.offseason ? ' [offseason]' : ''));
		});
	}
}

run();
