#!/usr/bin/env node
/**
 * DSL Generator
 * 
 * Generates player-history.dsl from pre-computed event sources:
 *   - fa.json (FA adds and drops — explicit and inferred)
 *   - drafts.json (rookie draft selections)
 *   - trades.json (trades)
 *   - contracts-YYYY.txt snapshots (auction/contract events)
 *   - expansion-draft-2012.txt (one-time expansion draft)
 * 
 * Usage:
 *   node data/dsl/generate.js
 */

var fs = require('fs');
var path = require('path');

var DSL_FILE = path.join(__dirname, 'player-history.dsl');
var SNAPSHOTS_DIR = path.join(__dirname, '../archive/snapshots');
var TRADES_FILE = path.join(__dirname, '../trades/trades.json');
var DRAFTS_FILE = path.join(__dirname, '../drafts/drafts.json');
var FA_FILE = path.join(__dirname, '../fa/fa.json');
var SUMMER_MEETINGS_FILE = path.join(__dirname, '../../doc/summer-meetings.txt');
var EXPANSION_DRAFT_FILE = path.join(__dirname, '../archive/sources/txt/expansion-draft-2012.txt');
var EXPANSION_PROTECTIONS_FILE = path.join(__dirname, '../archive/sources/txt/expansion-draft-protections-2012.txt');

var PSO = require('../../config/pso.js');

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

function loadAuctionDates() {
	var content = fs.readFileSync(SUMMER_MEETINGS_FILE, 'utf8');
	var dates = {};
	var lines = content.split('\n');
	var inAuctionSection = false;
	for (var i = 0; i < lines.length; i++) {
		// Start parsing after the header
		if (lines[i].match(/Summer Meeting/i)) { inAuctionSection = true; continue; }
		// Stop at the next section
		if (inAuctionSection && lines[i].match(/^[A-Z]/) && !lines[i].match(/^=/) && !lines[i].match(/^\d/)) break;

		if (!inAuctionSection) continue;

		var match = lines[i].match(/^(\d{4}):\s+(\w+)\s+(\d+)/);
		if (match) {
			var year = parseInt(match[1]);
			var month = match[2];
			var day = parseInt(match[3]);
			var monthNum = ['January','February','March','April','May','June',
				'July','August','September','October','November','December'].indexOf(month);
			if (monthNum >= 0) {
				// Noon ET (EDT in August = UTC-4, so 16:00 UTC)
			dates[year] = new Date(Date.UTC(year, monthNum, day, 16, 0, 0));
			}
		}
	}
	return dates;
}

// =============================================================================
// Data loaders
// =============================================================================

