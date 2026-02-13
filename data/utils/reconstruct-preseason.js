#!/usr/bin/env node
/**
 * Reconstruct a preseason contracts snapshot by starting from the
 * postseason snapshot and unrolling trades and FA transactions backwards.
 *
 * Usage:
 *   node data/utils/reconstruct-preseason.js --year=2014
 *   node data/utils/reconstruct-preseason.js --year=2014 --write
 */

var fs = require('fs');
var path = require('path');
var PSO = require('../../config/pso.js');
var leagueDates = require('../../config/dates.js');
var resolver = require('./player-resolver');

var SNAPSHOTS_DIR = path.join(__dirname, '../archive/snapshots');
var TRADES_FILE = path.join(__dirname, '../trades/trades.json');
var FA_FILE = path.join(__dirname, '../fa/fa.json');

function parseArgs() {
	var args = { year: null, write: process.argv.includes('--write') };
	var yearArg = process.argv.find(function(a) { return a.startsWith('--year='); });
	if (yearArg) args.year = parseInt(yearArg.split('=')[1], 10);
	return args;
}

function parseSnapshot(filePath, season) {
	if (!fs.existsSync(filePath)) { console.error('File not found: ' + filePath); process.exit(1); }
	var lines = fs.readFileSync(filePath, 'utf8').trim().split('\n');
	var players = [];
	for (var i = 1; i < lines.length; i++) {
		var parts = lines[i].split(',');
		if (parts.length < 6) continue;
		var salaryStr = (parts[6] || '').replace(/[$,]/g, '');
		players.push({
			id: parts[0],
			owner: (parts[1] || '').trim(),
			name: parts[2],
			position: parts[3],
			startYear: parts[4] === 'FA' ? null : parseInt(parts[4]),
			endYear: parseInt(parts[5]),
			salary: salaryStr ? parseInt(salaryStr) : 1
		});
	}
	return players;
}

function ownerToRosterId(ownerName, season) {
	if (!ownerName) return null;
	var lowerOwner = ownerName.toLowerCase();
	var rosterIds = Object.keys(PSO.franchiseNames);
	for (var i = 0; i < rosterIds.length; i++) {
		var rid = parseInt(rosterIds[i]);
		var name = PSO.franchiseNames[rid][season];
		if (name && name.toLowerCase() === lowerOwner) return rid;
	}
	return null;
}

function rosterIdToOwner(rosterId, season) {
	return PSO.franchiseNames[rosterId] ? PSO.franchiseNames[rosterId][season] : null;
}

