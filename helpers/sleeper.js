var PSO = require('../config/pso');
var notifications = require('./notifications');

var SLEEPER_MAX_BUDGET = 10000;
var SLEEPER_DISPLAY_OFFSET = 1000;

/**
 * Check if we're allowed to make mutations to Sleeper.
 * Only allowed in production to prevent dev from modifying real league data.
 */
function canMutate() {
	return process.env.NODE_ENV === 'production';
}

/**
 * Get the Sleeper league ID for the current season.
 */
function getLeagueId() {
	return PSO.sleeperLeagueIds[PSO.season];
}

/**
 * Make a GraphQL request to Sleeper.
 * 
 * @param {string} operationName - The GraphQL operation name
 * @param {string} query - The GraphQL query/mutation
 * @param {Object} variables - Query variables
 * @returns {Promise<Object>} The response data
 */
async function graphqlRequest(operationName, query, variables) {
	var jwt = process.env.SLEEPER_JWT;
	if (!jwt) {
		throw new Error('SLEEPER_JWT not configured');
	}

	var response = await fetch('https://sleeper.com/graphql', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'Accept': 'application/json',
			'Authorization': jwt,
			'Origin': 'https://sleeper.com',
			'Referer': 'https://sleeper.com/',
			'X-Sleeper-GraphQL-Op': operationName,
			'User-Agent': 'Mozilla/5.0'
		},
		body: JSON.stringify({
			operationName: operationName,
			query: query,
			variables: variables
		})
	});

	var data = await response.json();
	if (data.errors) {
		throw new Error('Sleeper GraphQL error: ' + data.errors[0].message);
	}
	return data;
}

/**
 * Fetch current roster settings from Sleeper REST API.
 * 
 * @returns {Promise<Object>} Map of rosterId -> { waiver_budget_used, waiver_position }
 */
async function fetchRosterSettings() {
	var leagueId = getLeagueId();
	if (!leagueId) {
		throw new Error('No Sleeper league ID configured for season ' + PSO.season);
	}

	var response = await fetch('https://api.sleeper.app/v1/league/' + leagueId + '/rosters');
	if (!response.ok) {
		throw new Error('Failed to fetch Sleeper rosters: ' + response.status);
	}

	var rosters = await response.json();
	var result = {};
	rosters.forEach(function(r) {
		result[r.roster_id] = {
			waiver_budget_used: r.settings ? r.settings.waiver_budget_used : 0,
			waiver_position: r.settings ? r.settings.waiver_position : 1
		};
	});
	return result;
}

/**
 * Fetch full roster data from Sleeper REST API including players.
 * 
 * @returns {Promise<Object>} Map of rosterId -> { players: [sleeperId, ...], settings: {...} }
 */
async function fetchSleeperRosters() {
	var leagueId = getLeagueId();
	if (!leagueId) {
		throw new Error('No Sleeper league ID configured for season ' + PSO.season);
	}

	var response = await fetch('https://api.sleeper.app/v1/league/' + leagueId + '/rosters');
	if (!response.ok) {
		throw new Error('Failed to fetch Sleeper rosters: ' + response.status);
	}

	var rosters = await response.json();
	var result = {};
	rosters.forEach(function(r) {
		result[r.roster_id] = {
			players: r.players || [],
			settings: r.settings || {}
		};
	});
	return result;
}

/**
 * Update a roster's FAAB budget on Sleeper.
 * 
 * @param {number} rosterId - The Sleeper roster ID
 * @param {number} waiverBudgetUsed - The waiver_budget_used value to set
 * @param {number} waiverPosition - The waiver_position to preserve
 */
async function updateRosterBudget(rosterId, waiverBudgetUsed, waiverPosition) {
	if (!canMutate()) {
		console.log('[SLEEPER] Skipping budget update for roster ' + rosterId + ' (not production)');
		return { skipped: true };
	}

	var leagueId = getLeagueId();
	var query = 'mutation roster_update_settings($k_settings: [String], $v_settings: [Float]) { roster_update_settings(league_id: "' + leagueId + '", roster_id: ' + rosterId + ', k_settings: $k_settings, v_settings: $v_settings) { roster_id settings } }';

	return graphqlRequest('roster_update_settings', query, {
		k_settings: ['waiver_budget_used', 'waiver_position'],
		v_settings: [waiverBudgetUsed, waiverPosition]
	});
}

