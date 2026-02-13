#!/usr/bin/env node
/**
 * Generate auctions.json - actual auction events where players were acquired.
 *
 * This filters out drafted players and "unrolls" unsigned player trades to
 * determine who actually won the player at auction (before any trades).
 *
 * Usage:
 *   node data/auctions/generate.js
 *   node data/auctions/generate.js --dry-run
 */

var fs = require('fs');
var path = require('path');

var PSO = require('../../config/pso.js');

var CONTRACTS_FILE = path.join(__dirname, '../contracts/contracts.json');
var DRAFTS_FILE = path.join(__dirname, '../drafts/drafts.json');
var TRADES_FILE = path.join(__dirname, '../trades/trades.json');
var RFA_FILE = path.join(__dirname, '../rfa/rfa.json');
var OUTPUT_FILE = path.join(__dirname, 'auctions.json');

// Build owner name -> rosterId for each year from PSO.franchiseNames
var ownerToRosterIdByYear = {};
Object.keys(PSO.franchiseNames).forEach(function(rosterId) {
	var yearMap = PSO.franchiseNames[rosterId];
	Object.keys(yearMap).forEach(function(year) {
		var y = parseInt(year, 10);
		if (!ownerToRosterIdByYear[y]) {
			ownerToRosterIdByYear[y] = {};
		}
		ownerToRosterIdByYear[y][yearMap[year]] = parseInt(rosterId, 10);
	});
});

function getRosterId(ownerName, season) {
	if (!ownerName) return null;
	var yearMap = ownerToRosterIdByYear[season];
	if (!yearMap) return null;

	var direct = yearMap[ownerName];
	if (direct !== undefined) return direct;

	// Partial match (e.g. "John" vs "John/Zach")
	var owners = Object.keys(yearMap);
	for (var i = 0; i < owners.length; i++) {
		if (owners[i].indexOf(ownerName) >= 0 || ownerName.indexOf(owners[i]) >= 0) {
			return yearMap[owners[i]];
		}
	}
	return null;
}

function normalizePlayerName(name) {
	if (!name) return '';
	return name.toLowerCase()
		.replace(/\s+(jr\.?|sr\.?|iii|ii|iv|v)$/i, '')
		.trim();
}

/**
 * Build a map of unsigned player trades for a given season.
 * Returns: { normalizedPlayerName: [{ fromOwner, toOwner, date }] }
 * We use normalized player name as the key since that's what contracts have.
 */
function buildUnsignedTradesMap(trades, season) {
	var map = {};

	trades.forEach(function(trade) {
		var tradeDate = new Date(trade.date);
		var tradeSeason = tradeDate.getFullYear();

		// Only consider trades in the same season
		if (tradeSeason !== season) return;

		trade.parties.forEach(function(receivingParty) {
			(receivingParty.players || []).forEach(function(player) {
				if (player.contractStr !== 'unsigned') return;

				// Find who gave up this player (the other party)
				var givingParty = trade.parties.find(function(p) {
					return p !== receivingParty;
				});

				if (!givingParty) return;

				// Use normalized player name as key (consistent with contracts)
				var playerKey = normalizePlayerName(player.name);
				if (!playerKey) return;

				if (!map[playerKey]) {
					map[playerKey] = [];
				}

				map[playerKey].push({
					fromOwner: givingParty.owner,
					toOwner: receivingParty.owner,
					date: trade.date,
					tradeId: trade.tradeId
				});
			});
		});
	});

	// Sort each player's trades by date (earliest first)
	Object.keys(map).forEach(function(key) {
		map[key].sort(function(a, b) {
			return new Date(a.date) - new Date(b.date);
		});
	});

	return map;
}

/**
 * Trace back through unsigned trades to find the original owner.
 * Returns the owner name who first held the player (before any unsigned trades).
 */