function run() {
	var args = parseArgs();
	if (!args.year) { console.error('Usage: node reconstruct-preseason.js --year=YYYY'); process.exit(1); }
	var season = args.year;

	console.log('=== Reconstruct Preseason ' + season + ' ===\n');

	var cutoff = leagueDates.getContractDueDate(season) || leagueDates.getAuctionDate(season);
	console.log('Cutoff date: ' + (cutoff ? cutoff.toISOString() : 'none'));

	// Load postseason snapshot as starting state
	var postFile = path.join(SNAPSHOTS_DIR, 'postseason-' + season + '.txt');
	var roster = parseSnapshot(postFile, season);
	console.log('Postseason roster: ' + roster.length + ' players');

	// Find a player on the roster, preferring sleeper ID match over name match
	function findPlayer(roster, sleeperId, name) {
		// Prefer ID match
		if (sleeperId && sleeperId !== '-1') {
			for (var i = 0; i < roster.length; i++) {
				if (roster[i].id === sleeperId) return roster[i];
			}
		}
		// Fall back to name match (only if no ID provided)
		if (!sleeperId || sleeperId === '-1') {
			var key = resolver.normalizePlayerName(name);
			if (key) {
				for (var i = 0; i < roster.length; i++) {
					if (resolver.normalizePlayerName(roster[i].name) === key) return roster[i];
				}
			}
		}
		return null;
	}

	// Load trades after cutoff, sorted by date descending (newest first for unrolling)
	var allTrades = JSON.parse(fs.readFileSync(TRADES_FILE, 'utf8'));
	var seasonTrades = allTrades.filter(function(t) {
		return new Date(t.date).getFullYear() === season && (!cutoff || new Date(t.date) > cutoff);
	}).sort(function(a, b) { return new Date(b.date) - new Date(a.date); });
	console.log('Trades to unroll: ' + seasonTrades.length);

	// Load FA records after cutoff, sorted by timestamp descending
	var allFa = JSON.parse(fs.readFileSync(FA_FILE, 'utf8'));
	var seasonFa = allFa.filter(function(r) {
		if (r.season !== season || r.source === 'offseason') return false;
		return !cutoff || new Date(r.timestamp) > cutoff;
	}).sort(function(a, b) { return new Date(b.timestamp) - new Date(a.timestamp); });
	console.log('FA transactions to unroll: ' + seasonFa.length);

	// Merge trades and FA records into a single timeline, sorted newest first
	var events = [];
	seasonTrades.forEach(function(t) {
		events.push({ type: 'trade', timestamp: new Date(t.date), data: t });
	});
	seasonFa.forEach(function(r) {
		events.push({ type: 'fa', timestamp: new Date(r.timestamp), data: r });
	});
	events.sort(function(a, b) { return b.timestamp - a.timestamp; });

	console.log('\nUnrolling ' + events.length + ' events in reverse...\n');

	var stats = { tradesUnrolled: 0, dropsUndone: 0, addsRemoved: 0, skipped: 0 };

	events.forEach(function(event) {
		if (event.type === 'trade') {
			var trade = event.data;
			// Reverse each party's player movements
			// In the trade data, party.players are what that party RECEIVES.
			// To unroll: remove received players from that party, and figure out
			// who they came from (the other party).
			// For 2-party trades this is straightforward.
			// For multi-party, each player's source is the party that didn't receive them.

			// Build a flat list of movements: { player, toOwner, toRosterId }
			var movements = [];
			trade.parties.forEach(function(party) {
				(party.players || []).forEach(function(pl) {
					movements.push({
						name: pl.name,
						sleeperId: pl.sleeperId || null,
						toOwner: party.owner,
						toRosterId: party.rosterId,
						contract: pl.contract || null,
						salary: pl.salary
					});
				});
			});

			// For each movement, find where the player was BEFORE the trade.
			// In a 2-party trade, they came from the other party.
			// In multi-party, they came from whichever party didn't receive them.
			movements.forEach(function(mov) {
				var player = findPlayer(roster, mov.sleeperId, mov.name);

				if (!player) {
					// Player not on roster — might have been cut after the trade.
					// We need to add them back to their pre-trade owner.
					// For 2-party trades, the source is the other party.
					var sourceParty = null;
					if (trade.parties.length === 2) {
						sourceParty = trade.parties.find(function(p) { return p.owner !== mov.toOwner; });
					}
					if (sourceParty) {
						// Find the player's contract info from the preseason state of the source
						// We don't have great data here, so just note it
						console.log('  TRADE ' + trade.tradeId + ': ' + mov.name + ' not on roster (was traded to ' + mov.toOwner + ', came from ' + sourceParty.owner + ') — skipping, will be handled by cut unroll');
					} else {
						console.log('  TRADE ' + trade.tradeId + ': ' + mov.name + ' not on roster and multi-party — skipping');
					}
					stats.skipped++;
					return;
				}

				// Find source party
				var sourceParty = null;
				if (trade.parties.length === 2) {
					sourceParty = trade.parties.find(function(p) { return p.owner !== mov.toOwner; });
				} else {
					// Multi-party: source is any party that doesn't list this player as received
					for (var i = 0; i < trade.parties.length; i++) {
						var party = trade.parties[i];
						if (party.owner === mov.toOwner) continue;
						var hasPlayer = (party.players || []).some(function(pl) {
							return pl.name === mov.name || (pl.sleeperId && pl.sleeperId === mov.sleeperId);
						});
						if (!hasPlayer) {
							sourceParty = party;
							break;
						}
					}
				}

				if (!sourceParty) {
					console.log('  TRADE ' + trade.tradeId + ': Cannot determine source for ' + mov.name + ' — skipping');
					stats.skipped++;
					return;
				}

				// Move player back to source owner
				var oldOwner = player.owner;
				player.owner = sourceParty.owner;

				// Restore pre-trade contract if available
				// The source party's version of the player might have different contract terms
				// (the trade data shows what the RECEIVING party gets, which may include new terms)
				// We want the pre-trade contract. Check if there's contract info on the
				// other party's received players for context, but the simplest approach is:
				// the receiving party's contract IS the post-trade state, so we don't change it
				// unless we have explicit pre-trade info.

				console.log('  TRADE ' + trade.tradeId + ' (' + event.timestamp.toISOString().slice(0,10) + '): ' + mov.name + ': ' + oldOwner + ' -> ' + sourceParty.owner);
				stats.tradesUnrolled++;
			});

		} else if (event.type === 'fa') {
			var fa = event.data;

			// Undo drops: add player back to roster (or update if already there from trade unroll)
			(fa.drops || []).forEach(function(drop) {
				var dropRosterId = fa.rosterId;
				var dropOwner = rosterIdToOwner(dropRosterId, season);

				var existing = findPlayer(roster, drop.sleeperId, drop.name);
				if (existing) {
					// Player already on roster (e.g. trade unroll added them).
					// Update with the pre-cut contract info, which is more accurate.
					existing.owner = dropOwner || fa.owner || existing.owner;
					if (drop.startYear !== undefined) existing.startYear = drop.startYear;
					if (drop.endYear !== undefined) existing.endYear = drop.endYear;
					if (drop.salary !== undefined) existing.salary = drop.salary;
					if (drop.sleeperId) existing.id = drop.sleeperId;
					console.log('  DROP UNDO (' + event.timestamp.toISOString().slice(0,10) + '): ~' + drop.name + ' updated contract on ' + existing.owner);
					stats.dropsUndone++;
					return;
				}

				roster.push({
					id: drop.sleeperId || '-1',
					owner: dropOwner || fa.owner || '',
					name: drop.name,
					position: drop.position || '',
					startYear: drop.startYear || null,
					endYear: drop.endYear || season,
					salary: drop.salary || 1
				});
				console.log('  DROP UNDO (' + event.timestamp.toISOString().slice(0,10) + '): +' + drop.name + ' back to ' + (dropOwner || fa.owner));
				stats.dropsUndone++;
			});

			// Undo adds: remove player from roster
			(fa.adds || []).forEach(function(add) {
				var player = findPlayer(roster, add.sleeperId, add.name);
				if (player) {
					var idx = roster.indexOf(player);
					if (idx >= 0) {
						roster.splice(idx, 1);
						console.log('  ADD UNDO (' + event.timestamp.toISOString().slice(0,10) + '): -' + add.name + ' from ' + player.owner);
						stats.addsRemoved++;
					}
				}
			});
		}
	});

	// Remove any remaining unowned or FA-only players that were mid-season pickups
	// (players with no startYear / FA contracts that weren't there at start of season)

	console.log('\n=== Stats ===');
	console.log('Trades unrolled: ' + stats.tradesUnrolled);
	console.log('Drops undone: ' + stats.dropsUndone);
	console.log('Adds removed: ' + stats.addsRemoved);
	console.log('Skipped: ' + stats.skipped);
	console.log('Final roster size: ' + roster.length);

	// Count by owner
	var byOwner = {};
	roster.forEach(function(p) {
		if (p.owner) byOwner[p.owner] = (byOwner[p.owner] || 0) + 1;
	});
	console.log('\nBy owner:');
	Object.keys(byOwner).sort(function(a, b) { return byOwner[b] - byOwner[a]; }).forEach(function(o) {
		console.log('  ' + o + ': ' + byOwner[o]);
	});

	// Format output
	roster.sort(function(a, b) { return a.name.localeCompare(b.name); });

	var lines = ['ID,Owner,Name,Position,Start,End,Salary'];
	roster.forEach(function(p) {
		if (!p.owner) return;
		var start = p.startYear === null ? 'FA' : p.startYear;
		var salary = p.salary ? '$' + p.salary : '';
		lines.push(p.id + ',' + p.owner + ',' + p.name + ',' + p.position + ',' + start + ',' + p.endYear + ',' + salary);
	});

	if (args.write) {
		var outFile = path.join(SNAPSHOTS_DIR, 'contracts-' + season + '.txt');
		fs.writeFileSync(outFile, lines.join('\n') + '\n');
		console.log('\nWrote ' + outFile);
	} else {
		console.log('\nDry run — pass --write to save. Preview:');
		console.log('Total lines: ' + lines.length);
		// Show a few FA entries that remain
		var faLines = lines.filter(function(l) { return l.indexOf(',FA,') >= 0; });
		if (faLines.length > 0) {
			console.log('\nRemaining FA entries (' + faLines.length + '):');
			faLines.forEach(function(l) { console.log('  ' + l); });
		} else {
			console.log('\nNo FA entries remain!');
		}
	}
}

run();
