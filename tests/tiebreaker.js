/**
 * Tests for tiebreaker helper functions
 * 
 * Run via: node tests/tiebreaker.js
 */

var tiebreaker = require('../helpers/tiebreaker');
var divisions = require('../helpers/divisions');

var passed = 0;
var failed = 0;

function test(name, fn) {
	try {
		fn();
		console.log('✓', name);
		passed++;
	} catch (err) {
		console.log('✗', name);
		console.log('  ', err.message);
		failed++;
	}
}

function assertEqual(actual, expected, message) {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error((message || 'Assertion failed') + 
			'\n   Expected: ' + JSON.stringify(expected) + 
			'\n   Actual:   ' + JSON.stringify(actual));
	}
}

// =============================================================================
// sortByPlayoffFinish tests
// =============================================================================

console.log('\n--- sortByPlayoffFinish ---\n');

test('sorts by playoff finish order (champion first)', function() {
	var teams = [
		{ id: 1, name: 'Runner Up', wins: 10, losses: 4, pointsFor: 1500, playoffFinish: 'runner-up' },
		{ id: 2, name: 'Champion', wins: 9, losses: 5, pointsFor: 1400, playoffFinish: 'champion' },
		{ id: 3, name: 'Third', wins: 8, losses: 6, pointsFor: 1300, playoffFinish: 'third-place' },
		{ id: 4, name: 'Fourth', wins: 7, losses: 7, pointsFor: 1200, playoffFinish: 'fourth-place' }
	];
	var h2h = {};
	
	var sorted = tiebreaker.sortByPlayoffFinish(teams, h2h, 2020);
	var names = sorted.map(function(t) { return t.name; });
	
	assertEqual(names, ['Champion', 'Runner Up', 'Third', 'Fourth']);
});

test('uses record tiebreaker for teams with same finish (two fourth-place teams)', function() {
	var teams = [
		{ id: 1, name: 'Better Record', wins: 10, losses: 4, pointsFor: 1500, playoffFinish: 'fourth-place' },
		{ id: 2, name: 'Worse Record', wins: 8, losses: 6, pointsFor: 1300, playoffFinish: 'fourth-place' },
		{ id: 3, name: 'Champion', wins: 11, losses: 3, pointsFor: 1600, playoffFinish: 'champion' }
	];
	var h2h = {};
	
	var sorted = tiebreaker.sortByPlayoffFinish(teams, h2h, 2020);
	var names = sorted.map(function(t) { return t.name; });
	
	// Champion first, then the two fourth-place teams sorted by record
	assertEqual(names, ['Champion', 'Better Record', 'Worse Record']);
});

test('uses points for when records are tied', function() {
	var teams = [
		{ id: 1, name: 'Lower PF', wins: 10, losses: 4, pointsFor: 1400, playoffFinish: 'fourth-place' },
		{ id: 2, name: 'Higher PF', wins: 10, losses: 4, pointsFor: 1500, playoffFinish: 'fourth-place' }
	];
	var h2h = {};
	
	var sorted = tiebreaker.sortByPlayoffFinish(teams, h2h, 2020);
	var names = sorted.map(function(t) { return t.name; });
	
	assertEqual(names, ['Higher PF', 'Lower PF']);
});

test('handles empty array', function() {
	var sorted = tiebreaker.sortByPlayoffFinish([], {}, 2020);
	assertEqual(sorted, []);
});

test('handles single team', function() {
	var teams = [{ id: 1, name: 'Solo', wins: 10, losses: 4, pointsFor: 1500, playoffFinish: 'champion' }];
	var sorted = tiebreaker.sortByPlayoffFinish(teams, {}, 2020);
	assertEqual(sorted.length, 1);
	assertEqual(sorted[0].name, 'Solo');
});

test('uses legacy tiebreaker for pre-2020 seasons', function() {
	// In legacy tiebreaker, if H2H games are equal (0), it falls back to points for
	var teams = [
		{ id: 1, name: 'Lower PF', wins: 10, losses: 4, pointsFor: 1400, playoffFinish: 'fourth-place' },
		{ id: 2, name: 'Higher PF', wins: 10, losses: 4, pointsFor: 1500, playoffFinish: 'fourth-place' }
	];
	var h2h = {};
	
	var sorted = tiebreaker.sortByPlayoffFinish(teams, h2h, 2008);
	var names = sorted.map(function(t) { return t.name; });
	
	assertEqual(names, ['Higher PF', 'Lower PF']);
});

// =============================================================================
// sortWithDivisions tests (the original bug)
// =============================================================================

console.log('\n--- sortWithDivisions ---\n');

