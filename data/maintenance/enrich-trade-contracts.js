/**
 * Enrich trades.json with inferred contract data.
 * 
 * Reads trades.json, runs the inference engine on each player,
 * and writes back a `contract` field with { start, end, source }.
 * 
 * Usage:
 *   node data/maintenance/enrich-trade-contracts.js [--dry-run]
 */

require('dotenv').config();

var fs = require('fs');
var path = require('path');

var facts = require('../facts');
var inference = require('../inference');

var TRADES_PATH = path.join(__dirname, '../trades/trades.json');

/**
 * Load all context needed for inference.
 */
function loadContext() {
	console.log('Loading context for inference...\n');
	
	var context = {
		snapshots: [],
		cuts: [],
		drafts: [],
		preseasonRosters: []
	};
	
	// Load snapshots
	console.log('  Loading snapshots...');
	context.snapshots = facts.snapshots.loadAll();
	console.log('    Found ' + context.snapshots.length + ' contracts');
	
	// Preseason rosters are the contracts-YEAR.txt files
	context.preseasonRosters = context.snapshots.filter(function(s) {
		return s.source === 'contracts';
	});
	console.log('    ' + context.preseasonRosters.length + ' preseason roster entries');
	
	// Load cuts
	if (facts.cuts.checkAvailability()) {
		console.log('  Loading cuts...');
		context.cuts = facts.cuts.loadAll();
		console.log('    Found ' + context.cuts.length + ' cuts');
	}
	
	// Load drafts
	if (facts.drafts.checkAvailability()) {
		console.log('  Loading drafts...');
		context.drafts = facts.drafts.loadAll();
		console.log('    Found ' + context.drafts.length + ' draft picks');
	}
	
	console.log('');
	return context;
}

/**
 * Run inference on a single player and return contract object.
 */
function inferContract(player, tradeDate, context, tradeSeasonYear) {
	// Get preseason roster for this trade's season
	var preseasonRoster = context.preseasonRosters.filter(function(p) {
		return p.season === tradeSeasonYear;
	});
	
	var result = inference.contractTerm.infer(player.contractStr, {
		date: tradeDate,
		playerName: player.name,
		salary: player.salary,
		snapshots: context.snapshots,
		cuts: context.cuts,
		preseasonRoster: preseasonRoster,
		drafts: context.drafts
	});
	
	return {
		start: result.startYear,
		end: result.endYear,
		source: result.confidence
	};
}

/**
 * Main function.
 */
function main() {
	var dryRun = process.argv.includes('--dry-run');
	
	if (dryRun) {
		console.log('=== DRY RUN - No changes will be written ===\n');
	}
	
	// Load context
	var context = loadContext();
	
	// Load trades
	console.log('Loading trades.json...');
	var tradesContent = fs.readFileSync(TRADES_PATH, 'utf8');
	var trades = JSON.parse(tradesContent);
	console.log('  Found ' + trades.length + ' trades\n');
	
	// Process each trade
	var stats = {
		total: 0,
		certain: 0,
		inferred: 0,
		ambiguous: 0,
		alreadyHadContract: 0
	};
	
	console.log('Processing trades...');
	
	trades.forEach(function(trade) {
		var tradeDate = new Date(trade.date);
		var tradeSeasonYear = inference.contractTerm.getSeasonYear(tradeDate);
		
		trade.parties.forEach(function(party) {
			party.players.forEach(function(player) {
				stats.total++;
				
				// Check if already has contract field
				if (player.contract && player.contract.start !== undefined) {
					stats.alreadyHadContract++;
					return;
				}
				
				// Run inference
				var contract = inferContract(player, tradeDate, context, tradeSeasonYear);
				
				// Track stats
				if (contract.source === 'certain') {
					stats.certain++;
				} else if (contract.source === 'inferred') {
					stats.inferred++;
				} else {
					stats.ambiguous++;
				}
				
				// Add contract field
				player.contract = contract;
			});
		});
	});
	
	console.log('\nResults:');
	console.log('  Total players: ' + stats.total);
	console.log('  Already had contract: ' + stats.alreadyHadContract);
	console.log('  Certain: ' + stats.certain);
	console.log('  Inferred: ' + stats.inferred);
	console.log('  Ambiguous: ' + stats.ambiguous);
	
	if (dryRun) {
		console.log('\n=== DRY RUN - No changes written ===');
		
		// Show a sample
		console.log('\nSample output (first trade with players):');
		var sample = trades.find(function(t) {
			return t.parties.some(function(p) { return p.players.length > 0; });
		});
		if (sample) {
			sample.parties.forEach(function(party) {
				party.players.forEach(function(player) {
					console.log('  ' + player.name + ': ' + JSON.stringify(player.contract));
				});
			});
		}
	} else {
		// Write back
		console.log('\nWriting to trades.json...');
		fs.writeFileSync(TRADES_PATH, JSON.stringify(trades, null, 2) + '\n');
		console.log('Done!');
	}
}

main();
