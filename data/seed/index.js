/**
 * Omnibus Seeder - Main entry point for database seeding.
 * 
 * This script orchestrates the full seeding process, building the database
 * from JSON data files: drafts.json, auctions.json, contracts.json, trades.json, fa.json, rfa.json.
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
var fs = require('fs');
var https = require('https');

var Transaction = require('../../models/Transaction');
var Player = require('../../models/Player');
var Contract = require('../../models/Contract');
var Pick = require('../../models/Pick');

mongoose.connect(process.env.MONGODB_URI);

var SLEEPER_DATA_FILE = path.join(__dirname, '../../public/data/sleeper-data.json');
var SLEEPER_MAX_AGE_DAYS = 7;
var SLEEPER_API_URL = 'https://api.sleeper.app/v1/players/nfl';

/**
 * Check if sleeper-data.json exists and is fresh (< 7 days old).
 * If not, fetch it from the Sleeper API.
 */
async function ensureSleeperData() {
	console.log('Checking Sleeper data...');
	
	var needsFetch = false;
	
	if (!fs.existsSync(SLEEPER_DATA_FILE)) {
		console.log('  Sleeper data not found. Fetching...');
		needsFetch = true;
	} else {
		var stats = fs.statSync(SLEEPER_DATA_FILE);
		var ageMs = Date.now() - stats.mtimeMs;
		var ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
		
		if (ageDays >= SLEEPER_MAX_AGE_DAYS) {
			console.log('  Sleeper data is ' + ageDays + ' day(s) old. Refreshing...');
			needsFetch = true;
		} else {
			console.log('  Sleeper data is ' + ageDays + ' day(s) old (max: ' + SLEEPER_MAX_AGE_DAYS + '). Using cached.');
		}
	}
	
	if (needsFetch) {
		await fetchSleeperData();
	}
	
	console.log('');
}

/**
 * Fetch player data from Sleeper API and save to file.
 */
function fetchSleeperData() {
	return new Promise(function(resolve, reject) {
		console.log('  Fetching from ' + SLEEPER_API_URL + '...');
		
		https.get(SLEEPER_API_URL, function(res) {
			if (res.statusCode !== 200) {
				reject(new Error('Sleeper API returned status ' + res.statusCode));
				return;
			}
			
			var data = '';
			res.on('data', function(chunk) { data += chunk; });
			res.on('end', function() {
				// Ensure directory exists
				var dir = path.dirname(SLEEPER_DATA_FILE);
				if (!fs.existsSync(dir)) {
					fs.mkdirSync(dir, { recursive: true });
				}
				
				fs.writeFileSync(SLEEPER_DATA_FILE, data);
				var sizeMb = (data.length / 1024 / 1024).toFixed(1);
				console.log('  Saved ' + sizeMb + ' MB to ' + SLEEPER_DATA_FILE);
				resolve();
			});
		}).on('error', reject);
	});
}

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
	
	// Clear ALL players (will be re-synced from Sleeper, historical created by seeders)
	console.log('Clearing all players...');
	var playerResult = await Player.deleteMany({});
	console.log('  Deleted', playerResult.deletedCount, 'players');
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

async function syncPlayers() {
	console.log('========================================');
	console.log('       Syncing Players from Sleeper');
	console.log('========================================\n');
	
	// Sync players from sleeper-data.json (must exist in public/data/)
	// This creates/updates Player documents with sleeperId, name, positions, etc.
	runScript('Players', 'data/maintenance/sync-players.js');
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
	
	// Creates auction-ufa transactions (actual auction wins)
	runScript('Auctions', 'data/seed/auctions-from-json.js');
}

async function seedContracts() {
	console.log('========================================');
	console.log('       Seeding Contracts');
	console.log('========================================\n');
	
	// Creates contract transactions for all signed contracts
	runScript('Contracts', 'data/seed/contracts-from-json.js');
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

async function seedRFA() {
	console.log('========================================');
	console.log('       Seeding RFA Transactions');
	console.log('========================================\n');
	
	// Creates rfa-rights-conversion, contract-expiry, rfa-unknown transactions
	runScript('RFA', 'data/seed/rfa-from-json.js');
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
	
	// Ensure Sleeper data is available and fresh, then sync players
	await ensureSleeperData();
	await syncPlayers();
	
	// Seed from JSON files in dependency order:
	// 1. Drafts (creates Pick records + draft transactions)
	await seedDrafts();
	
	// 2. Auctions (creates auction-ufa transactions)
	await seedAuctions();
	
	// 3. Contracts (creates contract transactions for all signed contracts)
	await seedContracts();
	
	// 4. Trades (creates trade transactions with full party details)
	await seedTrades();
	
	// 5. FA transactions (pickups and drops)
	await seedFA();
	
	// 6. RFA transactions (contract expiries and RFA rights conversions)
	await seedRFA();
	
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
