#!/usr/bin/env node
/**
 * Backfill trades.json with franchise IDs (rosterId) for each party.
 * 
 * Uses the trade date to determine the season, then looks up which franchise
 * the owner name corresponds to in that season using PSO.franchiseNames.
 * 
 * Usage:
 *   node data/trades/backfill-franchise-ids.js
 *   node data/trades/backfill-franchise-ids.js --dry-run
 */

var fs = require('fs');
var path = require('path');

var PSO = require('../../config/pso.js');

var TRADES_FILE = path.join(__dirname, 'trades.json');

var dryRun = process.argv.includes('--dry-run');

/**
 * Get franchise rosterId for an owner name in a specific season.
 */
function getRosterIdForSeason(ownerName, season) {
	if (!ownerName) return null;
	var name = ownerName.trim().toLowerCase();
	
	// Exact match first
	var rosterIds = Object.keys(PSO.franchiseNames);
	for (var i = 0; i < rosterIds.length; i++) {
		var rid = parseInt(rosterIds[i], 10);
		var yearMap = PSO.franchiseNames[rid];
		var ownerForYear = yearMap[season];
		if (ownerForYear && ownerForYear.toLowerCase() === name) {
			return rid;
		}
	}
	
	// Partial/fuzzy match (e.g., "Koci" matches "Koci/Mueller")
	for (var i = 0; i < rosterIds.length; i++) {
		var rid = parseInt(rosterIds[i], 10);
		var yearMap = PSO.franchiseNames[rid];
		var ownerForYear = yearMap[season];
		if (ownerForYear) {
			var lower = ownerForYear.toLowerCase();
			if (lower.indexOf(name) >= 0 || name.indexOf(lower) >= 0) {
				return rid;
			}
		}
	}
	
	return null;
}

function run() {
	console.log('Backfilling franchise IDs in trades.json...');
	if (dryRun) console.log('[DRY RUN]\n');
	
	var trades = JSON.parse(fs.readFileSync(TRADES_FILE, 'utf8'));
	console.log('Loaded ' + trades.length + ' trades\n');
	
	var stats = {
		tradesUpdated: 0,
		partiesUpdated: 0,
		alreadyHadId: 0,
		errors: []
	};
	
	for (var i = 0; i < trades.length; i++) {
		var trade = trades[i];
		var tradeDate = new Date(trade.date);
		var tradeYear = tradeDate.getFullYear();
		var tradeUpdated = false;
		
		if (!trade.parties || trade.parties.length === 0) continue;
		
		for (var j = 0; j < trade.parties.length; j++) {
			var party = trade.parties[j];
			
			// Skip if already has rosterId
			if (party.rosterId !== undefined) {
				stats.alreadyHadId++;
				continue;
			}
			
			var rosterId = getRosterIdForSeason(party.owner, tradeYear);
			
			if (rosterId === null) {
				stats.errors.push('Trade #' + trade.tradeId + ': Could not resolve "' + party.owner + '" in ' + tradeYear);
				continue;
			}
			
			party.rosterId = rosterId;
			stats.partiesUpdated++;
			tradeUpdated = true;
		}
		
		if (tradeUpdated) {
			stats.tradesUpdated++;
		}
	}
	
	console.log('Results:');
	console.log('  Trades updated: ' + stats.tradesUpdated);
	console.log('  Parties updated: ' + stats.partiesUpdated);
	console.log('  Already had ID: ' + stats.alreadyHadId);
	
	if (stats.errors.length > 0) {
		console.log('\nErrors (' + stats.errors.length + '):');
		stats.errors.forEach(function(e) {
			console.log('  - ' + e);
		});
	}
	
	if (!dryRun && stats.partiesUpdated > 0) {
		fs.writeFileSync(TRADES_FILE, JSON.stringify(trades, null, 2), 'utf8');
		console.log('\nWrote updated trades.json');
	} else if (dryRun) {
		console.log('\n[DRY RUN] No changes written');
	}
}

run();
