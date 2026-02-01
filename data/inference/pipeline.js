/**
 * Inference Pipeline
 * 
 * Demonstrates how to use the facts layer and inference engine together.
 * This can be run standalone to analyze data quality or integrated
 * into the seeding process.
 */

var facts = require('../facts');
var inference = require('./index');

/**
 * Load all facts from available sources.
 * 
 * @param {object} options - Loading options
 * @returns {Promise<object>} All loaded facts
 */
async function loadAllFacts(options) {
	options = options || {};
	
	console.log('Loading facts from all sources...\n');
	
	var result = {
		snapshots: [],
		cuts: [],
		drafts: [],
		trades: [],
		sleeperTransactions: [],
		fantraxTransactions: []
	};
	
	// Load snapshots (local files, synchronous)
	console.log('  Loading snapshots...');
	var snapshotYears = facts.snapshots.getAvailableYears();
	result.snapshots = facts.snapshots.loadAll();
	console.log('    Found ' + result.snapshots.length + ' contracts across ' + snapshotYears.length + ' years');
	
	// Load Sleeper transactions (local files, synchronous)
	console.log('  Loading Sleeper transactions...');
	var sleeperYears = facts.sleeper.getAvailableYears();
	result.sleeperTransactions = facts.sleeper.loadAll();
	console.log('    Found ' + result.sleeperTransactions.length + ' transactions for ' + sleeperYears.join(', '));
	
	// Check Fantrax availability
	console.log('  Checking Fantrax data...');
	var fantraxAvail = facts.fantrax.checkAvailability();
	if (fantraxAvail.available) {
		result.fantraxTransactions = facts.fantrax.loadAll();
		console.log('    Found ' + result.fantraxTransactions.length + ' transactions');
	} else {
		console.log('    Not available (provide data in data/fantrax/)');
	}
	
	// Load trades from WordPress (async, requires network)
	if (!options.skipNetwork) {
		console.log('  Fetching trades from WordPress...');
		try {
			result.trades = await facts.trades.fetchAll();
			console.log('    Found ' + result.trades.length + ' trades');
		} catch (err) {
			console.log('    Error fetching trades:', err.message);
		}
	}
	
	// Load cuts from Google Sheets (async, requires network + API key)
	if (!options.skipNetwork && options.apiKey) {
		console.log('  Fetching cuts from Google Sheets...');
		try {
			result.cuts = await facts.cuts.fetchAll(options.apiKey);
			console.log('    Found ' + result.cuts.length + ' cuts');
		} catch (err) {
			console.log('    Error fetching cuts:', err.message);
		}
	}
	
	// Load drafts from Google Sheets (async, requires network + API key)
	if (!options.skipNetwork && options.apiKey) {
		console.log('  Fetching drafts from Google Sheets...');
		try {
			var currentYear = new Date().getFullYear();
			result.drafts = await facts.drafts.fetchAll(options.apiKey, currentYear);
			console.log('    Found ' + result.drafts.length + ' draft picks');
		} catch (err) {
			console.log('    Error fetching drafts:', err.message);
		}
	}
	
	console.log('');
	return result;
}

/**
 * Run constraint checks on loaded facts.
 * 
 * @param {object} allFacts - Loaded facts
 * @returns {object} Constraint check results
 */
function checkConstraints(allFacts) {
	console.log('Checking constraints...\n');
	
	var result = inference.constraints.checkAll({
		snapshots: allFacts.snapshots,
		cuts: allFacts.cuts
	});
	
	console.log('  Violations found: ' + result.total);
	Object.keys(result.summary).forEach(function(constraint) {
		if (result.summary[constraint] > 0) {
			console.log('    ' + constraint + ': ' + result.summary[constraint]);
		}
	});
	console.log('');
	
	return result;
}

/**
 * Infer contract terms for all trades.
 * 
 * @param {object} allFacts - Loaded facts
 * @returns {object} Inference results
 */
