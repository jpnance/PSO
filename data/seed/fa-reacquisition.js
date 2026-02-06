/**
 * Seed FA Reacquisitions from Cuts + Snapshot Data
 * 
 * For players who appear in the contracts snapshot with an FA contract,
 * if there's a cut record showing someone ELSE cutting that player earlier,
 * and the snapshot owner wasn't traded the player, they must have picked
 * them up as FA after the cut.
 * 
 * This complements fa-cuts.js by catching the "next owner" after a cut.
 * 
 * Usage:
 *   node data/seed/fa-reacquisition.js [--dry-run] [--year=YYYY]
 */

var dotenv = require('dotenv').config({ path: __dirname + '/../../.env' });
var mongoose = require('mongoose');

var Player = require('../../models/Player');
var Franchise = require('../../models/Franchise');
var Transaction = require('../../models/Transaction');
var Regime = require('../../models/Regime');
var snapshotFacts = require('../facts/snapshot-facts');
var tradeFacts = require('../facts/trade-facts');
var cutFacts = require('../facts/cut-facts');
var resolver = require('../utils/player-resolver');

mongoose.connect(process.env.MONGODB_URI);

var FIRST_YEAR = 2009;
var LAST_YEAR = 2019;

/**
 * Get Labor Day for a given year (first Monday of September)
 */
function getLaborDay(year) {
	var sept1 = new Date(year, 8, 1);
	var dayOfWeek = sept1.getDay();
	var daysToMonday = dayOfWeek === 0 ? 1 : (dayOfWeek === 1 ? 0 : 8 - dayOfWeek);
	return new Date(year, 8, 1 + daysToMonday);
}

/**
 * Get first Thursday after Labor Day
 */
function getFirstThursdayAfterLaborDay(year) {
	var laborDay = getLaborDay(year);
	var daysToThursday = (4 - laborDay.getDay() + 7) % 7 || 7;
	return new Date(year, 8, laborDay.getDate() + daysToThursday);
}

/**
 * Get FA pickup timestamp (first Thursday after Labor Day, 12:00:33 PM ET)
 */
function getFaTimestamp(year) {
	var thursday = getFirstThursdayAfterLaborDay(year);
	// September is during DST, so ET = UTC-4
	// 12:00:33 PM ET = 16:00:33 UTC
	return new Date(Date.UTC(thursday.getFullYear(), thursday.getMonth(), thursday.getDate(), 16, 0, 33));
}

/**
 * Build owner map for a season using 2025 regime names
 */
function buildOwnerMap(regimes, franchises) {
	return cutFacts.buildOwnerMap(regimes, franchises);
}

/**
 * Get historical regime name for a franchise in a given year
 */
function getHistoricalRegime(regimes, franchiseId, year) {
	var regime = regimes.find(function(r) {
		return r.tenures && r.tenures.some(function(t) {
			return t.franchiseId.toString() === franchiseId.toString() &&
				t.startSeason <= year &&
				(t.endSeason === null || t.endSeason >= year);
		});
	});
	return regime ? regime.displayName : null;
}

/**
 * Get players traded to each owner in a season
 */
function getTradedToOwner(trades, year, ownerMap) {
	var tradedTo = {}; // franchiseId -> Set of player names (lowercase)
	
	trades.forEach(function(trade) {
		if (trade.date.getFullYear() !== year) return;
		
		trade.parties.forEach(function(party) {
			var franchiseId = ownerMap[party.owner.toLowerCase()];
			if (!franchiseId) return;
			
			var key = franchiseId.toString();
			if (!tradedTo[key]) tradedTo[key] = new Set();
			
			party.players.forEach(function(player) {
				tradedTo[key].add(player.name.toLowerCase());
			});
		});
	});
	
	return tradedTo;
}

