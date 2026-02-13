/**
 * Compute current Pick state from JSON data files.
 * 
 * Strategy:
 * 1. Initialize each franchise with their own 10 picks for upcoming seasons
 *    (currentSeason, currentSeason+1, currentSeason+2)
 * 2. Replay ALL trades involving picks for those seasons to track ownership
 * 3. Write final state to Pick collection (only future picks with status 'available')
 * 
 * Usage:
 *   docker compose run --rm web node data/seed/compute-picks.js
 *   docker compose run --rm web node data/seed/compute-picks.js --dry-run
 */

require('dotenv').config({ path: __dirname + '/../../.env' });

var mongoose = require('mongoose');
var fs = require('fs');
var path = require('path');

var Pick = require('../../models/Pick');
var Franchise = require('../../models/Franchise');
var PSO = require('../../config/pso');

mongoose.connect(process.env.MONGODB_URI);

var TRADES_FILE = path.join(__dirname, '../trades/trades.json');
var ROUNDS_PER_DRAFT = 10;

var args = {
	dryRun: process.argv.includes('--dry-run')
};

/**
 * Get the rosterId for an owner name in a specific season.
 * Owner names can change over time due to franchise transfers.
 * For future seasons not in the map, falls back to the most recent known season.
 */
function getRosterIdForSeason(ownerName, season) {
	if (!ownerName) return null;
	var name = ownerName.trim();
	
	// Build a reverse lookup: for this season, which rosterId has this owner name?
	var rosterIds = Object.keys(PSO.franchiseNames);
	
	// Find the effective season to use (fall back to latest known if future)
	function getEffectiveSeason(yearMap, targetSeason) {
		if (yearMap[targetSeason]) return targetSeason;
		// Find the most recent year in the map
		var years = Object.keys(yearMap).map(y => parseInt(y, 10)).sort((a, b) => b - a);
		for (var i = 0; i < years.length; i++) {
			if (years[i] <= targetSeason) return years[i];
		}
		// If target is before all known years, use the earliest
		return years[years.length - 1];
	}
	
	for (var i = 0; i < rosterIds.length; i++) {
		var rid = parseInt(rosterIds[i], 10);
		var yearMap = PSO.franchiseNames[rid];
		var effectiveSeason = getEffectiveSeason(yearMap, season);
		var ownerForYear = yearMap[effectiveSeason];
		if (ownerForYear && ownerForYear.toLowerCase() === name.toLowerCase()) {
			return rid;
		}
	}
	
	// Partial/fuzzy match (e.g., "Koci" matches "Koci/Mueller")
	for (var i = 0; i < rosterIds.length; i++) {
		var rid = parseInt(rosterIds[i], 10);
		var yearMap = PSO.franchiseNames[rid];
		var effectiveSeason = getEffectiveSeason(yearMap, season);
		var ownerForYear = yearMap[effectiveSeason];
		if (ownerForYear) {
			var parts = ownerForYear.split('/');
			for (var p = 0; p < parts.length; p++) {
				if (parts[p].toLowerCase() === name.toLowerCase()) {
					return rid;
				}
			}
		}
	}
	
	return null;
}