function loadDrafts() {
	var drafts = JSON.parse(fs.readFileSync(DRAFTS_FILE, 'utf8'));
	var byPlayer = {}; // keyed by sleeperId or lowercase name

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
	var byPlayer = {}; // keyed by sleeperId or lowercase name -> array of trade entries

	trades.forEach(function(trade) {
		trade.parties.forEach(function(party, partyIndex) {
			(party.players || []).forEach(function(player) {
				var entry = {
					tradeId: trade.tradeId,
					date: trade.date,
					toOwner: party.owner,
					sleeperId: player.sleeperId || null,
					contractStr: player.contractStr || null,
					fromOwner: null
				};

				// For unsigned players in 2-party trades, track the sender
				if ((player.contractStr === 'unsigned' || (player.contract && player.contract.start === null)) &&
					trade.parties.length === 2) {
					entry.fromOwner = trade.parties[1 - partyIndex].owner;
				}

				// Index by sleeperId
				if (player.sleeperId) {
					if (!byPlayer[player.sleeperId]) byPlayer[player.sleeperId] = [];
					byPlayer[player.sleeperId].push(entry);
				}

				// Also index by name
				if (player.name) {
					var nameKey = 'name:' + player.name.toLowerCase();
					if (!byPlayer[nameKey]) byPlayer[nameKey] = [];
					byPlayer[nameKey].push(entry);
				}
			});
		});
	});

	// Sort each array by date
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

/**
 * Parse contract snapshots to build a player registry and detect auction/contract events.
 * Returns: { playerKey: { sleeperId, name, positions, contracts: [{year, owner, salary, startYear, endYear}] } }
 */
function parseSnapshots() {
	var files = fs.readdirSync(SNAPSHOTS_DIR).filter(function(f) {
		return f.match(/^contracts-\d{4}\.txt$/);
	}).sort();

	var players = {};

	files.forEach(function(file) {
		var year = parseInt(file.match(/-(\d{4})\.txt/)[1]);
		var content = fs.readFileSync(path.join(SNAPSHOTS_DIR, file), 'utf8');
		var lines = content.trim().split('\n');

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

			if (!id || id === '') continue;

			var baseName = name.replace(/\s*\([^)]+\)\s*$/, '').trim();
			var playerKey, sleeperId = null;
			if (id !== '-1') {
				playerKey = id;
				sleeperId = id;
			} else {
				playerKey = 'historical:' + baseName.toLowerCase();
			}

			var positionList = position ? position.split('/') : [];

			var contract = {
				year: year,
				owner: owner,
				salary: salary,
				startYear: startYear,
				endYear: endYear
			};

			if (!players[playerKey]) {
				players[playerKey] = {
					sleeperId: sleeperId,
					name: baseName,
					positions: positionList.slice(),
					contracts: [contract]
				};
			} else {
				players[playerKey].contracts.push(contract);
				positionList.forEach(function(pos) {
					if (pos && players[playerKey].positions.indexOf(pos) < 0) {
						players[playerKey].positions.push(pos);
					}
				});
			}
		}
	});

	// Sort contracts by year
	Object.keys(players).forEach(function(key) {
		players[key].contracts.sort(function(a, b) { return a.year - b.year; });
	});

	return players;
}

// =============================================================================
// Event generation
// =============================================================================

/**
 * Check if two owner names refer to the same franchise in a given year.
 */
function sameRegime(owner1, owner2, year) {
	if (!owner1 || !owner2) return false;
	if (owner1.toLowerCase() === owner2.toLowerCase()) return true;

	// Partial match (Koci vs Koci/Mueller)
	if (owner1.toLowerCase().indexOf(owner2.toLowerCase()) >= 0 ||
		owner2.toLowerCase().indexOf(owner1.toLowerCase()) >= 0) {
		return true;
	}

	// Check franchise IDs — if both resolve to the same franchise ID, same regime
	var id1 = null, id2 = null;
	var rosterIds = Object.keys(PSO.franchiseNames);
	for (var i = 0; i < rosterIds.length; i++) {
		var rid = parseInt(rosterIds[i]);
		var name = PSO.franchiseNames[rid][year];
		if (!name) continue;
		if (name.toLowerCase() === owner1.toLowerCase() ||
			owner1.toLowerCase().indexOf(name.toLowerCase()) >= 0 ||
			name.toLowerCase().indexOf(owner1.toLowerCase()) >= 0) {
			id1 = rid;
		}
		if (name.toLowerCase() === owner2.toLowerCase() ||
			owner2.toLowerCase().indexOf(name.toLowerCase()) >= 0 ||
			name.toLowerCase().indexOf(owner2.toLowerCase()) >= 0) {
			id2 = rid;
		}
	}
	return id1 !== null && id2 !== null && id1 === id2;
}

/**
 * Generate events for a single player.
 * Merges data from all sources into a single timestamped event list.
 */