async function run() {
	var args = process.argv.slice(2);
	var dryRun = args.includes('--dry-run');
	var yearArg = args.find(function(a) { return a.startsWith('--year='); });
	var targetYear = yearArg ? parseInt(yearArg.split('=')[1]) : null;
	
	if (dryRun) {
		console.log('=== DRY RUN MODE ===\n');
	}
	
	var regimes = await Regime.find({}).lean();
	var franchises = await Franchise.find({}).lean();
	var players = await Player.find({}).lean();
	
	// Build player lookup
	var playersByName = {};
	players.forEach(function(p) {
		var key = resolver.normalizePlayerName(p.name);
		if (!playersByName[key]) playersByName[key] = [];
		playersByName[key].push(p);
	});
	
	// Build owner map (2025 regime names -> rosterId)
	var ownerMap = buildOwnerMap(regimes, franchises);
	
	// Build rosterId -> franchiseId map
	var rosterIdToFranchise = cutFacts.buildRosterIdToFranchiseMap(franchises);
	
	// Also build map from historical owner names to franchise IDs
	var historicalOwnerMap = {};
	regimes.forEach(function(r) {
		if (!r.tenures) return;
		r.tenures.forEach(function(t) {
			var key = r.displayName.toLowerCase();
			if (!historicalOwnerMap[key]) historicalOwnerMap[key] = {};
			for (var y = t.startSeason; y <= (t.endSeason || 2025); y++) {
				historicalOwnerMap[key][y] = t.franchiseId;
			}
		});
	});
	
	// Load all data
	var allCuts = cutFacts.loadAll();
	var allTrades = tradeFacts.checkAvailability() ? tradeFacts.loadAll() : [];
	
	var startYear = targetYear || FIRST_YEAR;
	var endYear = targetYear || LAST_YEAR;
	
	var totalCreated = 0;
	var totalSkipped = 0;
	
	for (var year = startYear; year <= endYear; year++) {
		var faTimestamp = getFaTimestamp(year);
		
		// Load contracts snapshot for this year
		var snapshot = snapshotFacts.loadSeason(year);
		
		// Get cuts for this year
		var yearCuts = allCuts.filter(function(c) { return c.cutYear === year; });
		
		// Build map of cut players: playerName -> array of {owner, franchiseId}
		var cutBy = {};
		yearCuts.forEach(function(c) {
			var key = c.name.toLowerCase();
			var rosterId = cutFacts.getRosterId(c.owner, ownerMap);
			var franchiseId = rosterId ? rosterIdToFranchise[rosterId] : null;
			if (!cutBy[key]) cutBy[key] = [];
			cutBy[key].push({ owner: c.owner, franchiseId: franchiseId });
		});
		
		// Get traded-to map for this year
		var tradedTo = getTradedToOwner(allTrades, year, ownerMap);
		
		// Find FA contracts in snapshot where someone else cut the player
		var faContracts = snapshot.filter(function(c) {
			return c.startYear === null; // FA contract
		});
		
		var yearCreated = 0;
		
		for (var i = 0; i < faContracts.length; i++) {
			var contract = faContracts[i];
			var playerKey = contract.playerName.toLowerCase();
			
			// Get franchise ID for snapshot owner
			var snapshotOwnerKey = contract.owner.toLowerCase();
			var snapshotFranchiseId = historicalOwnerMap[snapshotOwnerKey] && historicalOwnerMap[snapshotOwnerKey][year];
			
			if (!snapshotFranchiseId) {
				// Try the 2025 owner map
				snapshotFranchiseId = ownerMap[snapshotOwnerKey];
			}
			
			if (!snapshotFranchiseId) {
				continue;
			}
			
			// Check if this player was cut by someone else
			var cuts = cutBy[playerKey] || [];
			var cutByOther = cuts.filter(function(c) {
				return c.franchiseId && c.franchiseId.toString() !== snapshotFranchiseId.toString();
			});
			
			if (cutByOther.length === 0) {
				// No one else cut this player, so snapshot owner is original acquirer
				continue;
			}
			
			// Check if snapshot owner was traded this player
			var franchiseKey = snapshotFranchiseId.toString();
			if (tradedTo[franchiseKey] && tradedTo[franchiseKey].has(playerKey)) {
				continue;
			}
			
			// Find player in database
			var normalized = resolver.normalizePlayerName(contract.playerName);
			var candidates = playersByName[normalized] || [];
			
			var player = null;
			if (candidates.length === 1) {
				player = candidates[0];
			} else if (candidates.length > 1) {
				// Try to match by position
				var posMatch = candidates.find(function(c) {
					return c.positions && c.positions.some(function(p) {
						return contract.position && contract.position.includes(p);
					});
				});
				player = posMatch || candidates[0];
			}
			
			// Auto-create for historical years (before 2016)
			if (!player && candidates.length === 0 && year < 2016) {
				// Check if player exists with exact name
				var existing = await Player.findOne({ name: contract.playerName, sleeperId: null });
				if (existing) {
					player = existing;
					// Add to cache
					if (!playersByName[normalized]) playersByName[normalized] = [];
					playersByName[normalized].push(existing);
				} else {
					console.log('  Auto-creating historical: ' + contract.playerName + ' [' + (contract.position || '?') + ']');
					player = await Player.create({
						name: contract.playerName,
						positions: contract.position ? [contract.position] : [],
						sleeperId: null
					});
					// Add to cache
					if (!playersByName[normalized]) playersByName[normalized] = [];
					playersByName[normalized].push(player);
				}
			}
			
			if (!player) {
				console.log('  ✗ Could not find player: ' + contract.playerName);
				totalSkipped++;
				continue;
			}
			
			// Check if FA transaction already exists for this owner/player/year
			var existing = await Transaction.findOne({
				type: 'fa',
				franchiseId: snapshotFranchiseId,
				'adds.playerId': player._id,
				timestamp: {
					$gte: new Date(year, 0, 1),
					$lt: new Date(year + 1, 0, 1)
				}
			});
			
			if (existing) {
				continue;
			}
			
			var historicalName = getHistoricalRegime(regimes, snapshotFranchiseId, year) || contract.owner;
			var cutterNames = cutByOther.map(function(c) { return c.owner; }).join(', ');
			
			if (dryRun) {
				console.log(year + ': ' + contract.playerName + ' → ' + historicalName + ' ($' + contract.salary + ') [cut by: ' + cutterNames + ']');
				yearCreated++;
			} else {
				try {
				await Transaction.create({
					type: 'fa',
					timestamp: faTimestamp,
					source: 'snapshot',
					franchiseId: snapshotFranchiseId,
					adds: [{
						playerId: player._id,
						salary: contract.salary,
						startYear: contract.startYear,
						endYear: contract.endYear
					}]
				});
					yearCreated++;
				} catch (err) {
					console.log('  ✗ Error: ' + err.message);
					totalSkipped++;
				}
			}
		}
		
		totalCreated += yearCreated;
		if (yearCreated > 0) {
			console.log(year + ': Created ' + yearCreated + ' FA reacquisitions');
		}
	}
	
	console.log('\n=== Summary ===');
	console.log('Created: ' + totalCreated);
	console.log('Skipped: ' + totalSkipped);
	
	await mongoose.disconnect();
}

run().catch(function(err) {
	console.error(err);
	process.exit(1);
});
