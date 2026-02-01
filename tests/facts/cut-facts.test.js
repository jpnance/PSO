/**
 * Unit tests for cut facts parser.
 * 
 * Usage: node tests/facts/cut-facts.test.js
 */

var cutFacts = require('../../data/facts/cut-facts');

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

test('parseNameWithHint extracts hint from parentheses', function() {
	var result = cutFacts.parseNameWithHint('Brandon Marshall (DEN)');
	assertEqual(result.name, 'Brandon Marshall');
	assertEqual(result.hint, 'DEN');
	assertEqual(result.raw, 'Brandon Marshall (DEN)');
});

test('parseNameWithHint handles name without hint', function() {
	var result = cutFacts.parseNameWithHint('Josh Allen');
	assertEqual(result.name, 'Josh Allen');
	assertEqual(result.hint, null);
	assertEqual(result.raw, 'Josh Allen');
});

test('parseNameWithHint handles null input', function() {
	var result = cutFacts.parseNameWithHint(null);
	assertEqual(result.name, null);
	assertEqual(result.hint, null);
});

test('parseCutsSheet parses standard row', function() {
	var rows = [
		['Header1', 'Header2', 'Header3', 'Header4', 'Header5', 'Header6', 'Header7'],
		['Skip', 'Skip', 'Skip', 'Skip', 'Skip', 'Skip', 'Skip'],
		['Schex', 'Josh Allen', 'QB', '2022', '2024', '$44', '2024']
	];
	
	var cuts = cutFacts.parseCutsSheet(rows);
	
	assertEqual(cuts.length, 1);
	assertEqual(cuts[0].owner, 'Schex');
	assertEqual(cuts[0].name, 'Josh Allen');
	assertEqual(cuts[0].hint, null);
	assertEqual(cuts[0].position, 'QB');
	assertEqual(cuts[0].startYear, 2022);
	assertEqual(cuts[0].endYear, 2024);
	assertEqual(cuts[0].salary, 44);
	assertEqual(cuts[0].cutYear, 2024);
});

test('parseCutsSheet handles FA start year', function() {
	var rows = [
		['H', 'H', 'H', 'H', 'H', 'H', 'H'],
		['S', 'S', 'S', 'S', 'S', 'S', 'S'],
		['Koci', 'Player Name', 'WR', 'FA', '2023', '$10', '2023']
	];
	
	var cuts = cutFacts.parseCutsSheet(rows);
	
	assertEqual(cuts[0].startYear, null);
	assertEqual(cuts[0].endYear, 2023);
});

test('parseCutsSheet extracts disambiguation hint', function() {
	var rows = [
		['H', 'H', 'H', 'H', 'H', 'H', 'H'],
		['S', 'S', 'S', 'S', 'S', 'S', 'S'],
		['Nance', 'Mike Williams (USC)', 'WR', '2010', '2012', '$50', '2012']
	];
	
	var cuts = cutFacts.parseCutsSheet(rows);
	
	assertEqual(cuts[0].name, 'Mike Williams');
	assertEqual(cuts[0].hint, 'USC');
	assertEqual(cuts[0].rawName, 'Mike Williams (USC)');
});

test('parseCutsSheet skips empty rows', function() {
	var rows = [
		['H', 'H', 'H', 'H', 'H', 'H', 'H'],
		['S', 'S', 'S', 'S', 'S', 'S', 'S'],
		['Schex', 'Player One', 'QB', '2022', '2024', '$10', '2024'],
		['', '', '', '', '', '', ''],
		['Koci', 'Player Two', 'RB', '2023', '2025', '$20', '2025']
	];
	
	var cuts = cutFacts.parseCutsSheet(rows);
	
	assertEqual(cuts.length, 2);
});

test('groupByYear groups cuts correctly', function() {
	var cuts = [
		{ name: 'A', cutYear: 2023 },
		{ name: 'B', cutYear: 2024 },
		{ name: 'C', cutYear: 2023 }
	];
	
	var grouped = cutFacts.groupByYear(cuts);
	
	assertEqual(grouped['2023'].length, 2);
	assertEqual(grouped['2024'].length, 1);
});

test('getSummary returns correct stats', function() {
	var cuts = [
		{ name: 'A', cutYear: 2023, hint: 'DEN', startYear: null },
		{ name: 'B', cutYear: 2024, hint: null, startYear: 2022 },
		{ name: 'C', cutYear: 2023, hint: 'USC', startYear: 2021 }
	];
	
	var summary = cutFacts.getSummary(cuts);
	
	assertEqual(summary.total, 3);
	assertEqual(summary.withHints, 2);
	assertEqual(summary.faContracts, 1);
	assertEqual(summary.byYear['2023'], 2);
	assertEqual(summary.byYear['2024'], 1);
});

// === Summary ===

console.log('\n--- Summary ---');
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
