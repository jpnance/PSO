/**
 * Omnibus Seeder - Main entry point for database seeding.
 * 
 * This script orchestrates the full seeding process, building the database
 * chronologically from the league's founding in 2008 to present.
 * 
 * Usage:
 *   docker compose run --rm -it web node data/seed
 *   docker compose run --rm -it web node data/seed --from=2008
 *   docker compose run --rm -it web node data/seed --season=2008
 *   docker compose run --rm -it web node data/seed --foundation-only
 *   docker compose run --rm -it web node data/seed --validate-only
 * 
 * Options:
 *   --foundation-only   Only seed entities (franchises, regimes, persons)
 *   --skip-foundation   Skip foundation seeding (use existing entities)
 *   --from=YEAR         Start seeding from this year (includes foundation)
 *   --season=YEAR       Only seed a specific season
 *   --skip-clear        Don't clear existing transactions before seeding
 *   --validate-only     Just run validation without seeding
 */

require('dotenv').config();

var mongoose = require('mongoose');
var { spawnSync } = require('child_process');
var path = require('path');

var Transaction = require('../../models/Transaction');
var Player = require('../../models/Player');

mongoose.connect(process.env.MONGODB_URI);

// Parse command line arguments
var args = {
	foundationOnly: process.argv.includes('--foundation-only'),
	validateOnly: process.argv.includes('--validate-only'),
	skipClear: process.argv.includes('--skip-clear'),
	skipFoundation: process.argv.includes('--skip-foundation'),
	fromYear: null,
	seasonYear: null
};

process.argv.forEach(function(arg) {
	var fromMatch = arg.match(/^--from=(\d{4})$/);
	if (fromMatch) args.fromYear = parseInt(fromMatch[1]);
	
	var seasonMatch = arg.match(/^--season=(\d{4})$/);
	if (seasonMatch) args.seasonYear = parseInt(seasonMatch[1]);
});

// Available season seeders
var SEASON_SEEDERS = {
	2008: 'data/seed/season-2008.js'
	// Future seasons will be added here:
	// 2009: 'data/seed/season-2009.js',
	// etc.
};

/**
 * Clear all transaction data for a fresh start.
 */
async function clearAllTransactions() {
	console.log('Clearing all transactions...');
	var result = await Transaction.deleteMany({});
	console.log('  Deleted', result.deletedCount, 'transactions');
	
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

async function seedSeason(year, skipClear) {
	var seeder = SEASON_SEEDERS[year];
	
	if (!seeder) {
		console.log('No seeder available for ' + year + '\n');
		return false;
	}
	
	console.log('========================================');
	console.log('       Seeding ' + year + ' Season');
	console.log('========================================\n');
	
	var extraArgs = [];
	if (skipClear || args.skipClear) extraArgs.push('--skip-clear');
	
	runScript(year + ' Season', seeder, extraArgs);
	return true;
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
	
	// Single season mode
	if (args.seasonYear) {
		console.log('[Single season mode: ' + args.seasonYear + ']\n');
		var success = await seedSeason(args.seasonYear, args.skipClear);
		process.exit(success ? 0 : 1);
	}
	
	// Foundation only mode
	if (args.foundationOnly) {
		console.log('[Foundation only mode]\n');
		await seedFoundation();
		console.log('Foundation seeding complete.\n');
		process.exit(0);
	}
	
	// Full seeding (or from a specific year)
	var startYear = args.fromYear || 2008;
	console.log('[Full seeding from ' + startYear + ']\n');
	
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
	
	// Seed each season (skip their individual clear since we already cleared)
	var years = Object.keys(SEASON_SEEDERS).map(Number).sort();
	var seededYears = [];
	
	for (var i = 0; i < years.length; i++) {
		var year = years[i];
		if (year >= startYear) {
			await seedSeason(year, true); // true = skip clear
			seededYears.push(year);
		}
	}
	
	// Final validation
	var valid = runValidator();
	
	console.log('========================================');
	console.log('       Seeding Complete');
	console.log('========================================\n');
	console.log('Seeded seasons:', seededYears.join(', ') || 'none');
	console.log('');
	
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