function findOriginalOwner(playerKey, finalOwner, unsignedTradesMap) {
	var trades = unsignedTradesMap[playerKey];
	if (!trades || trades.length === 0) {
		// No unsigned trades - the contract owner IS the auction winner
		return finalOwner;
	}

	// Work backwards from the final owner
	var currentOwner = finalOwner;
	var visited = new Set();

	while (true) {
		if (visited.has(currentOwner)) {
			console.warn('Circular trade detected for ' + playerKey);
			break;
		}
		visited.add(currentOwner);

		// Find a trade where someone gave the player TO currentOwner
		var incomingTrade = trades.find(function(t) {
			return t.toOwner === currentOwner;
		});

		if (!incomingTrade) {
			// No one gave this player to currentOwner - they're the original owner
			break;
		}

		// Continue tracing back
		currentOwner = incomingTrade.fromOwner;
	}

	return currentOwner;
}

function main() {
	var dryRun = process.argv.indexOf('--dry-run') >= 0;

	// Load all data sources
	var contracts = JSON.parse(fs.readFileSync(CONTRACTS_FILE, 'utf8'));
	var drafts = JSON.parse(fs.readFileSync(DRAFTS_FILE, 'utf8'));
	var trades = JSON.parse(fs.readFileSync(TRADES_FILE, 'utf8'));
	var rfaRecords = JSON.parse(fs.readFileSync(RFA_FILE, 'utf8'));

	// Build RFA rights lookup: { "playerKey|season": rosterId }
	// An rfa-rights-conversion in season S means the owner held RFA rights
	// going into the S+1 auction -- UNLESS those rights subsequently lapsed.
	var rfaRights = {};
	rfaRecords.forEach(function(r) {
		if (r.type !== 'rfa-rights-conversion') return;
		var key;
		if (r.sleeperId && r.sleeperId !== '-1') {
			key = r.sleeperId + '|' + r.season;
		} else {
			key = normalizePlayerName(r.playerName) + '|' + r.season;
		}
		rfaRights[key] = r.rosterId;
	});

	// Remove lapsed RFA rights from the lookup - these players go to auction
	// as UFAs since the rights holder chose not to nominate them.
	rfaRecords.forEach(function(r) {
		if (r.type !== 'rfa-rights-lapsed') return;
		var key;
		if (r.sleeperId && r.sleeperId !== '-1') {
			key = r.sleeperId + '|' + r.season;
		} else {
			key = normalizePlayerName(r.playerName) + '|' + r.season;
		}
		delete rfaRights[key];
	});

	// Build draft lookup by season: { season: [{ sleeperId, name }] }
	var draftsBySeason = {};
	drafts.forEach(function(d) {
		if (d.passed) return;
		if (!draftsBySeason[d.season]) draftsBySeason[d.season] = [];
		draftsBySeason[d.season].push({
			sleeperId: d.sleeperId || null,
			name: normalizePlayerName(d.playerName)
		});
	});

	// Group contracts by season for efficient processing
	var contractsBySeason = {};
	contracts.forEach(function(c) {
		if (!contractsBySeason[c.season]) {
			contractsBySeason[c.season] = [];
		}
		contractsBySeason[c.season].push(c);
	});

	var auctions = [];
	var stats = {
		total: 0,
		drafted: 0,
		unrolled: 0,
		auctions: 0
	};

	Object.keys(contractsBySeason).sort().forEach(function(seasonStr) {
		var season = parseInt(seasonStr, 10);
		var seasonContracts = contractsBySeason[season];
		var unsignedTradesMap = buildUnsignedTradesMap(trades, season);
		var seasonDrafts = draftsBySeason[season] || [];

		seasonContracts.forEach(function(contract) {
			stats.total++;

			// Check if this contract matches a draft pick.
			// Match on sleeperId if both have one; fall back to name only
			// if NEITHER has a sleeperId. This prevents a historical player
			// (no ID) from matching a drafted player (with ID) by name alone.
			var contractHasId = contract.sleeperId && contract.sleeperId !== '-1';
			var isDrafted = seasonDrafts.some(function(d) {
				var draftHasId = !!d.sleeperId;
				if (contractHasId && draftHasId) {
					return contract.sleeperId === d.sleeperId;
				}
				if (!contractHasId && !draftHasId) {
					return normalizePlayerName(contract.name) === d.name;
				}
				return false;
			});

			if (isDrafted) {
				stats.drafted++;
				return; // Skip drafted players
			}

			// Build player key for trade lookup (always use normalized name for consistency)
			var playerKey = normalizePlayerName(contract.name);

			// Get the owner from the contract (who ended up with the player)
			var contractOwner = null;
			var yearMap = ownerToRosterIdByYear[season];
			if (yearMap) {
				Object.keys(yearMap).forEach(function(owner) {
					if (yearMap[owner] === contract.rosterId) {
						contractOwner = owner;
					}
				});
			}

			if (!contractOwner) {
				console.warn('Could not find owner for rosterId ' + contract.rosterId + ' in ' + season);
				return;
			}

			// Find the original auction winner by unrolling unsigned trades
			var originalOwner = findOriginalOwner(playerKey, contractOwner, unsignedTradesMap);

			if (originalOwner !== contractOwner) {
				stats.unrolled++;
			}

			var originalRosterId = getRosterId(originalOwner, season);
			if (originalRosterId === null) {
				console.warn('Could not find rosterId for owner "' + originalOwner + '" in ' + season);
				return;
			}

			stats.auctions++;

			// Classify auction type based on RFA rights from prior season
			var rfaKey;
			if (contract.sleeperId && contract.sleeperId !== '-1') {
				rfaKey = contract.sleeperId + '|' + (season - 1);
			} else {
				rfaKey = normalizePlayerName(contract.name) + '|' + (season - 1);
			}
			var rfaHolderRosterId = rfaRights[rfaKey];
			var auctionType;
			if (rfaHolderRosterId !== undefined) {
				auctionType = (rfaHolderRosterId === originalRosterId)
					? 'auction-rfa-matched'
					: 'auction-rfa-unmatched';
			} else {
				auctionType = 'auction-ufa';
			}

			auctions.push({
				season: season,
				type: auctionType,
				sleeperId: contract.sleeperId,
				name: contract.name,
				positions: contract.positions,
				rosterId: originalRosterId,
				originalOwner: originalOwner,
				salary: contract.salary,
				startYear: contract.startYear,
				endYear: contract.endYear
			});
		});
	});

	auctions.sort(function(a, b) {
		if (a.season !== b.season) return a.season - b.season;
		return (a.name || '').localeCompare(b.name || '');
	});

	if (dryRun) {
		console.log('Dry run statistics:');
		console.log('  Total contracts: ' + stats.total);
		console.log('  Drafted (skipped): ' + stats.drafted);
		console.log('  Auctions: ' + stats.auctions);
		console.log('  Unrolled from trades: ' + stats.unrolled);
		console.log('');
		console.log('Would write ' + auctions.length + ' auction entries to ' + OUTPUT_FILE);

		var bySeason = {};
		auctions.forEach(function(e) {
			bySeason[e.season] = (bySeason[e.season] || 0) + 1;
		});
		Object.keys(bySeason).sort().forEach(function(y) {
			console.log('  ' + y + ': ' + bySeason[y]);
		});
		return;
	}

	// Count by type
	var byType = {};
	auctions.forEach(function(a) {
		byType[a.type] = (byType[a.type] || 0) + 1;
	});

	fs.writeFileSync(OUTPUT_FILE, JSON.stringify(auctions, null, 2), 'utf8');
	console.log('Wrote ' + auctions.length + ' entries to ' + OUTPUT_FILE);
	console.log('  Drafted (skipped): ' + stats.drafted);
	console.log('  Unrolled from trades: ' + stats.unrolled);
	Object.keys(byType).sort().forEach(function(t) {
		console.log('  ' + t + ': ' + byType[t]);
	});
}

main();
