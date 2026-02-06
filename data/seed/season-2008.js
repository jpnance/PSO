/**
 * Seed all 2008 transactions in the correct order.
 * 
 * This script orchestrates the full 2008 seeding process:
 *   1. Clear existing 2008 transactions
 *   2. Seed auction results and contracts
 *   3. Seed trades
 *   4. Seed FA activity (cuts and pickups)
 *   5. Validate player chains
 * 
 * Usage:
 *   docker compose run --rm -it web node data/seed/season-2008.js
 *   docker compose run --rm -it web node data/seed/season-2008.js --skip-clear
 *   docker compose run --rm -it web node data/seed/season-2008.js --validate-only
 */

require('dotenv').config();

var mongoose = require('mongoose');
var { execSync, spawnSync } = require('child_process');

var Transaction = require('../../models/Transaction');

mongoose.connect(process.env.MONGODB_URI);

var skipClear = process.argv.includes('--skip-clear');
var validateOnly = process.argv.includes('--validate-only');

async function clearTransactions() {
	console.log('=== Clearing 2008 Transactions ===\n');
	
	var result = await Transaction.deleteMany({
		timestamp: { $gte: new Date('2008-01-01'), $lt: new Date('2009-01-01') }
	});
	
	console.log('Deleted', result.deletedCount, 'transactions\n');
}

function runSeeder(name, script) {
	console.log('=== ' + name + ' ===\n');
	
	var result = spawnSync('node', [script], {
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
	console.log('       2008 Season Seeder');
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
	
	// Step 2: Seed auction and contracts
	runSeeder('Auction & Contracts', 'data/seed/auction-2008.js');
	
	// Step 3: Seed FA activity (before trades - FA pickups happen before mid-season trades)
	runSeeder('Free Agent Activity', 'data/seed/fa-2008.js');
	
	// Step 4: Seed trades (after FA - some traded players were FA pickups first)
	runSeeder('Trades', 'data/seed/trades-2008.js');
	
	// Step 5: Validate
	var valid = runValidator();
	
	console.log('========================================');
	console.log('       2008 Seeding Complete');
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
