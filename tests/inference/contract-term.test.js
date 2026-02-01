/**
 * Unit tests for contract term inference engine.
 * 
 * Usage: node tests/inference/contract-term.test.js
 */

var contractTerm = require('../../data/inference/contract-term');
var Confidence = contractTerm.Confidence;

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

// === getSeasonYear Tests ===

test('getSeasonYear: date after auction is current year', function() {
	var date = new Date('2024-09-15');
	assertEqual(contractTerm.getSeasonYear(date), 2024);
});

test('getSeasonYear: date before auction is previous year', function() {
	var date = new Date('2024-03-15');
	assertEqual(contractTerm.getSeasonYear(date), 2023);
});

test('getSeasonYear: date on auction day is current year', function() {
	var date = new Date('2024-08-24');
	assertEqual(contractTerm.getSeasonYear(date), 2024);
});

// === parseContractString Tests - Explicit Formats ===

test('parseContractString: explicit range 22/24', function() {
	var result = contractTerm.parseContractString('22/24', { date: new Date('2024-01-01') });
	assertEqual(result.startYear, 2022);
	assertEqual(result.endYear, 2024);
	assertEqual(result.confidence, Confidence.CERTAIN);
});

test('parseContractString: explicit range 2022/2024', function() {
	var result = contractTerm.parseContractString('2022/2024', { date: new Date() });
	assertEqual(result.startYear, 2022);
	assertEqual(result.endYear, 2024);
	assertEqual(result.confidence, Confidence.CERTAIN);
});

test('parseContractString: explicit dash range 2019-2021', function() {
	var result = contractTerm.parseContractString('2019-2021', { date: new Date() });
	assertEqual(result.startYear, 2019);
	assertEqual(result.endYear, 2021);
	assertEqual(result.confidence, Confidence.CERTAIN);
});

test('parseContractString: FA/21 notation', function() {
	var result = contractTerm.parseContractString('FA/21', { date: new Date() });
	assertEqual(result.startYear, null);
	assertEqual(result.endYear, 2021);
	assertEqual(result.confidence, Confidence.CERTAIN);
});

test('parseContractString: FA returns null values', function() {
	var result = contractTerm.parseContractString('FA', { date: new Date() });
	assertEqual(result.startYear, null);
	assertEqual(result.endYear, null);
});

// === parseContractString Tests - Single Year Heuristics ===

test('parseContractString: single year in inaugural season', function() {
	var result = contractTerm.parseContractString('2010', { date: new Date('2008-09-15') });
	assertEqual(result.startYear, 2008);
	assertEqual(result.endYear, 2010);
	assertEqual(result.confidence, Confidence.INFERRED);
	assertTrue(result.reason.indexOf('Inaugural') >= 0 || result.reason.indexOf('inaugural') >= 0);
});

test('parseContractString: single year 2+ years out is 3-year', function() {
	var result = contractTerm.parseContractString('2024', { date: new Date('2022-09-15') });
	assertEqual(result.startYear, 2022);
	assertEqual(result.endYear, 2024);
	assertEqual(result.confidence, Confidence.INFERRED);
});

test('parseContractString: single year same as season is ambiguous', function() {
	var result = contractTerm.parseContractString('2024', { date: new Date('2024-09-15') });
	assertEqual(result.endYear, 2024);
	assertEqual(result.confidence, Confidence.AMBIGUOUS);
});

test('parseContractString: single year 1 year out before due date', function() {
	// Trade in 2022, before contracts due, end year 2023 -> infer 3-year starting 2021
	var result = contractTerm.parseContractString('2023', { date: new Date('2022-08-20') });
	assertEqual(result.startYear, 2021);
	assertEqual(result.endYear, 2023);
	assertEqual(result.confidence, Confidence.INFERRED);
});

// === parseContractString Tests - RFA/UFA Suffixes ===

test('parseContractString: RFA suffix 2+ years out', function() {
	var result = contractTerm.parseContractString('2024-R', { date: new Date('2022-09-15') });
	assertEqual(result.startYear, 2022);
	assertEqual(result.endYear, 2024);
	assertEqual(result.confidence, Confidence.INFERRED);
});

test('parseContractString: UFA suffix is ambiguous', function() {
	var result = contractTerm.parseContractString('2024-U', { date: new Date('2024-09-15') });
	assertEqual(result.endYear, 2024);
	assertEqual(result.confidence, Confidence.AMBIGUOUS);
});

// === enhanceWithSnapshots Tests ===

test('enhanceWithSnapshots: upgrades to certain with matching snapshot', function() {
	var inference = {
		startYear: null,
		endYear: 2024,
		confidence: Confidence.AMBIGUOUS,
		reason: 'Test'
	};
	
	var snapshots = [
		{ playerName: 'Josh Allen', season: 2023, startYear: 2022, endYear: 2024, salary: 44 }
	];
	
	var result = contractTerm.enhanceWithSnapshots(inference, 'Josh Allen', snapshots);
	
	assertEqual(result.startYear, 2022);
	assertEqual(result.endYear, 2024);
	assertEqual(result.confidence, Confidence.CERTAIN);
});

