/**
 * Omnibus Seeder - Main entry point for database seeding.
 * 
 * This script orchestrates the full seeding process, building the database
 * from JSON data files: drafts.json, auctions.json, trades.json, fa.json.
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
var Pick = require('../../models/Pick');

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
	
	// Clear picks
	console.log('Clearing picks...');
	var pickResult = await Pick.deleteMany({});
	console.log('  Deleted', pickResult.deletedCount, 'picks');
	
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

async function seedDrafts() {
	console.log('========================================');
	console.log('       Seeding Drafts');
	console.log('========================================\n');
	
	// Creates Pick records + draft-select/draft-pass transactions
	runScript('Drafts', 'data/seed/drafts-from-json.js');
}

async function seedAuctions() {
	console.log('========================================');
	console.log('       Seeding Auctions');
	console.log('========================================\n');
	
	// Creates auction-ufa + contract transactions
	runScript('Auctions', 'data/seed/auctions-from-json.js');
}

async function seedTrades() {
	console.log('========================================');
	console.log('       Seeding Trades');
	console.log('========================================\n');
	
	// Creates trade transactions with full party details
	runScript('Trades', 'data/seed/trades.js');
}

async function seedFA() {
	console.log('========================================');
	console.log('       Seeding FA Transactions');
	console.log('========================================\n');
	
	// Creates fa transactions (pickups and drops)
	runScript('FA', 'data/seed/fa-from-json.js');
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
	console.log('[Full seeding from JSON files]\n');
	
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
	
	// Seed from JSON files in dependency order:
	// 1. Drafts (creates Pick records + draft transactions)
	await seedDrafts();
	
	// 2. Auctions (creates auction + contract transactions)
	await seedAuctions();
	
	// 3. Trades (creates trade transactions with full party details)
	await seedTrades();
	
	// 4. FA transactions (pickups and drops)
	await seedFA();
	
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
