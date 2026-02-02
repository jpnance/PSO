/**
 * Unit tests for Fantrax facts parser (XHR JSON format).
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

test('parseDate: handles time with seconds', function() {
	var date = fantraxFacts.parseDate('Thu Dec 10, 2020, 12:43:59 PM');
	
	assertTrue(date instanceof Date);
	assertEqual(date.getUTCFullYear(), 2020);
	assertEqual(date.getUTCMonth(), 11); // December
});

test('parseDate: returns null for invalid', function() {
	assertEqual(fantraxFacts.parseDate('invalid'), null);
	assertEqual(fantraxFacts.parseDate(''), null);
	assertEqual(fantraxFacts.parseDate(null), null);
});

test('parseProcessedDate: extracts from toolTip HTML', function() {
	var toolTip = '<b>Processed</b> Thu Dec 10, 2020, 12:43:59 PM<br/><b>Created</b> Thu Dec 10, 2020, 12:43:59 PM';
	var date = fantraxFacts.parseProcessedDate(toolTip);
	
	assertTrue(date instanceof Date);
	assertEqual(date.getUTCFullYear(), 2020);
	assertEqual(date.getUTCMonth(), 11);
});

// === Real Data Tests ===

test('checkAvailability: detects JSON files', function() {
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

test('loadSeason: transactions have grouped structure', function() {
	var transactions = fantraxFacts.loadSeason(2020);
	var tx = transactions[0];
	
	assertTrue(tx.transactionId !== undefined, 'Should have transactionId');
	assertTrue(tx.type !== undefined, 'Should have type');
	assertTrue(Array.isArray(tx.adds), 'Should have adds array');
	assertTrue(Array.isArray(tx.drops), 'Should have drops array');
	assertTrue(tx.owner !== undefined, 'Should have owner');
});

test('loadAll: loads both seasons', function() {
	var transactions = fantraxFacts.loadAll();
	
	assertTrue(transactions.length > 1000, 'Should have 1000+ transactions total');
	
	var has2020 = transactions.some(function(t) { return t.season === 2020; });
	var has2021 = transactions.some(function(t) { return t.season === 2021; });
	assertTrue(has2020 && has2021, 'Should have both seasons');
});

test('getWaivers: filters to waiver transactions', function() {
	var transactions = fantraxFacts.loadSeason(2020);
	var waivers = fantraxFacts.getWaivers(transactions);
	
	assertTrue(waivers.length > 0, 'Should have waivers');
	assertTrue(waivers.every(function(t) { return t.type === 'waiver'; }), 'All should be waivers');
	// Waiver = has both adds and drops
	assertTrue(waivers.every(function(t) { 
		return t.adds.length > 0 && t.drops.length > 0; 
	}), 'Waivers should have both adds and drops');
});

test('getClaims: filters to claim-only transactions', function() {
	var transactions = fantraxFacts.loadSeason(2020);
	var claims = fantraxFacts.getClaims(transactions);
	
	assertTrue(claims.length > 0, 'Should have claims');
	assertTrue(claims.every(function(t) { return t.type === 'claim'; }), 'All should be claims');
});

test('getDrops: filters to drop-only transactions', function() {
	var transactions = fantraxFacts.loadSeason(2020);
	var drops = fantraxFacts.getDrops(transactions);
	
	assertTrue(drops.length > 0, 'Should have drops');
	assertTrue(drops.every(function(t) { return t.type === 'drop'; }), 'All should be drops');
});

test('getSummary: returns correct stats', function() {
	var transactions = fantraxFacts.loadAll();
	var summary = fantraxFacts.getSummary(transactions);
	
	assertTrue(summary.total > 1000);
	assertTrue(summary.totalAdds > 0, 'Should have adds count');
	assertTrue(summary.totalDrops > 0, 'Should have drops count');
	assertTrue(Object.keys(summary.byOwner).length > 5, 'Should have multiple owners');
	assertEqual(summary.unknownOwner, 0, 'Should have no unknown owners');
});

test('findCommissionerActions: finds in-season commissioner transactions', function() {
	var transactions = fantraxFacts.loadAll();
	var actions = fantraxFacts.findCommissionerActions(transactions);
	
	assertTrue(Array.isArray(actions));
	assertTrue(actions.length > 0, 'Should find some commissioner actions');
	if (actions.length > 0) {
		assertTrue(actions[0].context !== undefined, 'Should have context');
		assertTrue(Array.isArray(actions[0].context), 'Context should be array');
	}
});

// === Summary ===

console.log('\n--- Summary ---');
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