test('division winners are sorted by points for when records are tied (2008 Week 1 scenario)', function() {
	// This is the exact scenario that motivated this fix:
	// Jeff (Capulets, id 7) scored 1053.2 points
	// Keyon (Montagues, id 6) scored 1046 points
	// Both are 1-0, Jeff should be ranked #1
	
	var teams = [
		// Montagues: 1, 4, 6, 8, 10
		{ id: 1, name: 'Patrick', wins: 0, losses: 1, ties: 0, pointsFor: 897.6 },
		{ id: 4, name: 'John', wins: 0, losses: 1, ties: 0, pointsFor: 954.8 },
		{ id: 6, name: 'Keyon', wins: 1, losses: 0, ties: 0, pointsFor: 1046 },
		{ id: 8, name: 'Daniel', wins: 0, losses: 1, ties: 0, pointsFor: 711.6 },
		{ id: 10, name: 'Schexes', wins: 0, losses: 1, ties: 0, pointsFor: 618.3 },
		// Capulets: 2, 3, 5, 7, 9
		{ id: 2, name: 'Koci', wins: 0, losses: 1, ties: 0, pointsFor: 574.9 },
		{ id: 3, name: 'Syed', wins: 0, losses: 1, ties: 0, pointsFor: 495.8 },
		{ id: 5, name: 'Trevor', wins: 0, losses: 1, ties: 0, pointsFor: 865 },
		{ id: 7, name: 'Jeff', wins: 1, losses: 0, ties: 0, pointsFor: 1053.2 },
		{ id: 9, name: 'James', wins: 0, losses: 1, ties: 0, pointsFor: 966 }
	];
	
	var h2h = {}; // No H2H games yet in week 1
	
	var result = divisions.sortWithDivisions(teams, h2h, 2008, tiebreaker.sortByRecord);
	
	// Jeff should be #1 (higher PF), Keyon should be #2
	assertEqual(result.standings[0].name, 'Jeff', 'Jeff should be ranked #1');
	assertEqual(result.standings[1].name, 'Keyon', 'Keyon should be ranked #2');
});

test('division winners with different records are sorted correctly', function() {
	var teams = [
		// Montagues
		{ id: 6, name: 'Keyon', wins: 2, losses: 0, ties: 0, pointsFor: 200 },
		{ id: 1, name: 'Patrick', wins: 1, losses: 1, ties: 0, pointsFor: 180 },
		{ id: 4, name: 'John', wins: 0, losses: 2, ties: 0, pointsFor: 150 },
		{ id: 8, name: 'Daniel', wins: 0, losses: 2, ties: 0, pointsFor: 140 },
		{ id: 10, name: 'Schexes', wins: 0, losses: 2, ties: 0, pointsFor: 130 },
		// Capulets
		{ id: 7, name: 'Jeff', wins: 1, losses: 1, ties: 0, pointsFor: 300 },
		{ id: 2, name: 'Koci', wins: 1, losses: 1, ties: 0, pointsFor: 160 },
		{ id: 3, name: 'Syed', wins: 0, losses: 2, ties: 0, pointsFor: 120 },
		{ id: 5, name: 'Trevor', wins: 0, losses: 2, ties: 0, pointsFor: 110 },
		{ id: 9, name: 'James', wins: 0, losses: 2, ties: 0, pointsFor: 100 }
	];
	
	var h2h = {};
	
	var result = divisions.sortWithDivisions(teams, h2h, 2008, tiebreaker.sortByRecord);
	
	// Keyon (2-0) should be #1, Jeff (1-1) should be #2
	assertEqual(result.standings[0].name, 'Keyon', 'Keyon (2-0) should be ranked #1');
	assertEqual(result.standings[1].name, 'Jeff', 'Jeff (1-1, division winner) should be ranked #2');
});

test('Capulets winner ranks ahead of Montagues winner when Capulets has better record', function() {
	var teams = [
		// Montagues
		{ id: 6, name: 'Keyon', wins: 1, losses: 1, ties: 0, pointsFor: 200 },
		{ id: 1, name: 'Patrick', wins: 0, losses: 2, ties: 0, pointsFor: 180 },
		{ id: 4, name: 'John', wins: 0, losses: 2, ties: 0, pointsFor: 150 },
		{ id: 8, name: 'Daniel', wins: 0, losses: 2, ties: 0, pointsFor: 140 },
		{ id: 10, name: 'Schexes', wins: 0, losses: 2, ties: 0, pointsFor: 130 },
		// Capulets
		{ id: 7, name: 'Jeff', wins: 2, losses: 0, ties: 0, pointsFor: 300 },
		{ id: 2, name: 'Koci', wins: 1, losses: 1, ties: 0, pointsFor: 160 },
		{ id: 3, name: 'Syed', wins: 0, losses: 2, ties: 0, pointsFor: 120 },
		{ id: 5, name: 'Trevor', wins: 0, losses: 2, ties: 0, pointsFor: 110 },
		{ id: 9, name: 'James', wins: 0, losses: 2, ties: 0, pointsFor: 100 }
	];
	
	var h2h = {};
	
	var result = divisions.sortWithDivisions(teams, h2h, 2008, tiebreaker.sortByRecord);
	
	// Jeff (2-0, Capulets) should be #1, Keyon (1-1, Montagues) should be #2
	assertEqual(result.standings[0].name, 'Jeff', 'Jeff (2-0) should be ranked #1');
	assertEqual(result.standings[1].name, 'Keyon', 'Keyon (1-1, division winner) should be ranked #2');
});

// =============================================================================
// Summary
// =============================================================================

console.log('\n---');
console.log('Passed:', passed);
console.log('Failed:', failed);
console.log('---\n');

process.exit(failed > 0 ? 1 : 0);
