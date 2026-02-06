/**
 * Seed all 2009 transactions in the correct order.
 * 
 * This script orchestrates the full 2009 seeding process:
 *   1. Clear existing 2009 transactions
 *   2. Offseason trades (Trade 7)
 *   3. Rookie draft
 *   4. Auction
 *   5. In-auction trades (Trades 8-9)
 *   6. Contracts
 *   7. In-season trades (Trades 10-16)
 *   8. Cuts (FA pickups not tracked for pre-2014 seasons)
 *   9. RFA rights conveyance (or rfa-unknown for cut players)
 *   10. Validate player chains
 * 
 * Usage:
 *   docker compose run --rm -it web node data/seed/season-2009.js
 *   docker compose run --rm -it web node data/seed/season-2009.js --skip-clear
 *   docker compose run --rm -it web node data/seed/season-2009.js --validate-only
 */

require('dotenv').config();

var mongoose = require('mongoose');
var { spawnSync } = require('child_process');

var Transaction = require('../../models/Transaction');

mongoose.connect(process.env.MONGODB_URI);

var skipClear = process.argv.includes('--skip-clear');
var validateOnly = process.argv.includes('--validate-only');

async function clearTransactions() {
	console.log('=== Clearing 2009 Transactions ===\n');
	
	var result = await Transaction.deleteMany({
		timestamp: { $gte: new Date('2009-01-01'), $lt: new Date('2010-01-01') }
	});
	
	console.log('Deleted', result.deletedCount, 'transactions\n');
}

function runSeeder(name, script, args) {
	console.log('=== ' + name + ' ===\n');
	
	var cmdArgs = [script].concat(args || []);
	var result = spawnSync('node', cmdArgs, {
		stdio: 'inherit',
		cwd: process.cwd()
	});
	
	if (result.status !== 0) {
		throw new Error(name + ' failed with exit code ' + result.status);
	}
	
	console.log('');
}

function runValidator() {
	console.log('=== Validating Player Chains ===\n');
	
	var result = spawnSync('node', ['data/analysis/player-chains.js', '--report'], {
		stdio: 'inherit',
		cwd: process.cwd()
	});
	
	return result.status === 0;
}

async function run() {
	console.log('========================================');
	console.log('       2009 Season Seeder');
	console.log('========================================\n');
	
	if (validateOnly) {
		console.log('[Validate only mode]\n');
		runValidator();
		process.exit(0);
	}
	
	// Step 1: Clear existing transactions
	if (!skipClear) {
		await clearTransactions();
	} else {
		console.log('[Skipping clear]\n');
	}
	
	// Step 2: Offseason trades (Trade 7 - July 29)
	runSeeder('Offseason Trades', 'data/seed/trades-2009.js', ['--period=offseason']);
	
	// Step 3: Rookie draft (Aug 15)
	runSeeder('Rookie Draft', 'data/seed/draft-2009.js');
	
	// Step 4: Auction (Aug 16)
	runSeeder('Auction', 'data/seed/auction-2009.js');
	
	// Step 5: In-auction trades (Trades 8-9, before contracts)
	runSeeder('Auction-Period Trades', 'data/seed/trades-2009.js', ['--period=auction']);
	
	// Step 6: Contracts (Sept 2)
	runSeeder('Contracts', 'data/seed/contracts-2009.js');
	
	// Step 7: In-season trades (Trades 10-16)
	runSeeder('In-Season Trades', 'data/seed/trades-2009.js', ['--period=inseason']);
	
	// Step 8: Cuts (from centralized cuts.json)
	// Note: FA pickups are not tracked for pre-2014 seasons
	runSeeder('Cuts', 'data/seed/cuts.js', ['--year=2009']);
	
	// Step 9: RFA rights conveyance (Jan 15, 2010)
	// Creates rfa-unknown for players whose chain ends in a cut
	runSeeder('RFA Rights', 'data/seed/rfa-2009.js');
	
	// Step 10: Validate
	var valid = runValidator();
	
	console.log('========================================');
	console.log('       2009 Seeding Complete');
	console.log('========================================\n');
	
	if (!valid) {
		console.log('WARNING: Validation found issues. Review the report above.\n');
		process.exit(1);
	}
	
	process.exit(0);
}

run().catch(function(err) {
	console.error('Error:', err);
	process.exit(1);
});