function inferContractTerms(allFacts) {
	console.log('Inferring contract terms...\n');
	
	// Run inference on trades
	var enhancedTrades = inference.contractTerm.inferTradeContracts(allFacts.trades, {
		snapshots: allFacts.snapshots,
		drafts: allFacts.drafts
	});
	
	// Get statistics
	var stats = inference.contractTerm.getInferenceStats(enhancedTrades);
	
	console.log('  Total players in trades: ' + stats.total);
	console.log('  Certain (explicit): ' + stats.certain + ' (' + Math.round(stats.certain / stats.total * 100) + '%)');
	console.log('  Inferred (heuristic): ' + stats.inferred + ' (' + Math.round(stats.inferred / stats.total * 100) + '%)');
	console.log('  Ambiguous (needs resolution): ' + stats.ambiguous + ' (' + Math.round(stats.ambiguous / stats.total * 100) + '%)');
	console.log('');
	
	return {
		trades: enhancedTrades,
		stats: stats
	};
}

/**
 * Collect ambiguities for review.
 * 
 * @param {object} inferenceResult - Result from inferContractTerms
 * @returns {object} Ambiguity collector and report
 */
function collectAmbiguities(inferenceResult) {
	var collector = new inference.AmbiguityCollector();
	
	inferenceResult.trades.forEach(function(trade) {
		trade.parties.forEach(function(party) {
			party.players.forEach(function(player) {
				if (player.confidence === 'ambiguous') {
					collector.addContractTerm(
						player.name,
						trade.tradeId,
						trade.date,
						[], // Possible values would require more analysis
						player.inferenceReason
					);
				}
			});
		});
	});
	
	return {
		collector: collector,
		report: inference.ambiguity.formatForReview(collector)
	};
}

/**
 * Run the full pipeline.
 * 
 * @param {object} options - Pipeline options
 * @returns {Promise<object>} Pipeline results
 */
async function run(options) {
	options = options || {};
	
	console.log('=== Constraint-Based Data Reconstruction Pipeline ===\n');
	
	// Step 1: Load facts
	var allFacts = await loadAllFacts(options);
	
	// Step 2: Check constraints
	var constraintResult = checkConstraints(allFacts);
	
	// Step 3: Infer contract terms
	var inferenceResult = { trades: [], stats: { total: 0, certain: 0, inferred: 0, ambiguous: 0 } };
	if (allFacts.trades.length > 0) {
		inferenceResult = inferContractTerms(allFacts);
	}
	
	// Step 4: Collect ambiguities
	var ambiguityResult = collectAmbiguities(inferenceResult);
	
	// Summary
	console.log('=== Summary ===\n');
	console.log('Facts loaded:');
	console.log('  Snapshots: ' + allFacts.snapshots.length);
	console.log('  Trades: ' + allFacts.trades.length);
	console.log('  Cuts: ' + allFacts.cuts.length);
	console.log('  Drafts: ' + allFacts.drafts.length);
	console.log('  Sleeper transactions: ' + allFacts.sleeperTransactions.length);
	console.log('');
	console.log('Constraint violations: ' + constraintResult.total);
	console.log('Ambiguous inferences: ' + ambiguityResult.collector.count());
	console.log('');
	
	return {
		facts: allFacts,
		constraints: constraintResult,
		inference: inferenceResult,
		ambiguities: ambiguityResult
	};
}

/**
 * CLI entry point.
 */
async function main() {
	var skipNetwork = process.argv.includes('--skip-network') || process.argv.includes('--local');
	var apiKey = process.env.GOOGLE_API_KEY;
	
	try {
		var result = await run({
			skipNetwork: skipNetwork,
			apiKey: apiKey
		});
		
		// Print ambiguity report if requested
		if (process.argv.includes('--show-ambiguities')) {
			console.log(result.ambiguities.report);
		}
		
		process.exit(0);
	} catch (err) {
		console.error('Pipeline error:', err);
		process.exit(1);
	}
}

// Export for programmatic use
module.exports = {
	loadAllFacts: loadAllFacts,
	checkConstraints: checkConstraints,
	inferContractTerms: inferContractTerms,
	collectAmbiguities: collectAmbiguities,
	run: run
};

// Run if called directly
if (require.main === module) {
	main();
}
