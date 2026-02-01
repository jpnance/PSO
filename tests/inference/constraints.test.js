/**
 * Unit tests for constraint functions.
 * 
 * Usage: node tests/inference/constraints.test.js
 */

var constraints = require('../../data/inference/constraints');

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

// === SalaryContinuity Tests ===

test('salaryContinuity: no violations for consistent salaries', function() {
	var snapshots = [
		{ playerName: 'Josh Allen', season: 2022, startYear: 2022, endYear: 2024, salary: 44 },
		{ playerName: 'Josh Allen', season: 2023, startYear: 2022, endYear: 2024, salary: 44 },
		{ playerName: 'Josh Allen', season: 2024, startYear: 2022, endYear: 2024, salary: 44 }
	];
	
	var violations = constraints.salaryContinuity(snapshots);
	assertEqual(violations.length, 0);
});

test('salaryContinuity: detects salary change within same contract', function() {
	var snapshots = [
		{ playerName: 'Josh Allen', season: 2022, startYear: 2022, endYear: 2024, salary: 44 },
		{ playerName: 'Josh Allen', season: 2023, startYear: 2022, endYear: 2024, salary: 50 }
	];
	
	var violations = constraints.salaryContinuity(snapshots);
	assertEqual(violations.length, 1);
	assertEqual(violations[0].constraint, 'SalaryContinuity');
	assertTrue(violations[0].message.indexOf('$44') >= 0);
	assertTrue(violations[0].message.indexOf('$50') >= 0);
});

test('salaryContinuity: allows salary change for new contract', function() {
	var snapshots = [
		{ playerName: 'Josh Allen', season: 2022, startYear: 2022, endYear: 2024, salary: 44 },
		{ playerName: 'Josh Allen', season: 2025, startYear: 2025, endYear: 2027, salary: 100 }
	];
	
	var violations = constraints.salaryContinuity(snapshots);
	assertEqual(violations.length, 0);
});

// === SnapshotConsistency Tests ===

test('snapshotConsistency: no violations for valid contracts', function() {
	var snapshots = [
		{ playerName: 'Player A', season: 2024, startYear: 2023, endYear: 2025, salary: 10 },
		{ playerName: 'Player B', season: 2024, startYear: 2024, endYear: 2024, salary: 5 }
	];
	
	var violations = constraints.snapshotConsistency(snapshots);
	assertEqual(violations.length, 0);
});

test('snapshotConsistency: detects contract ending before season', function() {
	var snapshots = [
		{ playerName: 'Player A', season: 2024, startYear: 2022, endYear: 2023, salary: 10 }
	];
	
	var violations = constraints.snapshotConsistency(snapshots);
	assertEqual(violations.length, 1);
	assertEqual(violations[0].constraint, 'SnapshotConsistency');
	assertTrue(violations[0].message.indexOf('ends in 2023') >= 0);
});

test('snapshotConsistency: detects contract starting after season', function() {
	var snapshots = [
		{ playerName: 'Player A', season: 2024, startYear: 2025, endYear: 2027, salary: 10 }
	];
	
	var violations = constraints.snapshotConsistency(snapshots);
	assertEqual(violations.length, 1);
	assertTrue(violations[0].message.indexOf('starts in 2025') >= 0);
});

test('snapshotConsistency: detects contract longer than 3 years', function() {
	var snapshots = [
		{ playerName: 'Player A', season: 2024, startYear: 2022, endYear: 2026, salary: 10 }
	];
	
	var violations = constraints.snapshotConsistency(snapshots);
	assertTrue(violations.length >= 1);
	assertTrue(violations.some(function(v) { return v.message.indexOf('5-year') >= 0; }));
});

// === ValidContractLength Tests ===

