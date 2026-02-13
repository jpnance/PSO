#!/usr/bin/env node
/**
 * DSL Generator
 * 
 * Generates player-history.dsl from pre-computed event sources:
 *   - auctions.json (summer auction wins)
 *   - contracts.json (contract signings)
 *   - drafts.json (rookie draft selections)
 *   - trades.json (trades)
 *   - fa.json (FA adds and drops — explicit and inferred)
 *   - rfa.json (RFA rights conversions and contract expiries)
 *   - expansion-draft-2012.txt (one-time expansion draft)
 * 
 * This script does NO inference — it translates pre-computed JSON
 * records into DSL event lines and sorts them chronologically.
 * 
 * Usage:
 *   node data/dsl/generate.js
 */

var fs = require('fs');
var path = require('path');

var DSL_FILE = path.join(__dirname, 'player-history.dsl');
var AUCTIONS_FILE = path.join(__dirname, '../auctions/auctions.json');
var CONTRACTS_FILE = path.join(__dirname, '../contracts/contracts.json');
var TRADES_FILE = path.join(__dirname, '../trades/trades.json');
var DRAFTS_FILE = path.join(__dirname, '../drafts/drafts.json');
var FA_FILE = path.join(__dirname, '../fa/fa.json');
var RFA_FILE = path.join(__dirname, '../rfa/rfa.json');
var EXPANSION_DRAFT_FILE = path.join(__dirname, '../archive/sources/txt/expansion-draft-2012.txt');
var EXPANSION_PROTECTIONS_FILE = path.join(__dirname, '../archive/sources/txt/expansion-draft-protections-2012.txt');

var PSO = require('../../config/pso.js');
var leagueDates = require('../../config/dates.js');

// =============================================================================
// Helpers
// =============================================================================

function yy(year) {
	if (year === null || year === undefined) return 'FA';
	return String(year % 100).padStart(2, '0');
}

function rosterIdToOwner(rosterId, season) {
	var yearMap = PSO.franchiseNames[rosterId];
	if (yearMap && yearMap[season]) return yearMap[season];
	// Fall back to current names
	var names = Object.keys(PSO.franchiseIds);
	for (var i = 0; i < names.length; i++) {
		if (PSO.franchiseIds[names[i]] === rosterId) return names[i];
	}
	return 'Unknown(' + rosterId + ')';
}

function playerKey(sleeperId, name) {
	if (sleeperId && sleeperId !== '-1') return sleeperId;
	return 'name:' + name.toLowerCase();
}

// =============================================================================
// Data loaders
// =============================================================================

function loadAuctions() {
	return JSON.parse(fs.readFileSync(AUCTIONS_FILE, 'utf8'));
}

function loadContracts() {
	return JSON.parse(fs.readFileSync(CONTRACTS_FILE, 'utf8'));
}

function loadDrafts() {
	var drafts = JSON.parse(fs.readFileSync(DRAFTS_FILE, 'utf8'));
	var byPlayer = {};

	drafts.forEach(function(d) {
		if (!d.playerName) return; // skip passed picks

		var teamsCount = d.season < 2012 ? 10 : 12;
		var pickInRound = d.pickNumber - (d.round - 1) * teamsCount;

		var entry = {
			season: d.season,
			round: d.round,
			pickInRound: pickInRound,
			owner: d.owner,
			sleeperId: d.sleeperId || null,
			name: d.playerName
		};

		var key = d.sleeperId || ('name:' + d.playerName.toLowerCase());
		byPlayer[key] = entry;
	});

	return byPlayer;
}