test('enhanceWithSnapshots: no change if already certain', function() {
	var inference = {
		startYear: 2022,
		endYear: 2024,
		confidence: Confidence.CERTAIN,
		reason: 'Original'
	};
	
	var snapshots = [
		{ playerName: 'Josh Allen', season: 2023, startYear: 2020, endYear: 2022, salary: 44 }
	];
	
	var result = contractTerm.enhanceWithSnapshots(inference, 'Josh Allen', snapshots);
	
	assertEqual(result.startYear, 2022);
	assertEqual(result.reason, 'Original');
});

test('enhanceWithSnapshots: no change if no matching snapshot', function() {
	var inference = {
		startYear: null,
		endYear: 2024,
		confidence: Confidence.AMBIGUOUS,
		reason: 'Test'
	};
	
	var snapshots = [
		{ playerName: 'Different Player', season: 2023, startYear: 2022, endYear: 2024, salary: 44 }
	];
	
	var result = contractTerm.enhanceWithSnapshots(inference, 'Josh Allen', snapshots);
	
	assertEqual(result.confidence, Confidence.AMBIGUOUS);
});

// === enhanceWithDraft Tests ===

test('enhanceWithDraft: infers rookie contract', function() {
	var inference = {
		startYear: null,
		endYear: 2024,
		confidence: Confidence.AMBIGUOUS,
		reason: 'Test'
	};
	
	var drafts = [
		{ playerName: 'Caleb Williams', season: 2024, round: 1, pickNumber: 1 }
	];
	
	var result = contractTerm.enhanceWithDraft(
		inference,
		'Caleb Williams',
		40,
		new Date('2024-09-01'),
		drafts
	);
	
	assertEqual(result.startYear, 2024);
	assertEqual(result.endYear, 2024);
	assertEqual(result.confidence, Confidence.INFERRED);
	assertTrue(result.reason.indexOf('Rookie') >= 0 || result.reason.indexOf('draft') >= 0);
});

// === infer Tests ===

test('infer: combines all context for best result', function() {
	var snapshots = [
		{ playerName: 'Player X', season: 2023, startYear: 2022, endYear: 2024, salary: 50 }
	];
	
	var result = contractTerm.infer('2024', {
		date: new Date('2024-01-15'),
		playerName: 'Player X',
		salary: 50,
		snapshots: snapshots
	});
	
	assertEqual(result.startYear, 2022);
	assertEqual(result.endYear, 2024);
	assertEqual(result.confidence, Confidence.CERTAIN);
});

// === inferTradeContracts Tests ===

test('inferTradeContracts: processes all trades', function() {
	var trades = [{
		tradeId: 1,
		date: new Date('2024-01-15'),
		parties: [{
			owner: 'Schex',
			players: [{ name: 'Player A', salary: 50, contractStr: '22/24' }]
		}]
	}];
	
	var result = contractTerm.inferTradeContracts(trades, {});
	
	assertEqual(result[0].parties[0].players[0].inferredStartYear, 2022);
	assertEqual(result[0].parties[0].players[0].inferredEndYear, 2024);
	assertEqual(result[0].parties[0].players[0].confidence, Confidence.CERTAIN);
});

// === getInferenceStats Tests ===

test('getInferenceStats: counts correctly', function() {
	var trades = [{
		parties: [{
			players: [
				{ confidence: Confidence.CERTAIN, inferenceReason: 'Explicit' },
				{ confidence: Confidence.INFERRED, inferenceReason: 'Heuristic' },
				{ confidence: Confidence.AMBIGUOUS, inferenceReason: 'Unknown' }
			]
		}]
	}];
	
	var stats = contractTerm.getInferenceStats(trades);
	
	assertEqual(stats.total, 3);
	assertEqual(stats.certain, 1);
	assertEqual(stats.inferred, 1);
	assertEqual(stats.ambiguous, 1);
});

// === Real-world fixup cases (regression tests) ===

test('regression: Trade #10 Eli Manning 2008-2010', function() {
	// Trade #10 happened 2008-09-12, Eli Manning ($42, 2010)
	// Expected: 2008-2010 (inaugural season, 3-year contract)
	var result = contractTerm.parseContractString('2010', { 
		date: new Date('2008-09-12') 
	});
	
	assertEqual(result.startYear, 2008);
	assertEqual(result.endYear, 2010);
});

test('regression: Trade #18 Tom Brady 2009-2011', function() {
	// Trade #18 happened 2009-09-04, Tom Brady ($83, 2011)
	// Expected: 2009-2011
	var result = contractTerm.parseContractString('2011', { 
		date: new Date('2009-09-04') 
	});
	
	assertEqual(result.endYear, 2011);
	// 2009 trade, 2011 end = 2 years out = 3-year contract starting 2009
	assertEqual(result.startYear, 2009);
});

test('regression: Trade #50 Vincent Jackson 2011-2013', function() {
	// Trade #50 happened 2011-08-23, Vincent Jackson ($26, 2013)
	var result = contractTerm.parseContractString('2013', { 
		date: new Date('2011-08-23') 
	});
	
	assertEqual(result.endYear, 2013);
	assertEqual(result.startYear, 2011);
});

// === Summary ===

console.log('\n--- Summary ---');
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
