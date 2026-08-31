#!/usr/bin/env node

/**
 * Sync PSO FAAB budgets to Sleeper.
 * 
 * Reads the current Budget.available for each franchise from PSO's database,
 * then updates Sleeper's waiver_budget_used accordingly.
 * 
 * Requires SLEEPER_JWT in .env.
 * 
 * Usage:
 *   runt pso-sync-budgets --dry-run
 *   runt pso-sync-budgets
 */

var dotenv = require('dotenv').config({ path: __dirname + '/../../.env' });
var mongoose = require('mongoose');

var Franchise = require('../../models/Franchise');
var Budget = require('../../models/Budget');
var PSO = require('../../config/pso');

var SLEEPER_JWT = process.env.SLEEPER_JWT;
var SLEEPER_LEAGUE_ID = process.env.SLEEPER_LEAGUE_ID;
var SLEEPER_MAX_BUDGET = 10000;
var SLEEPER_DISPLAY_OFFSET = 1000; // Sleeper shows 1000 + actual, so you see $1,XXX
var DRY_RUN = process.argv.includes('--dry-run');

if (!SLEEPER_JWT) {
	console.error('Error: SLEEPER_JWT not found in .env');
	console.error('Get your JWT from sleeper.com DevTools (Network tab, any /graphql request, Authorization header)');
	process.exit(1);
}

if (!SLEEPER_LEAGUE_ID) {
	var leagueId = PSO.sleeperLeagueIds[PSO.season];
	if (leagueId) {
		SLEEPER_LEAGUE_ID = leagueId;
		console.log('Using league ID from config:', SLEEPER_LEAGUE_ID);
	} else {
		console.error('Error: SLEEPER_LEAGUE_ID environment variable required (or set in config for season ' + PSO.season + ')');
		process.exit(1);
	}
}

async function fetchSleeperRosters() {
	var url = 'https://api.sleeper.app/v1/league/' + SLEEPER_LEAGUE_ID + '/rosters';
	var response = await fetch(url);
	if (!response.ok) {
		throw new Error('Failed to fetch Sleeper rosters: ' + response.status);
	}
	return response.json();
}

async function updateSleeperRoster(rosterId, waiverBudgetUsed, waiverPosition) {
	var response = await fetch('https://sleeper.com/graphql', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'Accept': 'application/json',
			'Authorization': SLEEPER_JWT,
			'Origin': 'https://sleeper.com',
			'Referer': 'https://sleeper.com/',
			'X-Sleeper-GraphQL-Op': 'roster_update_settings',
			'User-Agent': 'Mozilla/5.0'
		},
		body: JSON.stringify({
			operationName: 'roster_update_settings',
			variables: {
				k_settings: ['waiver_budget_used', 'waiver_position'],
				v_settings: [waiverBudgetUsed, waiverPosition]
			},
			query: 'mutation roster_update_settings($k_settings: [String], $v_settings: [Float]) { roster_update_settings(league_id: "' + SLEEPER_LEAGUE_ID + '", roster_id: ' + rosterId + ', k_settings: $k_settings, v_settings: $v_settings) { roster_id settings } }'
		})
	});

	var data = await response.json();
	if (data.errors) {
		throw new Error('GraphQL error for roster ' + rosterId + ': ' + data.errors[0].message);
	}
	return data;
}

async function main() {
	await mongoose.connect(process.env.MONGODB_URI);
	console.log('Connected to MongoDB');

	if (DRY_RUN) {
		console.log('DRY RUN - no changes will be made to Sleeper\n');
	}

	var franchises = await Franchise.find({ rosterId: { $ne: null } }).lean();
	var budgets = await Budget.find({ season: PSO.season }).lean();

	var budgetByFranchiseId = {};
	budgets.forEach(function(b) {
		budgetByFranchiseId[b.franchiseId.toString()] = b;
	});

	console.log('Fetching current Sleeper roster state...');
	var sleeperRosters = await fetchSleeperRosters();
	var sleeperByRosterId = {};
	sleeperRosters.forEach(function(r) {
		sleeperByRosterId[r.roster_id] = r;
	});

	console.log('\nSyncing budgets for season ' + PSO.season + ':\n');

	var updates = [];

	for (var i = 0; i < franchises.length; i++) {
		var franchise = franchises[i];
		var budget = budgetByFranchiseId[franchise._id.toString()];
		var sleeperRoster = sleeperByRosterId[franchise.rosterId];
		var franchiseName = PSO.franchiseNames[franchise.rosterId] ? PSO.franchiseNames[franchise.rosterId][PSO.season] : ('Franchise ' + franchise.rosterId);

		if (!budget) {
			console.log('  ' + franchiseName + ' (roster ' + franchise.rosterId + '): No budget found, skipping');
			continue;
		}

		if (!sleeperRoster) {
			console.log('  ' + franchiseName + ' (roster ' + franchise.rosterId + '): No Sleeper roster found, skipping');
			continue;
		}

		var psoAvailable = budget.available;
		var sleeperDisplayAvailable = SLEEPER_DISPLAY_OFFSET + psoAvailable; // e.g., $750 -> $1,750
		var waiverBudgetUsed = SLEEPER_MAX_BUDGET - sleeperDisplayAvailable;
		var currentWaiverPosition = sleeperRoster.settings ? sleeperRoster.settings.waiver_position : 1;
		var currentUsed = sleeperRoster.settings ? sleeperRoster.settings.waiver_budget_used : 0;

		if (waiverBudgetUsed < 0) {
			console.log('  ' + franchiseName + ': Warning - display available (' + sleeperDisplayAvailable + ') exceeds Sleeper max (' + SLEEPER_MAX_BUDGET + ')');
			waiverBudgetUsed = 0;
		}

		var currentSleeperDisplay = SLEEPER_MAX_BUDGET - currentUsed;
		var needsUpdate = currentUsed !== waiverBudgetUsed;

		console.log('  ' + franchiseName + ' (roster ' + franchise.rosterId + '):');
		console.log('    PSO available: $' + psoAvailable + ' -> Sleeper display: $' + sleeperDisplayAvailable);
		console.log('    Current Sleeper: $' + currentSleeperDisplay + ' (used: ' + currentUsed + ')');
		if (needsUpdate) {
			console.log('    -> Will set waiver_budget_used=' + waiverBudgetUsed + ' (position=' + currentWaiverPosition + ')');
			updates.push({
				rosterId: franchise.rosterId,
				franchiseName: franchiseName,
				waiverBudgetUsed: waiverBudgetUsed,
				waiverPosition: currentWaiverPosition
			});
		} else {
			console.log('    -> Already in sync');
		}
	}

	if (updates.length === 0) {
		console.log('\nAll rosters already in sync.');
	} else if (DRY_RUN) {
		console.log('\n' + updates.length + ' roster(s) would be updated (dry run).');
	} else {
		console.log('\nUpdating ' + updates.length + ' roster(s)...');
		for (var j = 0; j < updates.length; j++) {
			var update = updates[j];
			try {
				await updateSleeperRoster(update.rosterId, update.waiverBudgetUsed, update.waiverPosition);
				console.log('  Updated ' + update.franchiseName);
			} catch (err) {
				console.error('  Failed to update ' + update.franchiseName + ': ' + err.message);
			}
			if (j < updates.length - 1) {
				await new Promise(function(r) { setTimeout(r, 200); });
			}
		}
		console.log('\nDone.');
	}

	await mongoose.disconnect();
}

main().catch(function(err) {
	console.error(err);
	process.exit(1);
});
