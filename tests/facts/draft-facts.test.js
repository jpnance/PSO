/**
 * Unit tests for draft facts parser.
 * 
 * Usage: node tests/facts/draft-facts.test.js
 */

var draftFacts = require('../../data/facts/draft-facts');

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

// === Tests ===

test('parseDraftSheet parses standard row', function() {
	var rows = [
		['Pick', 'Round', 'Owner', 'Player'],
		['1', '1', 'Schex', 'Caleb Williams']
	];
	
	var picks = draftFacts.parseDraftSheet(2024, rows);
	
	assertEqual(picks.length, 1);
	assertEqual(picks[0].season, 2024);
	assertEqual(picks[0].pickNumber, 1);
	assertEqual(picks[0].round, 1);
	assertEqual(picks[0].owner, 'Schex');
	assertEqual(picks[0].playerName, 'Caleb Williams');
});

test('parseDraftSheet handles 2020 column offset', function() {
	// 2020 has an extra column at the start
	var rows = [
		['Extra', 'Pick', 'Round', 'Owner', 'Player'],
		['X', '1', '1', 'Koci', 'Joe Burrow']
	];
	
	var picks = draftFacts.parseDraftSheet(2020, rows);
	
	assertEqual(picks[0].pickNumber, 1);
	assertEqual(picks[0].round, 1);
	assertEqual(picks[0].owner, 'Koci');
	assertEqual(picks[0].playerName, 'Joe Burrow');
});

test('parseDraftSheet skips pass selections', function() {
	var rows = [
		['Pick', 'Round', 'Owner', 'Player'],
		['1', '1', 'Schex', 'Player One'],
		['2', '1', 'Koci', 'pass'],
		['3', '1', 'Nance', 'Player Two']
	];
	
	var picks = draftFacts.parseDraftSheet(2024, rows);
	
	assertEqual(picks.length, 2);
	assertEqual(picks[0].playerName, 'Player One');
	assertEqual(picks[1].playerName, 'Player Two');
});

test('parseDraftSheet skips invalid rows', function() {
	var rows = [
		['Pick', 'Round', 'Owner', 'Player'],
		['1', '1', 'Schex', 'Player One'],
		['invalid', 'notanumber', '', ''],
		['3', '1', 'Nance', 'Player Two']
	];
	
	var picks = draftFacts.parseDraftSheet(2024, rows);
	
	assertEqual(picks.length, 2);
});

test('groupBySeason groups correctly', function() {
	var picks = [
		{ season: 2023, playerName: 'A' },
		{ season: 2024, playerName: 'B' },
		{ season: 2023, playerName: 'C' }
	];
	
	var grouped = draftFacts.groupBySeason(picks);
	
	assertEqual(grouped['2023'].length, 2);
	assertEqual(grouped['2024'].length, 1);
});

test('getSummary returns correct stats', function() {
	var picks = [
		{ season: 2023, playerName: 'A' },
		{ season: 2024, playerName: 'B' },
		{ season: 2023, playerName: 'C' }
	];
	
	var summary = draftFacts.getSummary(picks);
	
	assertEqual(summary.total, 3);
	assertEqual(summary.bySeason['2023'], 2);
	assertEqual(summary.bySeason['2024'], 1);
});

// === Summary ===

console.log('\n--- Summary ---');
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
