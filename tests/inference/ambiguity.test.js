/**
 * Unit tests for ambiguity tracking and resolution.
 * 
 * Usage: node tests/inference/ambiguity.test.js
 */

var ambiguity = require('../../data/inference/ambiguity');
var AmbiguityType = ambiguity.AmbiguityType;

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

// Clear cache before each test
function setup() {
	ambiguity.clearCache();
}

// === AmbiguityCollector Tests ===

test('AmbiguityCollector: add and count', function() {
	setup();
	var collector = new ambiguity.AmbiguityCollector();
	
	collector.add(AmbiguityType.CONTRACT_TERM, { player: 'A' }, [], 'Test');
	collector.add(AmbiguityType.CONTRACT_TERM, { player: 'B' }, [], 'Test');
	
	assertEqual(collector.count(), 2);
});

test('AmbiguityCollector: addContractTerm helper', function() {
	setup();
	var collector = new ambiguity.AmbiguityCollector();
	
	collector.addContractTerm('Josh Allen', 123, new Date('2024-01-01'), 
		[{ startYear: 2022, endYear: 2024 }], 'Ambiguous');
	
	assertEqual(collector.count(), 1);
	var items = collector.getByType(AmbiguityType.CONTRACT_TERM);
	assertEqual(items.length, 1);
	assertEqual(items[0].context.playerName, 'Josh Allen');
	assertEqual(items[0].context.tradeId, 123);
});

test('AmbiguityCollector: byType', function() {
	setup();
	var collector = new ambiguity.AmbiguityCollector();
	
	collector.add(AmbiguityType.CONTRACT_TERM, {}, [], '');
	collector.add(AmbiguityType.CONTRACT_TERM, {}, [], '');
	collector.add(AmbiguityType.PLAYER_IDENTITY, {}, [], '');
	
	var counts = collector.byType();
	assertEqual(counts[AmbiguityType.CONTRACT_TERM], 2);
	assertEqual(counts[AmbiguityType.PLAYER_IDENTITY], 1);
});

// === Contract Term Resolution Tests ===

test('getContractTermResolution: returns null if not found', function() {
	setup();
	var result = ambiguity.getContractTermResolution({
		playerName: 'Nonexistent Player',
		tradeId: 999
	});
	assertEqual(result, undefined);
});

test('addContractTermResolution and getContractTermResolution', function() {
	setup();
	
	ambiguity.addContractTermResolution({
		player: 'Eli Manning',
		tradeId: 10,
		startYear: 2008,
		endYear: 2010,
		reason: 'Test resolution'
	});
	
	var result = ambiguity.getContractTermResolution({
		playerName: 'Eli Manning',
		tradeId: 10
	});
	
	assertTrue(result !== undefined);
	assertEqual(result.startYear, 2008);
	assertEqual(result.endYear, 2010);
	assertEqual(result.reason, 'Test resolution');
});

test('addContractTermResolution: updates existing', function() {
	setup();
	
	ambiguity.addContractTermResolution({
		player: 'Test Player',
		tradeId: 1,
		startYear: 2020,
		endYear: 2022,
		reason: 'First'
	});
	
	ambiguity.addContractTermResolution({
		player: 'Test Player',
		tradeId: 1,
		startYear: 2021,
		endYear: 2023,
		reason: 'Updated'
	});
	
	var result = ambiguity.getContractTermResolution({
		playerName: 'Test Player',
		tradeId: 1
	});
	
	assertEqual(result.startYear, 2021);
	assertEqual(result.reason, 'Updated');
});

test('removeContractTermResolution', function() {
	setup();
	
	ambiguity.addContractTermResolution({
		player: 'To Remove',
		tradeId: 99,
		startYear: 2020,
		endYear: 2022,
		reason: 'Will be removed'
	});
	
	var removed = ambiguity.removeContractTermResolution({
		playerName: 'To Remove',
		tradeId: 99
	});
	
	assertTrue(removed);
	
	var result = ambiguity.getContractTermResolution({
		playerName: 'To Remove',
		tradeId: 99
	});
	
	assertEqual(result, undefined);
});

