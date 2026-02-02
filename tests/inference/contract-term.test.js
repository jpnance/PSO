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

test('parseContractString: FA returns certain with null start and season end', function() {
	var result = contractTerm.parseContractString('FA', { date: new Date('2024-10-15') });
	assertEqual(result.startYear, null);
	assertEqual(result.endYear, 2024);
	assertEqual(result.confidence, Confidence.CERTAIN);
});

test('parseContractString: unsigned is certain with null/null', function() {
	// Unsigned means rookie pre-contract-due, acquiring owner assigns term
	// Both null - start year implicit from trade date, end year TBD
	var result = contractTerm.parseContractString('unsigned', { date: new Date('2024-08-25') });
	assertEqual(result.startYear, null);
	assertEqual(result.endYear, null);
	assertEqual(result.confidence, Confidence.CERTAIN);
	assertTrue(result.reason.indexOf('unsigned') >= 0);
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

test('parseContractString: UFA suffix is ambiguous without snapshot', function() {
	// -U means 1-year ending this season, no RFA rights
	// Could be FA/2024 or 2024/2024 - needs snapshot to confirm
	var result = contractTerm.parseContractString('2024-U', { date: new Date('2024-09-15') });
	assertEqual(result.endYear, 2024);
	assertEqual(result.confidence, Confidence.AMBIGUOUS);
	assertTrue(result.reason.indexOf('snapshot') >= 0);
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

test('enhanceWithSnapshots: confirms FA contract (null startYear)', function() {
	// -U suffix case: could be FA/2019 or 2019/2019
	// Snapshot shows FA (null startYear) - should confirm
	var inference = {
		startYear: null,
		endYear: 2019,
		confidence: Confidence.AMBIGUOUS,
		reason: 'UFA suffix'
	};
	
	var snapshots = [
		{ playerName: 'Zach Pascal', season: 2019, startYear: null, endYear: 2019, salary: 11 }
	];
	
	var result = contractTerm.enhanceWithSnapshots(inference, 'Zach Pascal', snapshots);
	
	assertEqual(result.startYear, null);
	assertEqual(result.endYear, 2019);
	assertEqual(result.confidence, Confidence.CERTAIN);
});

test('enhanceWithSnapshots: matches player with parenthetical suffix', function() {
	// Trade has "David Johnson", snapshot has "David Johnson (ARI)"
	var inference = {
		startYear: null,
		endYear: 2018,
		confidence: Confidence.AMBIGUOUS,
		reason: 'Test'
	};
	
	var snapshots = [
		{ playerName: 'David Johnson (ARI)', season: 2018, startYear: 2018, endYear: 2018, salary: 270 }
	];
	
	var result = contractTerm.enhanceWithSnapshots(inference, 'David Johnson', snapshots);
	
	assertEqual(result.startYear, 2018);
	assertEqual(result.endYear, 2018);
	assertEqual(result.confidence, Confidence.CERTAIN);
});

// === enhanceWithCuts Tests ===

test('enhanceWithCuts: confirms FA contract from cut data', function() {
	var inference = {
		startYear: null,
		endYear: 2018,
		confidence: Confidence.AMBIGUOUS,
		reason: 'Test'
	};
	
	var cuts = [
		{ name: 'Malcolm Brown', cutYear: 2018, startYear: null, endYear: 2018, salary: 1 }
	];
	
	var result = contractTerm.enhanceWithCuts(inference, 'Malcolm Brown', cuts);
	
	assertEqual(result.startYear, null);
	assertEqual(result.endYear, 2018);
	assertEqual(result.confidence, Confidence.CERTAIN);
});

test('enhanceWithCuts: no change if already certain', function() {
	var inference = {
		startYear: 2020,
		endYear: 2022,
		confidence: Confidence.CERTAIN,
		reason: 'Original'
	};
	
	var cuts = [
		{ name: 'Some Player', cutYear: 2021, startYear: null, endYear: 2021, salary: 5 }
	];
	
	var result = contractTerm.enhanceWithCuts(inference, 'Some Player', cuts);
	
	assertEqual(result.startYear, 2020);
	assertEqual(result.confidence, Confidence.CERTAIN);
	assertEqual(result.reason, 'Original');
});

// === enhanceWithPreseasonRoster Tests ===

test('enhanceWithPreseasonRoster: not rostered at season start = FA', function() {
	// Carlos Dunlap traded mid-2013, not in contracts-2013.txt
	var inference = {
		startYear: 2013,
		endYear: 2013,
		confidence: Confidence.AMBIGUOUS,
		reason: 'Single year'
	};
	
	// Empty preseason roster (player not found)
	var preseasonRoster = [
		{ playerName: 'Other Player', owner: 'Schex', season: 2013, startYear: 2013, endYear: 2015 }
	];
	
	var result = contractTerm.enhanceWithPreseasonRoster(
		inference,
		'Carlos Dunlap',
		new Date('2013-11-14'), // mid-season
		preseasonRoster
	);
	
	assertEqual(result.startYear, null);
	assertEqual(result.endYear, 2013);
	assertEqual(result.confidence, Confidence.CERTAIN);
	assertTrue(result.reason.indexOf('FA') >= 0 || result.reason.indexOf('Not rostered') >= 0);
});

test('enhanceWithPreseasonRoster: rostered player unchanged', function() {
	var inference = {
		startYear: 2013,
		endYear: 2013,
		confidence: Confidence.AMBIGUOUS,
		reason: 'Single year'
	};
	
	// Player IS in preseason roster
	var preseasonRoster = [
		{ playerName: 'Tom Brady', owner: 'Schex', season: 2013, startYear: 2012, endYear: 2014 }
	];
	
	var result = contractTerm.enhanceWithPreseasonRoster(
		inference,
		'Tom Brady',
		new Date('2013-11-14'),
		preseasonRoster
	);
	
	// Should remain ambiguous since we can't determine from this alone
	assertEqual(result.confidence, Confidence.AMBIGUOUS);
});

test('enhanceWithPreseasonRoster: pre-season trade unchanged', function() {
	var inference = {
		startYear: 2013,
		endYear: 2013,
		confidence: Confidence.AMBIGUOUS,
		reason: 'Single year'
	};
	
	var preseasonRoster = [];
	
	// Trade before season starts - doesn't apply
	var result = contractTerm.enhanceWithPreseasonRoster(
		inference,
		'Some Player',
		new Date('2013-08-15'), // before season start
		preseasonRoster
	);
	
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

test('regression: 2019-U suffix resolves via snapshot', function() {
	// Drew Brees traded with 2019-U, snapshot shows 2019/2019 (not FA)
	var snapshots = [
		{ playerName: 'Drew Brees', season: 2019, startYear: 2019, endYear: 2019, salary: 110 }
	];
	
	var result = contractTerm.infer('2019-U', {
		date: new Date('2019-11-07'),
		playerName: 'Drew Brees',
		salary: 110,
		snapshots: snapshots
	});
	
	assertEqual(result.startYear, 2019);
	assertEqual(result.endYear, 2019);
	assertEqual(result.confidence, Confidence.CERTAIN);
});

test('regression: mid-season $1 trade confirmed as FA via cuts', function() {
	// Will Dissly traded mid-2019 with "2019", cut shows FA/2019
	var cuts = [
		{ name: 'Will Dissly', cutYear: 2019, startYear: null, endYear: 2019, salary: 4 }
	];
	
	var result = contractTerm.infer('2019', {
		date: new Date('2019-09-24'),
		playerName: 'Will Dissly',
		salary: 4,
		snapshots: [],
		cuts: cuts
	});
	
	assertEqual(result.startYear, null);
	assertEqual(result.endYear, 2019);
	assertEqual(result.confidence, Confidence.CERTAIN);
});

// === Summary ===

console.log('\n--- Summary ---');
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
