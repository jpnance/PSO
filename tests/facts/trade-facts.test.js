/**
 * Unit tests for trade facts parser.
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

function assertContains(str, substr, msg) {
	if (str.indexOf(substr) === -1) {
		throw new Error((msg || 'String does not contain expected substring') +
			'\n  Expected to contain: ' + substr +
			'\n  Actual: ' + str);
	}
}

// === Tests ===

test('decodeHtmlEntities handles common entities', function() {
	assertEqual(tradeFacts.decodeHtmlEntities("O&#8217;Sullivan"), "O'Sullivan");
	assertEqual(tradeFacts.decodeHtmlEntities("&amp;"), "&");
	assertEqual(tradeFacts.decodeHtmlEntities("&lt;tag&gt;"), "<tag>");
});

test('extractEspnId extracts ID from player URL', function() {
	assertEqual(
		tradeFacts.extractEspnId('http://espn.go.com/nfl/player/_/id/12345/josh-allen'),
		'12345'
	);
	assertEqual(
		tradeFacts.extractEspnId('http://games.espn.go.com/ffl/clubhouse?playerId=67890'),
		'67890'
	);
	assertEqual(tradeFacts.extractEspnId(null), null);
	assertEqual(tradeFacts.extractEspnId('http://google.com'), null);
});

test('parseTradeContent extracts player with link and contract', function() {
	var html = '<strong>Schex</strong> receives:<ul><li><a href="http://espn.go.com/nfl/player/_/id/12345/josh-allen">Josh Allen</a> ($44, 22/26)</li></ul>';
	var result = tradeFacts.parseTradeContent(html, new Date('2024-01-15'));
	
	assertEqual(result.parties.length, 1);
	assertEqual(result.parties[0].owner, 'Schex');
	assertEqual(result.parties[0].players.length, 1);
	assertEqual(result.parties[0].players[0].name, 'Josh Allen');
	assertEqual(result.parties[0].players[0].salary, 44);
	assertEqual(result.parties[0].players[0].contractStr, '22/26');
	assertEqual(result.parties[0].players[0].espnId, '12345');
});

test('parseTradeContent extracts player without link', function() {
	var html = '<strong>Koci</strong> receives:<ul><li>Joe Montana ($100, 2019)</li></ul>';
	var result = tradeFacts.parseTradeContent(html, new Date('2019-01-15'));
	
	assertEqual(result.parties[0].players.length, 1);
	assertEqual(result.parties[0].players[0].name, 'Joe Montana');
	assertEqual(result.parties[0].players[0].salary, 100);
	assertEqual(result.parties[0].players[0].contractStr, '2019');
	assertEqual(result.parties[0].players[0].espnId, null);
});

test('parseTradeContent preserves raw contract string', function() {
	// Single year
	var html1 = '<strong>A</strong> receives:<ul><li>Player One ($10, 2019)</li></ul>';
	assertEqual(tradeFacts.parseTradeContent(html1, new Date()).parties[0].players[0].contractStr, '2019');
	
	// Range
	var html2 = '<strong>A</strong> receives:<ul><li>Player Two ($10, 09/11)</li></ul>';
	assertEqual(tradeFacts.parseTradeContent(html2, new Date()).parties[0].players[0].contractStr, '09/11');
	
	// FA notation
	var html3 = '<strong>A</strong> receives:<ul><li>Player Three ($10, FA/21)</li></ul>';
	assertEqual(tradeFacts.parseTradeContent(html3, new Date()).parties[0].players[0].contractStr, 'FA/21');
	
	// RFA marker
	var html4 = '<strong>A</strong> receives:<ul><li>Player Four ($10, 2021-R)</li></ul>';
	assertEqual(tradeFacts.parseTradeContent(html4, new Date()).parties[0].players[0].contractStr, '2021-R');
	
	// UFA marker
	var html5 = '<strong>A</strong> receives:<ul><li>Player Five ($10, 2021-U)</li></ul>';
	assertEqual(tradeFacts.parseTradeContent(html5, new Date()).parties[0].players[0].contractStr, '2021-U');
});

test('parseTradeContent extracts picks', function() {
	var html = '<strong>Nance</strong> receives:<ul><li>1st round pick from Schex in 2025</li></ul>';
	var result = tradeFacts.parseTradeContent(html, new Date());
	
	assertEqual(result.parties[0].picks.length, 1);
	assertEqual(result.parties[0].picks[0].round, 1);
	assertEqual(result.parties[0].picks[0].fromOwner, 'Schex');
	assertEqual(result.parties[0].picks[0].season, 2025);
});

test('parseTradeContent extracts picks with via notation', function() {
	var html = '<strong>A</strong> receives:<ul><li>2nd round pick from Brett/Luke (via Koci) in 2024</li></ul>';
	var result = tradeFacts.parseTradeContent(html, new Date());
	
	assertEqual(result.parties[0].picks[0].round, 2);
	assertEqual(result.parties[0].picks[0].fromOwner, 'Brett/Luke');
	assertEqual(result.parties[0].picks[0].viaOwner, 'Koci');
	assertEqual(result.parties[0].picks[0].season, 2024);
});

test('parseTradeContent extracts cash', function() {
	var html = '<strong>A</strong> receives:<ul><li>$500 from Koci in 2025</li></ul>';
	var result = tradeFacts.parseTradeContent(html, new Date());
	
	assertEqual(result.parties[0].cash.length, 1);
	assertEqual(result.parties[0].cash[0].amount, 500);
	assertEqual(result.parties[0].cash[0].fromOwner, 'Koci');
	assertEqual(result.parties[0].cash[0].season, 2025);
});

test('parseTradeContent extracts RFA rights', function() {
	var html = '<strong>A</strong> receives:<ul><li><a href="http://espn.go.com/nfl/player/_/id/999/cooper-kupp">Cooper Kupp</a> (RFA rights)</li></ul>';
	var result = tradeFacts.parseTradeContent(html, new Date());
	
	assertEqual(result.parties[0].rfaRights.length, 1);
	assertEqual(result.parties[0].rfaRights[0].name, 'Cooper Kupp');
	assertEqual(result.parties[0].rfaRights[0].espnId, '999');
	assertEqual(result.parties[0].players.length, 0); // Not in players array
});

test('parseTradeContent handles multi-party trade', function() {
	var html = '<strong>Schex</strong> receives:<ul><li>Player A ($10, 2024)</li></ul>' +
	           '<strong>Koci</strong> receives:<ul><li>Player B ($20, 2024)</li></ul>' +
	           '<strong>Nance</strong> receives:<ul><li>$100 from Schex in 2024</li></ul>';
	var result = tradeFacts.parseTradeContent(html, new Date());
	
	assertEqual(result.parties.length, 3);
	assertEqual(result.parties[0].owner, 'Schex');
	assertEqual(result.parties[1].owner, 'Koci');
	assertEqual(result.parties[2].owner, 'Nance');
});

test('parseTradeContent handles Nothing gracefully', function() {
	var html = '<strong>A</strong> receives:<ul><li>Nothing</li></ul>';
	var result = tradeFacts.parseTradeContent(html, new Date());
	
	assertEqual(result.parties[0].players.length, 0);
	assertEqual(result.parties[0].picks.length, 0);
	assertEqual(result.parties[0].cash.length, 0);
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
