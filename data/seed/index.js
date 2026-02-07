/**
 * Omnibus Seeder - Main entry point for database seeding.
 * 
 * This script orchestrates the full seeding process, building the database
 * from the player-history DSL file.
 * 
 * Usage:
 *   docker compose run --rm -it web node data/seed
 *   docker compose run --rm -it web node data/seed --foundation-only
 *   docker compose run --rm -it web node data/seed --validate-only
 *   docker compose run --rm -it web node data/seed --skip-clear
 * 
 * Options:
 *   --foundation-only   Only seed entities (franchises, regimes, persons)
 *   --skip-foundation   Skip foundation seeding (use existing entities)
 *   --skip-clear        Don't clear existing transactions before seeding
 *   --validate-only     Just run validation without seeding
 */

require('dotenv').config();

var mongoose = require('mongoose');
var { spawnSync } = require('child_process');
var path = require('path');

var Transaction = require('../../models/Transaction');
var Player = require('../../models/Player');
var Contract = require('../../models/Contract');

mongoose.connect(process.env.MONGODB_URI);

// Parse command line arguments
var args = {
	foundationOnly: process.argv.includes('--foundation-only'),
	validateOnly: process.argv.includes('--validate-only'),
	skipClear: process.argv.includes('--skip-clear'),
	skipFoundation: process.argv.includes('--skip-foundation')
};

/**
 * Clear all transaction data for a fresh start.
 */
async function clearAllTransactions() {
	console.log('Clearing all transactions...');
	var result = await Transaction.deleteMany({});
	console.log('  Deleted', result.deletedCount, 'transactions');
	
	// Clear contracts (will be rebuilt from current state after seeding)
	console.log('Clearing contracts...');
	var contractResult = await Contract.deleteMany({});
	console.log('  Deleted', contractResult.deletedCount, 'contracts');
	
	// Also clear historical players (those without sleeperId)
	console.log('Clearing historical players...');
	var playerResult = await Player.deleteMany({ sleeperId: null });
	console.log('  Deleted', playerResult.deletedCount, 'historical players');
	console.log('');
}

function runScript(name, script, extraArgs) {
	console.log('=== ' + name + ' ===\n');
	
	var scriptArgs = [script].concat(extraArgs || []);
	
	var result = spawnSync('node', scriptArgs, {
		stdio: 'inherit',
		cwd: process.cwd()
	});
	
	if (result.status !== 0) {
		throw new Error(name + ' failed with exit code ' + result.status);
	}
	
	console.log('');
}

function runValidator() {
	console.log('=== Final Validation ===\n');
	
	var result = spawnSync('node', ['data/analysis/player-chains.js', '--report'], {
		stdio: 'inherit',
		cwd: process.cwd()
	});
	
	return result.status === 0;
}

async function seedFoundation() {
	console.log('========================================');
	console.log('       Seeding Foundation');
	console.log('========================================\n');
	
	// Seed entities (franchises, regimes, persons)
	// Pass --clear to handle existing data
	runScript('Entities', 'data/seed/entities.js', ['--clear']);
}

async function seedFromDSL() {
	console.log('========================================');
	console.log('       Seeding from DSL');
	console.log('========================================\n');
	
	runScript('DSL Transactions', 'data/seed/from-dsl.js');
}

async function seedPicks() {
	console.log('========================================');
	console.log('       Seeding Picks');
	console.log('========================================\n');
	
	runScript('Draft Picks', 'data/seed/picks-local.js', ['--clear']);
}

async function run() {
	console.log('');
	console.log('╔══════════════════════════════════════╗');
	console.log('║       PSO Database Seeder            ║');
	console.log('╚══════════════════════════════════════╝');
	console.log('');
	
	// Validate only mode
	if (args.validateOnly) {
		console.log('[Validate only mode]\n');
		var valid = runValidator();
		process.exit(valid ? 0 : 1);
	}
	
	// Foundation only mode
	if (args.foundationOnly) {
		console.log('[Foundation only mode]\n');
		await seedFoundation();
		console.log('Foundation seeding complete.\n');
		process.exit(0);
	}
	
	// Full seeding
	console.log('[Full seeding from DSL]\n');
	
	// Clear everything first (unless skipped)
	if (!args.skipClear) {
		console.log('========================================');
		console.log('       Clearing Database');
		console.log('========================================\n');
		await clearAllTransactions();
	}
	
	// Seed foundation unless skipped
	if (!args.skipFoundation) {
		await seedFoundation();
	} else {
		console.log('[Skipping foundation - using existing entities]\n');
	}
	
	// Seed draft picks first (DSL needs them for linking)
	await seedPicks();
	
	// Seed transactions from DSL
	await seedFromDSL();
	
	// Final validation
	var valid = runValidator();
	
	console.log('========================================');
	console.log('       Seeding Complete');
	console.log('========================================\n');
	
	if (!valid) {
		console.log('WARNING: Validation found issues.\n');
		process.exit(1);
	}
	
	process.exit(0);
}

run().catch(function(err) {
	console.error('Error:', err);
	process.exit(1);
});