/**
 * Execute a commissioner roster transaction (player movements).
 * 
 * @param {Object} params
 * @param {string[]} params.k_adds - Player IDs being added
 * @param {number[]} params.v_adds - Roster IDs receiving those players
 * @param {string[]} params.k_drops - Player IDs being removed
 * @param {number[]} params.v_drops - Roster IDs losing those players
 */
async function executeRosterTransaction(params) {
	if (!canMutate()) {
		console.log('[SLEEPER] Skipping roster transaction (not production)');
		console.log('[SLEEPER]   k_adds:', params.k_adds, 'v_adds:', params.v_adds);
		console.log('[SLEEPER]   k_drops:', params.k_drops, 'v_drops:', params.v_drops);
		return { skipped: true };
	}

	var leagueId = getLeagueId();
	var query = 'mutation league_create_transaction($k_adds: [String], $v_adds: [Int], $k_drops: [String], $v_drops: [Int]) { league_create_transaction(league_id: "' + leagueId + '", type: "commissioner", k_adds: $k_adds, v_adds: $v_adds, k_drops: $k_drops, v_drops: $v_drops) { status transaction_id adds drops } }';

	return graphqlRequest('league_create_transaction', query, {
		k_adds: params.k_adds,
		v_adds: params.v_adds,
		k_drops: params.k_drops,
		v_drops: params.v_drops
	});
}

/**
 * Sync budgets for specific franchises to Sleeper.
 * Only sends updates if the values actually differ.
 * 
 * @param {Array<{franchiseId: ObjectId, rosterId: number, available: number}>} franchises - Franchises to sync
 * @returns {Promise<{synced: number, skipped: number, errors: string[]}>}
 */
async function syncBudgets(franchises) {
	var result = { synced: 0, skipped: 0, errors: [] };

	if (franchises.length === 0) {
		return result;
	}

	var currentSettings;
	try {
		currentSettings = await fetchRosterSettings();
	} catch (err) {
		result.errors.push('Failed to fetch current Sleeper settings: ' + err.message);
		return result;
	}

	for (var i = 0; i < franchises.length; i++) {
		var franchise = franchises[i];
		var current = currentSettings[franchise.rosterId];

		if (!current) {
			result.errors.push('No Sleeper roster found for rosterId ' + franchise.rosterId);
			continue;
		}

		var sleeperDisplayAvailable = SLEEPER_DISPLAY_OFFSET + franchise.available;
		var waiverBudgetUsed = SLEEPER_MAX_BUDGET - sleeperDisplayAvailable;

		if (waiverBudgetUsed < 0) {
			waiverBudgetUsed = 0;
		}

		if (current.waiver_budget_used === waiverBudgetUsed) {
			result.skipped++;
			continue;
		}

		try {
			await updateRosterBudget(franchise.rosterId, waiverBudgetUsed, current.waiver_position);
			result.synced++;
		} catch (err) {
			result.errors.push('Failed to update roster ' + franchise.rosterId + ': ' + err.message);
		}
	}

	return result;
}

/**
 * Sync a trade's player movements to Sleeper.
 * 
 * @param {Array<{sleeperId: string, fromRosterId: number, toRosterId: number}>} movements - Player movements
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function syncTradeMovements(movements) {
	if (movements.length === 0) {
		return { success: true };
	}

	var k_adds = [];
	var v_adds = [];
	var k_drops = [];
	var v_drops = [];

	for (var i = 0; i < movements.length; i++) {
		var m = movements[i];
		k_adds.push(m.sleeperId);
		v_adds.push(m.toRosterId);
		k_drops.push(m.sleeperId);
		v_drops.push(m.fromRosterId);
	}

	try {
		await executeRosterTransaction({ k_adds: k_adds, v_adds: v_adds, k_drops: k_drops, v_drops: v_drops });
		return { success: true };
	} catch (err) {
		return { success: false, error: err.message };
	}
}

/**
 * Alert commissioner about a Sleeper sync failure.
 */
async function alertSyncFailure(context, error) {
	var message = 'Sleeper sync failed!\n\n' +
		'Context: ' + context + '\n' +
		'Error: ' + error;
	
	return notifications.alertCommissioner(message, { priority: 'urgent' });
}

module.exports = {
	getLeagueId: getLeagueId,
	fetchRosterSettings: fetchRosterSettings,
	fetchSleeperRosters: fetchSleeperRosters,
	syncBudgets: syncBudgets,
	syncTradeMovements: syncTradeMovements,
	alertSyncFailure: alertSyncFailure,
	SLEEPER_MAX_BUDGET: SLEEPER_MAX_BUDGET,
	SLEEPER_DISPLAY_OFFSET: SLEEPER_DISPLAY_OFFSET
};