function generatePlayerEvents(player, playerKey, draftsMap, tradesMap, faRecords, expansionSelections, expansionProtections, auctionDates) {
	var events = [];

	// --- Draft events ---
	var draft = draftsMap[playerKey];
	if (!draft && player.sleeperId) draft = draftsMap[player.sleeperId];
	if (!draft) draft = draftsMap['name:' + player.name.toLowerCase()];

	if (draft) {
		var auctionDate = auctionDates[draft.season] || new Date(Date.UTC(draft.season, 7, 20, 16, 0, 0));
		// Rookie draft is 3 hours before auction (9am ET vs noon ET)
		var draftDate = new Date(auctionDate.getTime() - 3 * 60 * 60 * 1000);
		events.push({
			timestamp: draftDate,
			type: 'draft',
			line: '  ' + yy(draft.season) + ' draft ' + draft.owner + ' ' + draft.round + '.' + String(draft.pickInRound).padStart(2, '0')
		});

		// Add contract line for drafted player (from snapshot data)
		var draftContract = (player.contracts || []).find(function(c) {
			return c.startYear === draft.season;
		});
		if (draftContract) {
			events.push({
				timestamp: new Date(draftDate.getTime() + 1),
				type: 'contract',
				line: '  ' + yy(draft.season) + ' contract $' + draftContract.salary + ' ' + yy(draftContract.startYear) + '/' + yy(draftContract.endYear)
			});
		}
	}

	// --- Trade events ---
	var playerTrades = [];
	if (player.sleeperId) {
		playerTrades = tradesMap[player.sleeperId] || [];
	}
	if (playerTrades.length === 0) {
		var nameTrades = tradesMap['name:' + player.name.toLowerCase()] || [];
		// For name-based matching, only use trades without a sleeperId (historical players)
		if (player.sleeperId) {
			// Player has sleeperId but no trades found by ID — skip name fallback to avoid false matches
		} else {
			playerTrades = nameTrades.filter(function(t) { return t.sleeperId === null; });
		}
	}

	playerTrades.forEach(function(trade) {
		var tradeTimestamp = new Date(trade.date);

		// For unsigned trades of drafted players, the trade was agreed to
		// before the draft but logically executes after it. Force ordering.
		if (trade.contractStr === 'unsigned' && draft && new Date(trade.date).getUTCFullYear() === draft.season) {
			var aDate = auctionDates[draft.season] || new Date(Date.UTC(draft.season, 7, 20, 16, 0, 0));
			var dDate = new Date(aDate.getTime() - 3 * 60 * 60 * 1000);
			tradeTimestamp = new Date(dDate.getTime() + 2);
		}

		events.push({
			timestamp: tradeTimestamp,
			type: 'trade',
			line: '  ' + yy(new Date(trade.date).getUTCFullYear()) + ' trade ' + trade.tradeId + ' -> ' + trade.toOwner
		});
	});

	// --- Auction/contract events from snapshots ---
	var contracts = player.contracts || [];
	var prevContract = null;

	for (var i = 0; i < contracts.length; i++) {
		var c = contracts[i];

		if (c.startYear === null) {
			// FA contract — the add is handled by fa.json events below
			prevContract = c;
			continue;
		}

		var isNewContract = !prevContract ||
			c.startYear !== prevContract.startYear ||
			c.endYear !== prevContract.endYear;

		// Skip auction if player was drafted this year (draft IS the acquisition)
		var wasDraftedThisYear = draft && draft.season === c.startYear;

		if (isNewContract && c.startYear !== null && !wasDraftedThisYear) {
			var auctionDate = auctionDates[c.startYear] || new Date(Date.UTC(c.startYear, 7, 20, 16, 0, 0));

			// Check if player was traded unsigned in this year
			// (auction won by sender, then traded before signing)
			var auctionOwner = c.owner;
			var unsignedTrade = null;

			for (var j = 0; j < playerTrades.length; j++) {
				var t = playerTrades[j];
				var tradeDate = new Date(t.date);
				var tradeYear = tradeDate.getUTCFullYear();

				if (tradeYear === c.startYear &&
					t.contractStr === 'unsigned' &&
					sameRegime(t.toOwner, c.owner, c.startYear)) {
					unsignedTrade = t;
					break;
				}
			}

			if (unsignedTrade && unsignedTrade.fromOwner) {
				auctionOwner = unsignedTrade.fromOwner;
			}

			events.push({
				timestamp: auctionDate,
				type: 'auction',
				line: '  ' + yy(c.startYear) + ' auction ' + auctionOwner + ' $' + c.salary
			});

			// Contract timestamp: after the trade if unsigned, otherwise right after auction
			var contractTimestamp = unsignedTrade
				? new Date(new Date(unsignedTrade.date).getTime() + 1)
				: new Date(auctionDate.getTime() + 1);

			events.push({
				timestamp: contractTimestamp,
				type: 'contract',
				line: '  ' + yy(c.startYear) + ' contract $' + c.salary + ' ' + yy(c.startYear) + '/' + yy(c.endYear)
			});
		}

		prevContract = c;
	}

	// --- FA events from fa.json ---
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
			events.push({
				timestamp: ts,
				type: 'cut',
				line: '  ' + yy(r.season) + ' cut # by ' + owner
			});
		});
	});

	// --- Expansion draft (2012) ---
	var expansionPick = expansionSelections[player.name.toLowerCase()];
	if (expansionPick) {
		events.push({
			timestamp: new Date(Date.UTC(2012, 7, 25, 11, 0, 0)), // just before auction
			type: 'expansion',
			line: '  12 expansion ' + expansionPick.toOwner + ' from ' + expansionPick.fromOwner
		});
	}

	// --- Expansion protection (2012) ---
	var protection = expansionProtections[player.name.toLowerCase()];
	if (protection) {
		events.push({
			timestamp: new Date(Date.UTC(2012, 7, 25, 10, 0, 0)), // before expansion picks
			type: 'protect',
			line: '  12 protect ' + protection.owner + (protection.isRfa ? ' (RFA)' : '')
		});
	}

	// --- Sort all events by timestamp ---
	events.sort(function(a, b) {
		var diff = a.timestamp - b.timestamp;
		if (diff !== 0) return diff;

		// Tie-breaking: draft < protect < expansion < auction < contract < fa < trade < cut
		var order = { draft: 0, protect: 1, expansion: 2, auction: 3, contract: 4, fa: 5, trade: 6, cut: 7 };
		return (order[a.type] || 99) - (order[b.type] || 99);
	});

	return events;
}