// === Validation Tests ===

test('validateContractTermResolution: valid 3-year contract', function() {
	var result = ambiguity.validateContractTermResolution({
		player: 'Test',
		startYear: 2022,
		endYear: 2024
	}, {});
	
	assertTrue(result.valid);
	assertEqual(result.errors.length, 0);
});

test('validateContractTermResolution: detects invalid length', function() {
	var result = ambiguity.validateContractTermResolution({
		player: 'Test',
		startYear: 2020,
		endYear: 2024
	}, {});
	
	assertTrue(!result.valid);
	assertTrue(result.errors[0].indexOf('invalid') >= 0);
});

test('validateContractTermResolution: detects contract ending before trade', function() {
	var result = ambiguity.validateContractTermResolution({
		player: 'Test',
		startYear: 2020,
		endYear: 2022
	}, {
		tradeDate: new Date('2024-09-15')
	});
	
	assertTrue(!result.valid);
	assertTrue(result.errors[0].indexOf('ends before') >= 0);
});

// === Apply Resolution Tests ===

test('applyResolution: applies to ambiguous inference', function() {
	setup();
	
	// Add a resolution
	ambiguity.addContractTermResolution({
		player: 'Josh Allen',
		tradeId: 50,
		startYear: 2022,
		endYear: 2024,
		reason: 'Confirmed by snapshot'
	});
	
	var inference = {
		startYear: null,
		endYear: 2024,
		confidence: 'ambiguous',
		reason: 'Unknown'
	};
	
	var result = ambiguity.applyResolution(inference, 'Josh Allen', 50);
	
	assertEqual(result.startYear, 2022);
	assertEqual(result.endYear, 2024);
	assertEqual(result.confidence, 'resolved');
	assertTrue(result.reason.indexOf('Resolved') >= 0);
});

test('applyResolution: does not apply to certain inference', function() {
	setup();
	
	ambiguity.addContractTermResolution({
		player: 'Josh Allen',
		tradeId: 50,
		startYear: 2020,
		endYear: 2022,
		reason: 'Different'
	});
	
	var inference = {
		startYear: 2022,
		endYear: 2024,
		confidence: 'certain',
		reason: 'Explicit'
	};
	
	var result = ambiguity.applyResolution(inference, 'Josh Allen', 50);
	
	assertEqual(result.startYear, 2022);
	assertEqual(result.confidence, 'certain');
});

// === Reporting Tests ===

test('formatForReview: generates readable output', function() {
	var collector = new ambiguity.AmbiguityCollector();
	
	collector.addContractTerm('Player A', 1, new Date('2020-01-15'), 
		[{ startYear: 2019 }], 'Unclear');
	collector.addContractTerm('Player B', 2, new Date('2021-03-20'), 
		[{ startYear: 2020 }], 'Also unclear');
	
	var output = ambiguity.formatForReview(collector);
	
	assertTrue(output.indexOf('Ambiguities Report') >= 0);
	assertTrue(output.indexOf('Total: 2') >= 0);
	assertTrue(output.indexOf('Player A') >= 0);
	assertTrue(output.indexOf('Trade #1') >= 0);
});

test('suggestResolutions: generates suggestions', function() {
	var collector = new ambiguity.AmbiguityCollector();
	
	collector.addContractTerm('Player A', 1, new Date('2020-01-15'), 
		[{ startYear: 2019, endYear: 2020 }], 'Unclear');
	
	var suggestions = ambiguity.suggestResolutions(collector);
	
	assertEqual(suggestions.length, 1);
	assertEqual(suggestions[0].player, 'Player A');
	assertEqual(suggestions[0].tradeId, 1);
	assertTrue(suggestions[0].suggestedResolution !== null);
});

// === Summary ===

console.log('\n--- Summary ---');
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
