/**
 * Unit tests for snapshot facts parser.
 * 
 * Usage: node tests/facts/snapshot-facts.test.js
 */

var snapshotFacts = require('../../data/facts/snapshot-facts');

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

test('parseContractsFile parses standard CSV row', function() {
	var content = 'ID,Owner,Player,Position,Start,End,Salary\n' +
	              '12345,Schex,Josh Allen,QB,2022,2024,$44';
	
	var contracts = snapshotFacts.parseContractsFile(2024, content);
	
	assertEqual(contracts.length, 1);
	assertEqual(contracts[0].season, 2024);
	assertEqual(contracts[0].espnId, '12345');
	assertEqual(contracts[0].owner, 'Schex');
	assertEqual(contracts[0].playerName, 'Josh Allen');
	assertEqual(contracts[0].position, 'QB');
	assertEqual(contracts[0].startYear, 2022);
	assertEqual(contracts[0].endYear, 2024);
	assertEqual(contracts[0].salary, 44);
});

test('parseContractsFile handles -1 ESPN ID as null', function() {
	var content = 'ID,Owner,Player,Position,Start,End,Salary\n' +
	              '-1,Koci,Player Name,WR,2023,2025,$10';
	
	var contracts = snapshotFacts.parseContractsFile(2024, content);
	
	assertEqual(contracts[0].espnId, null);
});

test('parseContractsFile skips empty owner (free agents)', function() {
	var content = 'ID,Owner,Player,Position,Start,End,Salary\n' +
	              '-1,Schex,Player One,QB,2022,2024,$10\n' +
	              '-1,,Free Agent,RB,2023,2023,$0\n' +
	              '-1,Koci,Player Two,WR,2023,2025,$20';
	
	var contracts = snapshotFacts.parseContractsFile(2024, content);
	
	assertEqual(contracts.length, 2);
	assertEqual(contracts[0].playerName, 'Player One');
	assertEqual(contracts[1].playerName, 'Player Two');
});

test('parseContractsFile handles multi-position', function() {
	var content = 'ID,Owner,Player,Position,Start,End,Salary\n' +
	              '-1,Nance,Dual Threat,DL/LB,2024,2026,$5';
	
	var contracts = snapshotFacts.parseContractsFile(2024, content);
	
	assertEqual(contracts[0].position, 'DL/LB');
});

test('getAvailableYears finds all contract files', function() {
	var result = snapshotFacts.getAvailableYears();
	
	assertTrue(result.years.length > 0, 'Should find at least one year');
	assertTrue(result.years.indexOf(2024) >= 0, 'Should include 2024');
	assertTrue(result.years.indexOf(2008) >= 0, 'Should include 2008');
	assertTrue(result.sources !== undefined, 'Should have sources');
});

test('loadSeason loads real 2024 data', function() {
	var contracts = snapshotFacts.loadSeason(2024);
	
	assertTrue(contracts.length > 100, 'Should have many contracts');
	assertTrue(contracts[0].season === 2024, 'Should all be 2024 season');
});

test('groupBySeason groups correctly', function() {
	var contracts = [
		{ season: 2023, playerName: 'A' },
		{ season: 2024, playerName: 'B' },
		{ season: 2023, playerName: 'C' }
	];
	
	var grouped = snapshotFacts.groupBySeason(contracts);
	
	assertEqual(grouped['2023'].length, 2);
	assertEqual(grouped['2024'].length, 1);
});

test('groupByPlayer groups correctly', function() {
	var contracts = [
		{ season: 2022, playerName: 'Josh Allen' },
		{ season: 2023, playerName: 'Josh Allen' },
		{ season: 2024, playerName: 'Lamar Jackson' }
	];
	
	var grouped = snapshotFacts.groupByPlayer(contracts);
	
	assertEqual(grouped['Josh Allen'].length, 2);
	assertEqual(grouped['Lamar Jackson'].length, 1);
});

test('findPlayerHistory finds player across seasons', function() {
	var contracts = snapshotFacts.loadAll(2022, 2024);
	var history = snapshotFacts.findPlayerHistory(contracts, 'Josh Allen');
	
	assertTrue(history.length > 0, 'Should find Josh Allen');
	
	// Should be sorted by season
	for (var i = 1; i < history.length; i++) {
		assertTrue(history[i].season >= history[i-1].season, 'Should be sorted by season');
	}
});

test('getSummary returns correct stats', function() {
	var contracts = [
		{ season: 2023, espnId: '123', startYear: 2022 },
		{ season: 2024, espnId: null, startYear: null },
		{ season: 2023, espnId: '456', startYear: 2021 }
	];
	
	var summary = snapshotFacts.getSummary(contracts);
	
	assertEqual(summary.total, 3);
	assertEqual(summary.withEspnId, 2);
	assertEqual(summary.faContracts, 1);
});

// === Summary ===

console.log('\n--- Summary ---');
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