function loadTrades() {
	var trades = JSON.parse(fs.readFileSync(TRADES_FILE, 'utf8'));
	var byPlayer = {};

	trades.forEach(function(trade) {
		trade.parties.forEach(function(party) {
			(party.players || []).forEach(function(player) {
				var entry = {
					tradeId: trade.tradeId,
					date: trade.date,
					toOwner: party.owner,
					sleeperId: player.sleeperId || null,
					contractStr: player.contractStr || null
				};

				if (player.sleeperId) {
					if (!byPlayer[player.sleeperId]) byPlayer[player.sleeperId] = [];
					byPlayer[player.sleeperId].push(entry);
				}

				if (player.name) {
					var nameKey = 'name:' + player.name.toLowerCase();
					if (!byPlayer[nameKey]) byPlayer[nameKey] = [];
					byPlayer[nameKey].push(entry);
				}
			});
		});
	});

	Object.keys(byPlayer).forEach(function(k) {
		byPlayer[k].sort(function(a, b) {
			return new Date(a.date) - new Date(b.date);
		});
	});

	return byPlayer;
}

function loadFA() {
	return JSON.parse(fs.readFileSync(FA_FILE, 'utf8'));
}

function loadRFA() {
	return JSON.parse(fs.readFileSync(RFA_FILE, 'utf8'));
}

function loadExpansionSelections() {
	var content = fs.readFileSync(EXPANSION_DRAFT_FILE, 'utf8');
	var lines = content.trim().split('\n');
	var selections = {};

	for (var i = 1; i < lines.length; i++) {
		var parts = lines[i].split(',');
		if (parts.length < 5) continue;

		selections[parts[3].trim().toLowerCase()] = {
			pick: parseInt(parts[0]),
			round: parseInt(parts[1]),
			toOwner: parts[2].trim(),
			fromOwner: parts[4].trim()
		};
	}

	return selections;
}