// =============================================================================
// Main
// =============================================================================

function generateDSL() {
	console.log('Loading data...');

	var draftsMap = loadDrafts();
	console.log('  Drafts: ' + Object.keys(draftsMap).length + ' picks');

	var tradesMap = loadTrades();
	var tradePlayerCount = Object.keys(tradesMap).length;
	console.log('  Trades: ' + tradePlayerCount + ' player entries');

	var faData = loadFA();
	console.log('  FA records: ' + faData.length);

	var auctionDates = loadAuctionDates();
	console.log('  Auction dates: ' + Object.keys(auctionDates).length + ' years');

	var expansionSelections = loadExpansionSelections();
	console.log('  Expansion selections: ' + Object.keys(expansionSelections).length);

	var expansionProtections = loadExpansionProtections();
	console.log('  Expansion protections: ' + Object.keys(expansionProtections).length);

	console.log('\nParsing snapshots...');
	var players = parseSnapshots();
	var playerKeys = Object.keys(players);
	console.log('  ' + playerKeys.length + ' players from snapshots');

	// Index FA records by player (sleeperId or name)
	var faByPlayer = {};

	faData.forEach(function(r) {
		r.adds.forEach(function(add) {
			var key = (add.sleeperId && add.sleeperId !== '-1') ? add.sleeperId : ('name:' + add.name.toLowerCase());
			if (!faByPlayer[key]) faByPlayer[key] = [];
			faByPlayer[key].push(r);
		});
		r.drops.forEach(function(drop) {
			var key = (drop.sleeperId && drop.sleeperId !== '-1') ? drop.sleeperId : ('name:' + drop.name.toLowerCase());
			if (!faByPlayer[key]) faByPlayer[key] = [];
			faByPlayer[key].push(r);
		});
	});

	// Deduplicate FA records per player (same record can appear from both add and drop indexing)
	Object.keys(faByPlayer).forEach(function(key) {
		var seen = new Set();
		faByPlayer[key] = faByPlayer[key].filter(function(r) {
			var id = r.timestamp + '|' + r.rosterId + '|' + r.source;
			if (seen.has(id)) return false;
			seen.add(id);
			return true;
		});
	});

	// Build a reverse index: lowercase name -> [playerKey, ...] for existing snapshot players
	var nameToPlayerKeys = {};
	playerKeys.forEach(function(pk) {
		var lname = players[pk].name.toLowerCase();
		if (!nameToPlayerKeys[lname]) nameToPlayerKeys[lname] = [];
		nameToPlayerKeys[lname].push(pk);
	});

	// Ensure we also have entries for players that only appear in fa.json (never in snapshots)
	Object.keys(faByPlayer).forEach(function(key) {
		if (players[key]) return; // already in snapshots

		// For name:-prefixed keys, try to merge into an existing snapshot player
		if (key.indexOf('name:') === 0) {
			var nameFromKey = key.substring(5);

			// Check historical: variant first (for sleeperId=-1 players)
			var historicalKey = 'historical:' + nameFromKey;
			if (players[historicalKey]) {
				if (!faByPlayer[historicalKey]) faByPlayer[historicalKey] = [];
				faByPlayer[historicalKey] = faByPlayer[historicalKey].concat(faByPlayer[key]);
				return;
			}

			// Check if exactly one snapshot player has this name (safe to merge)
			var candidates = nameToPlayerKeys[nameFromKey];
			if (candidates && candidates.length === 1) {
				var existingKey = candidates[0];
				if (!faByPlayer[existingKey]) faByPlayer[existingKey] = [];
				faByPlayer[existingKey] = faByPlayer[existingKey].concat(faByPlayer[key]);
				return;
			}
			// If multiple candidates (name collision), fall through to create a separate entry
		}

		// Find the actual player matching THIS key from the FA records
		// (multi-player records may contain other players as drops[0])
		var records = faByPlayer[key];
		var matchingPlayer = null;
		var nameFromKey = key.indexOf('name:') === 0 ? key.substring(5) : null;

		for (var i = 0; i < records.length && !matchingPlayer; i++) {
			var r = records[i];
			var allPlayers = r.adds.concat(r.drops);
			for (var j = 0; j < allPlayers.length; j++) {
				var p = allPlayers[j];
				if (nameFromKey && p.name && p.name.toLowerCase() === nameFromKey) {
					matchingPlayer = p;
					break;
				} else if (!nameFromKey && p.sleeperId === key) {
					matchingPlayer = p;
					break;
				}
			}
		}

		if (!matchingPlayer) return;

		var sleeperId = matchingPlayer.sleeperId || null;
		var playerKey = sleeperId || key;
		if (players[playerKey]) return; // already exists under different key

		players[playerKey] = {
			sleeperId: sleeperId,
			name: matchingPlayer.name,
			positions: matchingPlayer.position ? [matchingPlayer.position] : [],
			contracts: []
		};

		// Re-map FA records to the canonical key
		if (playerKey !== key) {
			if (!faByPlayer[playerKey]) faByPlayer[playerKey] = [];
			faByPlayer[playerKey] = faByPlayer[playerKey].concat(records);
		}
	});

	// Regenerate keys after adding FA-only players
	playerKeys = Object.keys(players);

	console.log('  ' + playerKeys.length + ' total players (including FA-only)\n');

	console.log('Generating events...');

	// Generate DSL lines
	var playerEntries = [];

	playerKeys.forEach(function(key) {
		var player = players[key];

		// Build header
		var headerParts = [player.name, player.positions.join('/') || '??'];
		if (player.sleeperId) {
			headerParts.push('sleeper:' + player.sleeperId);
		} else {
			headerParts.push('historical');
		}
		var header = headerParts.join(' | ');

		// Get FA records for this player (try multiple key formats)
		var playerFA = faByPlayer[key] || [];
		if (!playerFA.length && player.sleeperId) {
			playerFA = faByPlayer[player.sleeperId] || [];
		}
		if (!playerFA.length) {
			playerFA = faByPlayer['name:' + player.name.toLowerCase()] || [];
		}

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

		var events = generatePlayerEvents(player, key, draftsMap, tradesMap, filteredFA, expansionSelections, expansionProtections, auctionDates);

		if (events.length === 0) return; // skip players with no events

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
	lines.push('#   auction OWNER $SALARY            - Summer auction win');
	lines.push('#   contract $SALARY YY/YY           - Contract signed');
	lines.push('#   fa OWNER $SALARY YY/YY           - FA pickup');
	lines.push('#   trade NUMBER -> OWNER             - Trade');
	lines.push('#   cut                               - Released (by OWNER in comment)');
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
