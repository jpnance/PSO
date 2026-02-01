/**
 * Unit tests for Fantrax facts parser (CSV format).
 * 
 * Usage: node tests/facts/fantrax-facts.test.js
 */

var fantraxFacts = require('../../data/facts/fantrax-facts');

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

// === CSV Parsing Tests ===

test('parseCSVLine: handles quoted fields', function() {
	var line = '"Marcus Mariota","LV","QB","Drop","(Trevor) Team","","1"';
	var fields = fantraxFacts.parseCSVLine(line);
	
	assertEqual(fields[0], 'Marcus Mariota');
	assertEqual(fields[1], 'LV');
	assertEqual(fields[3], 'Drop');
	assertEqual(fields[4], '(Trevor) Team');
});

test('parseCSVLine: handles empty fields', function() {
	var line = '"Player","Team","","Drop","Team","","1"';
	var fields = fantraxFacts.parseCSVLine(line);
	
	assertEqual(fields[2], '');
	assertEqual(fields[5], '');
});

// === Owner Extraction Tests ===

test('extractOwner: parenthetical code', function() {
	assertEqual(fantraxFacts.extractOwner('(Trevor) The Greenbay Packers'), 'Trevor');
	assertEqual(fantraxFacts.extractOwner('(Keyon) Quon T. Hill and the Zits'), 'Keyon');
	assertEqual(fantraxFacts.extractOwner('(SCHX) Onederlic Life to Live'), 'Schex');
	assertEqual(fantraxFacts.extractOwner('(pat) Crucifictorious Maids'), 'Patrick');
});

test('extractOwner: embedded name', function() {
	assertEqual(fantraxFacts.extractOwner("Figrin J'OHN and the Modal Nodes"), 'John');
	assertEqual(fantraxFacts.extractOwner("Cap'n Geech & The Shrimp Shaq Shooters"), 'Syed');
});

test('extractOwner: returns null for unknown', function() {
	assertEqual(fantraxFacts.extractOwner('Unknown Team Name'), null);
});

// === Date Parsing Tests ===

test('parseDate: parses Fantrax date format', function() {
	var date = fantraxFacts.parseDate('Wed Dec 23, 2020, 8:05PM');
	
	assertTrue(date instanceof Date);
	assertEqual(date.getUTCFullYear(), 2020);
	assertEqual(date.getUTCMonth(), 11); // December
	assertEqual(date.getUTCDate(), 24); // +8 hours from PST makes it next day in UTC
});

test('parseDate: handles AM times', function() {
	var date = fantraxFacts.parseDate('Sat Dec 19, 2020, 9:00AM');
	
	assertTrue(date instanceof Date);
	assertEqual(date.getUTCHours(), 17); // 9 AM PST = 5 PM UTC
});

test('parseDate: returns null for invalid', function() {
	assertEqual(fantraxFacts.parseDate('invalid'), null);
	assertEqual(fantraxFacts.parseDate(''), null);
	assertEqual(fantraxFacts.parseDate(null), null);
});

// === Full CSV Parsing Tests ===

test('parseCSV: parses transaction rows', function() {
	var csv = '"Player","Team","Position","Type","Team","Bid","Pr","Grp/Max","Date (PST)","Week"\n' +
	          '"Marcus Mariota","LV","QB","Drop","(Trevor) The Greenbay Packers","","1","1/99","Wed Dec 23, 2020, 8:05PM","16"';
	
	var transactions = fantraxFacts.parseCSV(2020, csv);
	
	assertEqual(transactions.length, 1);
	assertEqual(transactions[0].playerName, 'Marcus Mariota');
	assertEqual(transactions[0].type, 'Drop');
	assertEqual(transactions[0].owner, 'Trevor');
	assertEqual(transactions[0].position, 'QB');
	assertEqual(transactions[0].week, 16);
	assertEqual(transactions[0].season, 2020);
});

test('parseCSV: parses bid amounts', function() {
	var csv = '"Player","Team","Position","Type","Team","Bid","Pr","Grp/Max","Date (PST)","Week"\n' +
	          '"Salvon Ahmed","MIA","RB","Claim","(Keyon) Team","1.00","1","1/99","Sat Dec 19, 2020, 9:00AM","15"';
	
	var transactions = fantraxFacts.parseCSV(2020, csv);
	
	assertEqual(transactions[0].type, 'Claim');
	assertEqual(transactions[0].bid, 1.00);
});

// === Real Data Tests ===

test('checkAvailability: detects CSV files', function() {
	var result = fantraxFacts.checkAvailability();
	
	assertTrue(result.available, 'Should find Fantrax data');
	assertTrue(result.years.indexOf(2020) >= 0, 'Should include 2020');
	assertTrue(result.years.indexOf(2021) >= 0, 'Should include 2021');
});

test('loadSeason: loads real 2020 data', function() {
	var transactions = fantraxFacts.loadSeason(2020);
	
	assertTrue(transactions.length > 100, 'Should have many transactions');
	assertEqual(transactions[0].season, 2020);
});

test('loadAll: loads both seasons', function() {
	var transactions = fantraxFacts.loadAll();
	
	assertTrue(transactions.length > 1000, 'Should have 1000+ transactions total');
	
	var has2020 = transactions.some(function(t) { return t.season === 2020; });
	var has2021 = transactions.some(function(t) { return t.season === 2021; });
	assertTrue(has2020 && has2021, 'Should have both seasons');
});

test('getClaims: filters to claims only', function() {
	var transactions = fantraxFacts.loadSeason(2020);
	var claims = fantraxFacts.getClaims(transactions);
	
	assertTrue(claims.length > 0, 'Should have claims');
	assertTrue(claims.every(function(t) { return t.type === 'Claim'; }), 'All should be claims');
});

test('getDrops: filters to drops only', function() {
	var transactions = fantraxFacts.loadSeason(2020);
	var drops = fantraxFacts.getDrops(transactions);
	
	assertTrue(drops.length > 0, 'Should have drops');
	assertTrue(drops.every(function(t) { return t.type === 'Drop'; }), 'All should be drops');
});

test('getSummary: returns correct stats', function() {
	var transactions = fantraxFacts.loadAll();
	var summary = fantraxFacts.getSummary(transactions);
	
	assertTrue(summary.total > 1000);
	assertTrue(summary.byType.Claim > 0);
	assertTrue(summary.byType.Drop > 0);
	assertTrue(Object.keys(summary.byOwner).length > 5, 'Should have multiple owners');
});

test('findSuspiciousTransactions: finds potential rollbacks', function() {
	var transactions = fantraxFacts.loadAll();
	var suspicious = fantraxFacts.findSuspiciousTransactions(transactions);
	
	// Just verify structure, there may or may not be suspicious ones
	assertTrue(Array.isArray(suspicious));
	if (suspicious.length > 0) {
		assertTrue(suspicious[0].claim !== undefined);
		assertTrue(suspicious[0].drop !== undefined);
	}
});

// === Summary ===

console.log('\n--- Summary ---');
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