function loadExpansionProtections() {
	var content = fs.readFileSync(EXPANSION_PROTECTIONS_FILE, 'utf8');
	var lines = content.trim().split('\n');
	var protections = {};

	for (var i = 0; i < lines.length; i++) {
		var line = lines[i].trim();
		if (!line || line.startsWith('#')) continue;

		var match = line.match(/^([^(]+)\s*\(\d+\):\s*(.+)$/);
		if (!match) continue;

		var owner = match[1].trim();
		var players = match[2].split(',');
		for (var j = 0; j < players.length; j++) {
			var playerStr = players[j].trim();
			var isRfa = playerStr.includes('(RFA)');
			var playerName = playerStr.replace(/\s*\(RFA\)\s*/g, '').trim();
			protections[playerName.toLowerCase()] = { owner: owner, isRfa: isRfa };
		}
	}

	return protections;
}

// =============================================================================
// Player registry
// =============================================================================

/**
 * Build a unified player registry from all data sources.
 * Each player has: { sleeperId, name, positions }
 */
function buildPlayerRegistry(auctions, contracts, draftsMap, faData, rfaData) {
	var players = {};

	function ensurePlayer(key, sleeperId, name, positions) {
		if (!players[key]) {
			players[key] = {
				sleeperId: sleeperId,
				name: name,
				positions: positions ? positions.slice() : []
			};
		} else {
			(positions || []).forEach(function(pos) {
				if (pos && players[key].positions.indexOf(pos) < 0) {
					players[key].positions.push(pos);
				}
			});
		}
	}

	// From auctions
	auctions.forEach(function(a) {
		var key = playerKey(a.sleeperId, a.name);
		ensurePlayer(key, a.sleeperId || null, a.name, a.positions);
	});

	// From contracts
	contracts.forEach(function(c) {
		var key = playerKey(c.sleeperId, c.name);
		ensurePlayer(key, c.sleeperId || null, c.name, c.positions);
	});

	// From drafts
	Object.keys(draftsMap).forEach(function(k) {
		var d = draftsMap[k];
		var key = playerKey(d.sleeperId, d.name);
		ensurePlayer(key, d.sleeperId || null, d.name, []);
	});

	// From FA records (adds only — players that only appear in FA)
	faData.forEach(function(r) {
		r.adds.forEach(function(add) {
			var key = playerKey(add.sleeperId, add.name);
			var positions = add.position ? add.position.split('/') : [];
			ensurePlayer(key, add.sleeperId || null, add.name, positions);
		});
	});

	// From RFA records
	rfaData.forEach(function(r) {
		if (r.type === 'rfa-unknown') return;
		var key = playerKey(r.sleeperId, r.playerName);
		var positions = r.position ? r.position.split('/') : [];
		ensurePlayer(key, r.sleeperId || null, r.playerName, positions);
	});

	return players;
}

// =============================================================================
// Event generation
// =============================================================================

function generatePlayerEvents(key, player, auctionRecords, contractRecords, draftsMap, tradesMap, faRecords, rfaRecords, expansionSelections, expansionProtections, auctionDates, draftDates) {
	var events = [];

	// --- Draft events ---
	var draft = draftsMap[key];
	if (!draft && player.sleeperId) draft = draftsMap[player.sleeperId];
	if (!draft) draft = draftsMap['name:' + player.name.toLowerCase()];

	if (draft) {
		var auctionDate = auctionDates[draft.season] || new Date(Date.UTC(draft.season, 7, 20, 16, 0, 0));
		var draftDate = draftDates[draft.season] || new Date(auctionDate.getTime() - 3 * 60 * 60 * 1000);
		events.push({
			timestamp: draftDate,
			type: 'draft',
			line: '  ' + yy(draft.season) + ' draft ' + draft.owner + ' ' + draft.round + '.' + String(draft.pickInRound).padStart(2, '0')
		});
	}

	// --- Auction events ---
	auctionRecords.forEach(function(a) {
		var aDate = auctionDates[a.season] || new Date(Date.UTC(a.season, 7, 20, 16, 0, 0));
		var auctionType = a.type || 'auction-ufa';

		events.push({
			timestamp: aDate,
			type: auctionType,
			line: '  ' + yy(a.season) + ' ' + auctionType + ' ' + a.originalOwner + ' $' + a.salary
		});
	});

	// --- Contract events ---
	contractRecords.forEach(function(c) {
		var owner = rosterIdToOwner(c.rosterId, c.season);

		// Timestamp: contracts are signed after the auction/draft.
		// For draft contracts, place just after draft. For auction contracts, just after auction.
		var isDraftContract = draft && draft.season === c.season && c.startYear === draft.season;
		var ts;
		if (isDraftContract) {
			var aDate = auctionDates[c.season] || new Date(Date.UTC(c.season, 7, 20, 16, 0, 0));
			var dDate = draftDates[c.season] || new Date(aDate.getTime() - 3 * 60 * 60 * 1000);
			ts = new Date(dDate.getTime() + 1);
		} else {
			var aDate = auctionDates[c.season] || new Date(Date.UTC(c.season, 7, 20, 16, 0, 0));
			ts = new Date(aDate.getTime() + 1);
		}

		events.push({
			timestamp: ts,
			type: 'contract',
			line: '  ' + yy(c.season) + ' contract $' + c.salary + ' ' + yy(c.startYear) + '/' + yy(c.endYear)
		});
	});

	// --- Trade events ---
	var playerTrades = [];
	if (player.sleeperId) {
		playerTrades = tradesMap[player.sleeperId] || [];
	}
	if (playerTrades.length === 0) {
		var nameTrades = tradesMap['name:' + player.name.toLowerCase()] || [];
		if (player.sleeperId) {
			// Player has sleeperId but no trades found by ID — skip name fallback
		} else {
			playerTrades = nameTrades.filter(function(t) { return t.sleeperId === null; });
		}
	}

	playerTrades.forEach(function(trade) {
		var tradeTimestamp = new Date(trade.date);

		// For unsigned trades of drafted players, force ordering after draft
		if (trade.contractStr === 'unsigned' && draft && new Date(trade.date).getUTCFullYear() === draft.season) {
			var aDate = auctionDates[draft.season] || new Date(Date.UTC(draft.season, 7, 20, 16, 0, 0));
			var dDate = draftDates[draft.season] || new Date(aDate.getTime() - 3 * 60 * 60 * 1000);
			tradeTimestamp = new Date(dDate.getTime() + 2);
		}

		events.push({
			timestamp: tradeTimestamp,
			type: 'trade',
			line: '  ' + yy(new Date(trade.date).getUTCFullYear()) + ' trade ' + trade.tradeId + ' -> ' + trade.toOwner
		});
	});

	// --- FA events ---
	faRecords.forEach(function(r) {
		var owner = rosterIdToOwner(r.rosterId, r.season);
		var ts = new Date(r.timestamp);

		r.adds.forEach(function(add) {
			events.push({
				timestamp: ts,
				type: 'fa',
				line: '  ' + yy(r.season) + ' fa ' + owner + ' $' + add.salary + ' ' + yy(add.startYear) + '/' + yy(add.endYear) + (r.inferred ? ' # inferred' : '')
			});
		});

		r.drops.forEach(function(drop) {
			var isOffseason = r.source === 'offseason';
			events.push({
				timestamp: ts,
				type: isOffseason ? 'cut' : 'drop',
				line: '  ' + yy(r.season) + (isOffseason ? ' cut' : ' drop') + ' # by ' + owner
			});
		});
	});

	// --- RFA / contract expiry events ---
	// Build set of auction seasons for lapsed detection
	var auctionSeasons = {};
	auctionRecords.forEach(function(a) {
		auctionSeasons[a.season] = true;
	});

	rfaRecords.forEach(function(r) {
		var owner = rosterIdToOwner(r.rosterId, r.season);
		var ts = new Date(r.timestamp);

		if (r.type === 'rfa-rights-conversion') {
			events.push({
				timestamp: ts,
				type: 'rfa',
				line: '  ' + yy(r.season) + ' rfa ' + owner
			});

			// If no auction in the following season, rights lapsed
			var nextSeason = r.season + 1;
			if (!auctionSeasons[nextSeason]) {
				// Convention: Sept 1 at noon ET (after auction, before regular season)
				var lapsedTs = new Date(Date.UTC(nextSeason, 8, 1, 16, 0, 0));
				events.push({
					timestamp: lapsedTs,
					type: 'rfa-lapsed',
					line: '  ' + yy(nextSeason) + ' rfa-lapsed # by ' + owner
				});
			}
		} else if (r.type === 'contract-expiry') {
			events.push({
				timestamp: ts,
				type: 'expiry',
				line: '  ' + yy(r.season) + ' expiry # by ' + owner
			});
		}
	});

	// --- Expansion draft (2012) ---
	var expansionPick = expansionSelections[player.name.toLowerCase()];
	if (expansionPick) {
		events.push({
			timestamp: new Date(Date.UTC(2012, 7, 25, 11, 0, 0)),
			type: 'expansion',
			line: '  12 expansion ' + expansionPick.toOwner + ' from ' + expansionPick.fromOwner
		});
	}

	// --- Expansion protection (2012) ---
	var protection = expansionProtections[player.name.toLowerCase()];
	if (protection) {
		events.push({
			timestamp: new Date(Date.UTC(2012, 7, 25, 10, 0, 0)),
			type: 'protect',
			line: '  12 protect ' + protection.owner + (protection.isRfa ? ' (RFA)' : '')
		});
	}

	// --- Sort all events by timestamp ---
	events.sort(function(a, b) {
		var diff = a.timestamp - b.timestamp;
		if (diff !== 0) return diff;

		// Tie-breaking: draft < protect < expansion < auction types < contract < rfa-lapsed < fa < trade < drop < cut < rfa < expiry
		var order = {
			draft: 0, protect: 1, expansion: 2,
			'auction-ufa': 3, 'auction-rfa-matched': 3, 'auction-rfa-unmatched': 3,
			contract: 4, 'rfa-lapsed': 5, fa: 6, trade: 7, drop: 8, cut: 9, rfa: 10, expiry: 11
		};
		return (order[a.type] || 99) - (order[b.type] || 99);
	});

	return events;
}

// =============================================================================
// Main
// =============================================================================

function generateDSL() {
	console.log('Loading data...');

	var auctions = loadAuctions();
	console.log('  Auctions: ' + auctions.length);

	var contracts = loadContracts();
	console.log('  Contracts: ' + contracts.length);

	var draftsMap = loadDrafts();
	console.log('  Drafts: ' + Object.keys(draftsMap).length + ' picks');

	var tradesMap = loadTrades();
	console.log('  Trades: ' + Object.keys(tradesMap).length + ' player entries');

	var faData = loadFA();
	console.log('  FA records: ' + faData.length);

	var rfaData = loadRFA();
	console.log('  RFA records: ' + rfaData.length);

	var auctionDates = leagueDates.getAllAuctionDates();
	console.log('  Auction dates: ' + Object.keys(auctionDates).length + ' years');

	var draftDates = leagueDates.getAllDraftDates();
	console.log('  Draft dates: ' + Object.keys(draftDates).length + ' years');

	var expansionSelections = loadExpansionSelections();
	console.log('  Expansion selections: ' + Object.keys(expansionSelections).length);

	var expansionProtections = loadExpansionProtections();
	console.log('  Expansion protections: ' + Object.keys(expansionProtections).length);

	console.log('\nBuilding player registry...');
	var players = buildPlayerRegistry(auctions, contracts, draftsMap, faData, rfaData);
	var playerKeys = Object.keys(players);
	console.log('  ' + playerKeys.length + ' players');

	// --- Index auctions by player ---
	var auctionsByPlayer = {};
	auctions.forEach(function(a) {
		var key = playerKey(a.sleeperId, a.name);
		if (!auctionsByPlayer[key]) auctionsByPlayer[key] = [];
		auctionsByPlayer[key].push(a);
	});

	// --- Index contracts by player ---
	var contractsByPlayer = {};
	contracts.forEach(function(c) {
		var key = playerKey(c.sleeperId, c.name);
		if (!contractsByPlayer[key]) contractsByPlayer[key] = [];
		contractsByPlayer[key].push(c);
	});

	// --- Index FA records by player ---
	var faByPlayer = {};
	faData.forEach(function(r) {
		r.adds.forEach(function(add) {
			var key = playerKey(add.sleeperId, add.name);
			if (!faByPlayer[key]) faByPlayer[key] = [];
			faByPlayer[key].push(r);
		});
		r.drops.forEach(function(drop) {
			var key = playerKey(drop.sleeperId, drop.name);
			if (!faByPlayer[key]) faByPlayer[key] = [];
			faByPlayer[key].push(r);
		});
	});

	// Deduplicate FA records per player
	Object.keys(faByPlayer).forEach(function(key) {
		var seen = new Set();
		faByPlayer[key] = faByPlayer[key].filter(function(r) {
			var id = r.timestamp + '|' + r.rosterId + '|' + r.source;
			if (seen.has(id)) return false;
			seen.add(id);
			return true;
		});
	});

	// --- Index RFA records by player ---
	var rfaByPlayer = {};
	rfaData.forEach(function(r) {
		if (r.type === 'rfa-unknown') return;
		var key = playerKey(r.sleeperId, r.playerName);
		if (!rfaByPlayer[key]) rfaByPlayer[key] = [];
		rfaByPlayer[key].push(r);
	});

	console.log('\nGenerating events...');

	var playerEntries = [];

	playerKeys.forEach(function(key) {
		var player = players[key];

		// Build header
		var headerParts = [player.name, player.positions.join('/') || '??'];
		if (player.sleeperId && player.sleeperId !== '-1') {
			headerParts.push('sleeper:' + player.sleeperId);
		} else {
			headerParts.push('historical');
		}
		var header = headerParts.join(' | ');

		// Look up per-player data
		var playerAuctions = auctionsByPlayer[key] || [];
		var playerContracts = contractsByPlayer[key] || [];

		var playerFA = faByPlayer[key] || [];
		// Filter FA records to only include adds/drops for THIS player
		var filteredFA = [];
		playerFA.forEach(function(r) {
			var relevantAdds = r.adds.filter(function(a) {
				if (player.sleeperId && player.sleeperId !== '-1' && a.sleeperId && a.sleeperId !== '-1') return a.sleeperId === player.sleeperId;
				return a.name.toLowerCase() === player.name.toLowerCase();
			});
			var relevantDrops = r.drops.filter(function(d) {
				if (player.sleeperId && player.sleeperId !== '-1' && d.sleeperId && d.sleeperId !== '-1') return d.sleeperId === player.sleeperId;
				return d.name.toLowerCase() === player.name.toLowerCase();
			});

			if (relevantAdds.length > 0 || relevantDrops.length > 0) {
				filteredFA.push({
					season: r.season,
					timestamp: r.timestamp,
					rosterId: r.rosterId,
					adds: relevantAdds,
					drops: relevantDrops,
					source: r.source,
					inferred: r.inferred
				});
			}
		});

		var playerRFA = rfaByPlayer[key] || [];
		if (!playerRFA.length && player.sleeperId) {
			playerRFA = rfaByPlayer[player.sleeperId] || [];
		}
		if (!playerRFA.length && !player.sleeperId) {
			playerRFA = rfaByPlayer['name:' + player.name.toLowerCase()] || [];
		}

		var events = generatePlayerEvents(key, player, playerAuctions, playerContracts, draftsMap, tradesMap, filteredFA, playerRFA, expansionSelections, expansionProtections, auctionDates, draftDates);

		if (events.length === 0) return;

		var entryLines = [header];
		events.forEach(function(e) {
			entryLines.push(e.line);
		});

		playerEntries.push({
			name: player.name,
			lines: entryLines
		});
	});

	// Sort alphabetically
	playerEntries.sort(function(a, b) {
		return a.name.localeCompare(b.name);
	});

	// Build output
	var lines = [];

	lines.push('# Player Transaction History DSL');
	lines.push('# ');
	lines.push('# Generated by: node data/dsl/generate.js');
	lines.push('# Generated at: ' + new Date().toISOString());
	lines.push('# ');
	lines.push('# GRAMMAR:');
	lines.push('#   Header: Name | Position(s) | sleeper:ID [| historical]');
	lines.push('#   Transaction: YY TYPE [ARGS...]');
	lines.push('#');
	lines.push('# TYPES:');
	lines.push('#   draft OWNER RD.PICK              - Rookie draft selection');
	lines.push('#   auction-ufa OWNER $SALARY       - UFA auction win');
	lines.push('#   auction-rfa-matched OWNER $SAL   - RFA matched by rights holder');
	lines.push('#   auction-rfa-unmatched OWNER $SAL  - RFA not matched, new owner wins');
	lines.push('#   contract $SALARY YY/YY           - Contract signed');
	lines.push('#   fa OWNER $SALARY YY/YY           - FA pickup');
	lines.push('#   trade NUMBER -> OWNER             - Trade');
	lines.push('#   drop                              - Dropped in-season (by OWNER in comment)');
	lines.push('#   cut                               - Released in offseason (by OWNER in comment)');
	lines.push('#   rfa OWNER                         - RFA rights conversion (contract expired)');
	lines.push('#   rfa-lapsed                        - RFA rights lapsed (not brought to auction, by OWNER in comment)');
	lines.push('#   expiry                            - Contract expired, player becomes UFA (by OWNER in comment)');
	lines.push('#   expansion OWNER from OWNER        - 2012 expansion draft');
	lines.push('#   protect OWNER                     - 2012 expansion protection');
	lines.push('#');
	lines.push('# CONVENTIONS:');
	lines.push('#   - YY = 2-digit year (08 = 2008)');
	lines.push('#   - YY/YY = startYear/endYear');
	lines.push('#   - FA/YY = free agent contract (null startYear)');
	lines.push('#   - Blank lines separate players');
	lines.push('#   - # starts a comment');
	lines.push('');
	lines.push('# =============================================================================');
	lines.push('');

	playerEntries.forEach(function(entry) {
		entry.lines.forEach(function(line) {
			lines.push(line);
		});
		lines.push('');
	});

	console.log('  ' + playerEntries.length + ' players with events');

	return lines.join('\n');
}

function run() {
	console.log('=== DSL Generator ===\n');

	var content = generateDSL();

	fs.writeFileSync(DSL_FILE, content);
	console.log('\nWrote ' + DSL_FILE);
}

run();