test('validContractLength: accepts 1, 2, 3 year contracts', function() {
	var snapshots = [
		{ playerName: 'One Year', season: 2024, startYear: 2024, endYear: 2024, salary: 10 },
		{ playerName: 'Two Year', season: 2024, startYear: 2023, endYear: 2024, salary: 20 },
		{ playerName: 'Three Year', season: 2024, startYear: 2022, endYear: 2024, salary: 30 }
	];
	
	var violations = constraints.validContractLength(snapshots);
	assertEqual(violations.length, 0);
});

test('validContractLength: accepts FA contracts (null startYear)', function() {
	var snapshots = [
		{ playerName: 'FA Player', season: 2024, startYear: null, endYear: 2024, salary: 5 }
	];
	
	var violations = constraints.validContractLength(snapshots);
	assertEqual(violations.length, 0);
});

test('validContractLength: detects 4+ year contracts', function() {
	var snapshots = [
		{ playerName: 'Long Contract', season: 2024, startYear: 2021, endYear: 2024, salary: 10 }
	];
	
	var violations = constraints.validContractLength(snapshots);
	assertEqual(violations.length, 1);
	assertTrue(violations[0].message.indexOf('4-year') >= 0);
});

// === CutSalaryMatchesAcquisition Tests ===

test('cutSalaryMatchesAcquisition: no violation when salaries match', function() {
	var cuts = [
		{ name: 'Josh Allen', cutYear: 2024, salary: 44 }
	];
	var snapshots = [
		{ playerName: 'Josh Allen', season: 2024, salary: 44 }
	];
	
	var violations = constraints.cutSalaryMatchesAcquisition(cuts, snapshots);
	assertEqual(violations.length, 0);
});

test('cutSalaryMatchesAcquisition: detects salary mismatch', function() {
	var cuts = [
		{ name: 'Josh Allen', cutYear: 2024, salary: 44 }
	];
	var snapshots = [
		{ playerName: 'Josh Allen', season: 2024, salary: 50 }
	];
	
	var violations = constraints.cutSalaryMatchesAcquisition(cuts, snapshots);
	assertEqual(violations.length, 1);
	assertEqual(violations[0].constraint, 'CutSalaryMatchesAcquisition');
});

test('cutSalaryMatchesAcquisition: no violation when no matching snapshot', function() {
	var cuts = [
		{ name: 'Josh Allen', cutYear: 2024, salary: 44 }
	];
	var snapshots = [
		{ playerName: 'Josh Allen', season: 2023, salary: 44 }
	];
	
	var violations = constraints.cutSalaryMatchesAcquisition(cuts, snapshots);
	assertEqual(violations.length, 0);
});

// === ContractSpansTrade Tests ===

test('contractSpansTrade: no violation when trade within contract', function() {
	var trades = [{
		tradeId: 1,
		date: new Date('2024-03-15'),
		parties: [{
			players: [{ name: 'Player A', startYear: 2023, endYear: 2025 }]
		}]
	}];
	
	var violations = constraints.contractSpansTrade(trades);
	assertEqual(violations.length, 0);
});

test('contractSpansTrade: detects trade after contract ends', function() {
	var trades = [{
		tradeId: 1,
		date: new Date('2024-09-15'),  // After August = 2024 season
		parties: [{
			players: [{ name: 'Player A', startYear: 2022, endYear: 2023 }]
		}]
	}];
	
	var violations = constraints.contractSpansTrade(trades);
	assertEqual(violations.length, 1);
	assertTrue(violations[0].message.indexOf('ends in 2023') >= 0);
});

// === checkAll Tests ===

test('checkAll: aggregates all constraint violations', function() {
	var facts = {
		snapshots: [
			{ playerName: 'Valid', season: 2024, startYear: 2024, endYear: 2024, salary: 10 },
			{ playerName: 'TooLong', season: 2024, startYear: 2020, endYear: 2024, salary: 10 }
		],
		cuts: []
	};
	
	var result = constraints.checkAll(facts);
	
	assertTrue(result.total >= 1);
	assertTrue(result.violations.length >= 1);
	assertTrue(result.summary.validContractLength >= 1);
});

// === Summary ===

console.log('\n--- Summary ---');
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
