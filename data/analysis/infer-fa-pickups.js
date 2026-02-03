/**
 * Infer FA Pickups from Snapshot Differences
 * 
 * For 2014-2019, compares contracts-YYYY.txt (post-auction state) to
 * postseason-YYYY.txt (end-of-season state) to find FA acquisitions.
 * 
 * A player is inferred as an FA pickup if:
 *   1. They appear in postseason with an owner and startYear=null (FA contract)
 *   2. They weren't on that owner's roster in the pre-season snapshot
 *   3. They weren't acquired via trade during the season
 * 
 * Usage:
 *   node data/analysis/infer-fa-pickups.js [year]
 */

var snapshotFacts = require('../facts/snapshot-facts');
var tradeFacts = require('../facts/trade-facts');

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
 * Get conventional FA timestamp: first Thursday after Labor Day, 12:00:33 ET
 */
function getConventionalFaTimestamp(year, upperBound) {
	var firstThursday = getFirstThursdayAfterLaborDay(year);
	
	// Use first Thursday after Labor Day as the conventional date
	// (unless we have a tighter upper bound from trade data)
	// For now, just use first Thursday
	
	// 12:00:33 ET = 17:00:33 UTC (or 16:00:33 during DST)
	// September is during DST, so ET = UTC-4
	return new Date(Date.UTC(
		firstThursday.getFullYear(),
		firstThursday.getMonth(),
		firstThursday.getDate(),
		16, 0, 33  // 12:00:33 ET during DST
	));
}

/**
 * Build a set of players traded to each owner during a season
 */
function getTradedInPlayers(trades, season) {
	var tradedIn = {}; // owner -> Set of player names (lowercase)
	
	trades.forEach(function(trade) {
		var tradeYear = trade.date.getFullYear();
		if (tradeYear !== season) return;
		
		trade.parties.forEach(function(party) {
			var owner = party.owner;
			if (!owner) return;
			
			party.players.forEach(function(player) {
				var key = owner.toLowerCase();
				if (!tradedIn[key]) tradedIn[key] = new Set();
				tradedIn[key].add(player.name.toLowerCase());
			});
		});
	});
	
	return tradedIn;
}

/**
 * Normalize owner name for comparison
 */
function normalizeOwner(owner) {
	if (!owner) return null;
	return owner.toLowerCase().replace(/\s+/g, '');
}

/**
 * Infer FA pickups for a single season
 */
function inferFaPickups(season) {
	// Load pre-season (contracts) and post-season snapshots
	var preseason = snapshotFacts.loadSeason(season);
	var postseason = snapshotFacts.loadPostseason(season);
	
	if (postseason.length === 0) {
		console.log('No postseason snapshot for ' + season);
		return [];
	}
	
	// Build pre-season roster map: owner -> Set of player names
	var preseasonRosters = {};
	preseason.forEach(function(c) {
		if (!c.owner) return;
		var ownerKey = normalizeOwner(c.owner);
		if (!preseasonRosters[ownerKey]) preseasonRosters[ownerKey] = new Set();
		preseasonRosters[ownerKey].add(c.playerName.toLowerCase());
	});
	
	// Get players traded in during the season
	var allTrades = tradeFacts.loadAll();
	var tradedIn = getTradedInPlayers(allTrades, season);
	
	// Find FA pickups in postseason
	var faPickups = [];
	
	postseason.forEach(function(c) {
		// Must have owner and be an FA contract (startYear = null)
		if (!c.owner || c.startYear !== null) return;
		
		var ownerKey = normalizeOwner(c.owner);
		var playerKey = c.playerName.toLowerCase();
		
		// Check if player was already on this owner's pre-season roster
		if (preseasonRosters[ownerKey] && preseasonRosters[ownerKey].has(playerKey)) {
			return; // Already owned, not a pickup
		}
		
		// Check if player was traded in
		if (tradedIn[ownerKey] && tradedIn[ownerKey].has(playerKey)) {
			return; // Acquired via trade
		}
		
		faPickups.push({
			season: season,
			owner: c.owner,
			playerName: c.playerName,
			position: c.position,
			salary: c.salary,
			endYear: c.endYear,
			espnId: c.espnId
		});
	});
	
	return faPickups;
}

/**
 * Main
 */
function run() {
	var targetYear = process.argv[2] ? parseInt(process.argv[2]) : null;
	
	if (targetYear) {
		var pickups = inferFaPickups(targetYear);
		console.log('\n=== ' + targetYear + ' FA Pickups (' + pickups.length + ') ===\n');
		pickups.forEach(function(p) {
			console.log('  ' + p.owner + ': ' + p.playerName + ' (' + p.position + ') $' + (p.salary || 0));
		});
	} else {
		// Run for all years with postseason data
		var allPickups = [];
		
		for (var year = 2014; year <= 2019; year++) {
			var pickups = inferFaPickups(year);
			console.log(year + ': ' + pickups.length + ' FA pickups inferred');
			allPickups = allPickups.concat(pickups);
		}
		
		console.log('\nTotal: ' + allPickups.length + ' FA pickups for 2014-2019');
	}
}

run();
