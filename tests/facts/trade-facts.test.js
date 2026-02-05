/**
 * Unit tests for trade facts.
 * 
 * Usage: node tests/facts/trade-facts.test.js
 */

var tradeFacts = require('../../data/facts/trade-facts');

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

test('checkAvailability returns true when trades.json exists', function() {
	// trades.json should exist in the repo
	assertEqual(tradeFacts.checkAvailability(), true);
});

test('loadAll returns array of trades', function() {
	var trades = tradeFacts.loadAll();
	if (!Array.isArray(trades)) {
		throw new Error('Expected array, got ' + typeof trades);
	}
	if (trades.length === 0) {
		throw new Error('Expected trades array to have entries');
	}
});

test('loadAll converts date strings to Date objects', function() {
	var trades = tradeFacts.loadAll();
	var firstTrade = trades[0];
	if (!(firstTrade.date instanceof Date)) {
		throw new Error('Expected date to be Date object, got ' + typeof firstTrade.date);
	}
});

test('getContractStrings aggregates unique contract strings', function() {
	var trades = [
		{ parties: [{ players: [{ contractStr: '2019' }, { contractStr: '19/21' }] }] },
		{ parties: [{ players: [{ contractStr: '2019' }] }] }
	];
	
	var strings = tradeFacts.getContractStrings(trades);
	
	assertEqual(strings.find(function(s) { return s.contractStr === '2019'; }).count, 2);
	assertEqual(strings.find(function(s) { return s.contractStr === '19/21'; }).count, 1);
});

// === Summary ===

console.log('\n--- Summary ---');
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