async function run() {
	console.log('Computing current Pick state...');
	if (args.dryRun) console.log('[DRY RUN]\n');
	
	// The draft for currentSeason has already happened, so we only create
	// picks for future seasons (currentSeason+1 and currentSeason+2).
	// The current season's picks come from drafts-from-json.js.
	var currentSeason = PSO.season;
	var futureSeasons = [currentSeason + 1, currentSeason + 2];
	console.log('Future seasons:', futureSeasons.join(', '));
	console.log('Rounds per draft:', ROUNDS_PER_DRAFT);
	console.log('');
	
	// Load franchises
	var franchises = await Franchise.find({}).lean();
	var franchiseByRosterId = {};
	franchises.forEach(function(f) {
		franchiseByRosterId[f.rosterId] = f;
	});
	console.log('Loaded', franchises.length, 'franchises');
	
	// Initialize pick state
	// Key: "season-round-originalRosterId" (e.g., "2025-1-9" = Schex's 2025 1st)
	// Value: { originalFranchiseId, currentFranchiseId, currentRosterId, season, round }
	var pickState = {};
	
	for (var i = 0; i < futureSeasons.length; i++) {
		var season = futureSeasons[i];
		for (var round = 1; round <= ROUNDS_PER_DRAFT; round++) {
			for (var rosterId = 1; rosterId <= 12; rosterId++) {
				var franchise = franchiseByRosterId[rosterId];
				if (!franchise) continue;
				
				var key = season + '-' + round + '-' + rosterId;
				pickState[key] = {
					season: season,
					round: round,
					originalFranchiseId: franchise._id,
					originalRosterId: rosterId,
					currentFranchiseId: franchise._id,
					currentRosterId: rosterId
				};
			}
		}
	}
	
	var initialPickCount = Object.keys(pickState).length;
	console.log('Initialized', initialPickCount, 'picks');
	console.log('');
	
	// Load and replay trades
	var trades = JSON.parse(fs.readFileSync(TRADES_FILE, 'utf8'));
	// Sort by date
	trades.sort(function(a, b) {
		return new Date(a.date) - new Date(b.date);
	});
	console.log('Loaded', trades.length, 'trades');
	
	var tradesApplied = 0;
	var picksMoved = 0;
	
	for (var i = 0; i < trades.length; i++) {
		var trade = trades[i];
		var tradeApplied = false;
		
		for (var j = 0; j < trade.parties.length; j++) {
			var party = trade.parties[j];
			var newFranchise = franchiseByRosterId[party.rosterId];
			if (!newFranchise) continue;
			
			// Process picks this party receives
			for (var k = 0; k < (party.picks || []).length; k++) {
				var pick = party.picks[k];
				
				// Parse pick info
				// picks have: season, round, fromOwner
				if (!pick.season || !pick.round || !pick.fromOwner) {
					continue;
				}
				
				// Only care about future seasons
				if (futureSeasons.indexOf(pick.season) === -1) {
					continue;
				}
				
				// Resolve fromOwner to rosterId using the pick's season
				// (picks are identified by their original owner at the time of the pick's season)
				var fromRosterId = getRosterIdForSeason(pick.fromOwner, pick.season);
				if (!fromRosterId) {
					continue;
				}
				
				// Find the pick in our state
				var key = pick.season + '-' + pick.round + '-' + fromRosterId;
				
				if (pickState[key]) {
					// Update ownership
					pickState[key].currentFranchiseId = newFranchise._id;
					pickState[key].currentRosterId = party.rosterId;
					picksMoved++;
					tradeApplied = true;
				}
			}
		}
		
		if (tradeApplied) tradesApplied++;
	}
	
	console.log('Applied', tradesApplied, 'trades affecting', picksMoved, 'pick ownership changes');
	console.log('');
	
	// Calculate summary - how many traded picks per season
	var tradedByFranchise = {};
	var ownedByFranchise = {};
	
	Object.values(pickState).forEach(function(p) {
		var origRid = p.originalRosterId;
		var currRid = p.currentRosterId;
		
		if (!tradedByFranchise[origRid]) tradedByFranchise[origRid] = 0;
		if (!ownedByFranchise[currRid]) ownedByFranchise[currRid] = 0;
		
		if (origRid !== currRid) {
			tradedByFranchise[origRid]++;
		}
		ownedByFranchise[currRid]++;
	});
	
	console.log('Pick ownership summary:');
	for (var rid = 1; rid <= 12; rid++) {
		var franchise = franchiseByRosterId[rid];
		if (!franchise) continue;
		var owned = ownedByFranchise[rid] || 0;
		var tradedAway = tradedByFranchise[rid] || 0;
		var base = futureSeasons.length * ROUNDS_PER_DRAFT; // 30 picks per franchise normally
		console.log('  ' + PSO.franchises[rid] + ': ' + owned + ' picks (traded away ' + tradedAway + ')');
	}
	console.log('');
	
	// Write to database
	var picks = Object.values(pickState);
	
	if (!args.dryRun) {
		// Only clear future picks
		console.log('Clearing existing future picks...');
		var deleteResult = await Pick.deleteMany({
			season: { $in: futureSeasons }
		});
		console.log('  Deleted', deleteResult.deletedCount, 'picks');
		
		console.log('Writing', picks.length, 'picks...');
		for (var i = 0; i < picks.length; i++) {
			var p = picks[i];
			await Pick.create({
				season: p.season,
				round: p.round,
				originalFranchiseId: p.originalFranchiseId,
				currentFranchiseId: p.currentFranchiseId,
				status: 'available'
			});
		}
		console.log('Done!');
	} else {
		console.log('[DRY RUN] Would write', picks.length, 'picks');
	}
	
	process.exit(0);
}

run().catch(function(err) {
	console.error('Error:', err);
	process.exit(1);
});
