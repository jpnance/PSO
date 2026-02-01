/**
 * Unit tests for Sleeper facts parser.
 * 
 * Usage: node tests/facts/sleeper-facts.test.js
 */

var sleeperFacts = require('../../data/facts/sleeper-facts');

var passed = 0;
var failed = 0;

function test(name, fn) {
	try {
		fn();
		console.log('✓', name);
		passed++;
	} catch (err) {
		console.log('✗', name);
		console.log('  Error:', err.message);
		failed++;
	}
}

function assertEqual(actual, expected, msg) {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error((msg || 'Assertion failed') + 
			'\n  Expected: ' + JSON.stringify(expected) + 
			'\n  Actual: ' + JSON.stringify(actual));
	}
}

function assertTrue(condition, msg) {
	if (!condition) {
		throw new Error(msg || 'Expected true but got false');
	}
}

// === Tests ===

test('parseTransaction parses waiver transaction', function() {
	var tx = {
		transaction_id: '123',
		type: 'waiver',
		status: 'complete',
		created: 1735411088858,
		league_id: 'league123',
		leg: 17,
		roster_ids: [3],
		adds: { '7083': 3 },
		drops: { '827': 3 },
		player_map: {
			'7083': { first_name: 'Tyler', last_name: 'Huntley', position: 'QB', team: 'BAL' },
			'827': { first_name: 'Tyrod', last_name: 'Taylor', position: 'QB', team: 'NYJ' }
		},
		settings: { waiver_bid: 33 },
		metadata: { notes: 'Waiver claim processed' }
	};
	
	var result = sleeperFacts.parseTransaction(tx);
	
	assertEqual(result.transactionId, '123');
	assertEqual(result.type, 'waiver');
	assertEqual(result.status, 'complete');
	assertEqual(result.week, 17);
	assertEqual(result.waiverBid, 33);
	assertEqual(result.adds.length, 1);
	assertEqual(result.adds[0].playerId, '7083');
	assertEqual(result.adds[0].rosterId, 3);
	assertEqual(result.adds[0].playerName, 'Tyler Huntley');
	assertEqual(result.drops.length, 1);
	assertEqual(result.drops[0].playerId, '827');
	assertEqual(result.drops[0].playerName, 'Tyrod Taylor');
});

test('parseTransaction parses trade with draft picks', function() {
	var tx = {
		transaction_id: '456',
		type: 'trade',
		status: 'complete',
		created: 1700000000000,
		roster_ids: [1, 2],
		consenter_ids: [1, 2],
		adds: { 'player1': 2 },
		drops: null,
		draft_picks: [
			{ season: 2025, round: 1, roster_id: 1, previous_owner_id: 2, owner_id: 1 }
		],
		waiver_budget: [
			{ sender: 1, receiver: 2, amount: 50 }
		]
	};
	
	var result = sleeperFacts.parseTransaction(tx);
	
	assertEqual(result.type, 'trade');
	assertEqual(result.rosterIds.length, 2);
	assertEqual(result.draftPicks.length, 1);
	assertEqual(result.draftPicks[0].season, 2025);
	assertEqual(result.draftPicks[0].round, 1);
	assertEqual(result.waiverBudget.length, 1);
	assertEqual(result.waiverBudget[0].amount, 50);
});

test('parseTransaction handles empty adds/drops', function() {
	var tx = {
		transaction_id: '789',
		type: 'free_agent',
		status: 'complete',
		created: 1700000000000,
		adds: null,
		drops: null
	};
	
	var result = sleeperFacts.parseTransaction(tx);
	
	assertEqual(result.adds.length, 0);
	assertEqual(result.drops.length, 0);
});

test('getAvailableYears finds transaction files', function() {
	var years = sleeperFacts.getAvailableYears();
	
	assertTrue(years.length > 0, 'Should find at least one year');
	assertTrue(years.indexOf(2024) >= 0, 'Should include 2024');
});

test('loadSeason loads real 2024 data', function() {
	var transactions = sleeperFacts.loadSeason(2024);
	
	assertTrue(transactions.length > 0, 'Should have transactions');
	assertTrue(transactions[0].type !== undefined, 'Should have type');
	assertTrue(transactions[0].timestamp instanceof Date, 'Should have timestamp as Date');
});

test('filterByType filters correctly', function() {
	var transactions = [
		{ type: 'trade' },
		{ type: 'waiver' },
		{ type: 'trade' },
		{ type: 'free_agent' }
	];
	
	var trades = sleeperFacts.filterByType(transactions, 'trade');
	assertEqual(trades.length, 2);
	
	var fa = sleeperFacts.filterByType(transactions, ['waiver', 'free_agent']);
	assertEqual(fa.length, 2);
});

test('getTrades returns only trades', function() {
	var transactions = [
		{ type: 'trade' },
		{ type: 'waiver' },
		{ type: 'trade' }
	];
	
	var trades = sleeperFacts.getTrades(transactions);
	assertEqual(trades.length, 2);
});

test('getSummary returns correct stats', function() {
	var transactions = [
		{ type: 'trade', season: 2024 },
		{ type: 'waiver', season: 2024 },
		{ type: 'trade', season: 2023 }
	];
	
	var summary = sleeperFacts.getSummary(transactions);
	
	assertEqual(summary.total, 3);
	assertEqual(summary.byType.trade, 2);
	assertEqual(summary.byType.waiver, 1);
	assertEqual(summary.bySeason['2024'], 2);
	assertEqual(summary.bySeason['2023'], 1);
});

// === Summary ===

console.log('\n--- Summary ---');
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
