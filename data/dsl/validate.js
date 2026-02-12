#!/usr/bin/env node
/**
 * DSL State Machine Validator
 *
 * Validates player-history.dsl for logical consistency.
 *
 * Usage:
 *   node data/dsl/validate.js
 */

var fs = require('fs');
var path = require('path');

var PSO = require('../../config/pso.js');

var DSL_FILE = path.join(__dirname, 'player-history.dsl');

// Build owner name -> Set of franchiseIds (a name like "Schexes" can map to
// multiple franchises across different eras)
var ownerToFranchiseIds = {};
function addOwnerMapping(name, id) {
	if (!ownerToFranchiseIds[name]) ownerToFranchiseIds[name] = new Set();
	ownerToFranchiseIds[name].add(id);
}
Object.keys(PSO.franchiseNames).forEach(function(rosterId) {
	var yearMap = PSO.franchiseNames[rosterId];
	Object.keys(yearMap).forEach(function(year) {
		addOwnerMapping(yearMap[year], parseInt(rosterId));
	});
});
Object.keys(PSO.franchiseIds).forEach(function(name) {
	addOwnerMapping(name, PSO.franchiseIds[name]);
});

function sameOwner(a, b) {
	if (a === b) return true;
	var setA = ownerToFranchiseIds[a];
	var setB = ownerToFranchiseIds[b];
	if (!setA || !setB) return false;
	// Check for any overlapping franchise ID
	for (var id of setA) {
		if (setB.has(id)) return true;
	}
	return false;
}

// =============================================================================
// Parsing
// =============================================================================

/**
 * Parse a DSL event line into a structured object.
 * Returns null for non-event lines (comments, blanks, headers).
 */
function parseEvent(line) {
	var m;

	m = line.match(/^\s+(\d+) draft (\S+(?:\/\S+)?) (\d+\.\d+)/);
	if (m) return { season: 2000 + parseInt(m[1]), type: 'draft', owner: m[2], detail: m[3] };

	m = line.match(/^\s+(\d+) auction (\S+(?:\/\S+)?) \$(\d+)/);
	if (m) return { season: 2000 + parseInt(m[1]), type: 'auction', owner: m[2], detail: '$' + m[3] };

	m = line.match(/^\s+(\d+) contract \$(\d+) (\S+)/);
	if (m) return { season: 2000 + parseInt(m[1]), type: 'contract', detail: m[3] };

	m = line.match(/^\s+(\d+) fa (\S+(?:\/\S+)?) \$(\d+) (\S+)/);
	if (m) return { season: 2000 + parseInt(m[1]), type: 'fa', owner: m[2], detail: '$' + m[3] + ' ' + m[4] };

	m = line.match(/^\s+(\d+) trade (\d+) -> (\S+(?:\/\S+)?)/);
	if (m) return { season: 2000 + parseInt(m[1]), type: 'trade', tradeId: parseInt(m[2]), owner: m[3] };

	m = line.match(/^\s+(\d+) (drop|cut) # by (\S+(?:\/\S+)?)/);
	if (m) return { season: 2000 + parseInt(m[1]), type: m[2], owner: m[3] };

	m = line.match(/^\s+(\d+) expansion (\S+(?:\/\S+)?) from (\S+(?:\/\S+)?)/);
	if (m) return { season: 2000 + parseInt(m[1]), type: 'expansion', owner: m[2], fromOwner: m[3] };

	m = line.match(/^\s+(\d+) protect (\S+(?:\/\S+)?)/);
	if (m) return { season: 2000 + parseInt(m[1]), type: 'protect', owner: m[2] };

	return null;
}

/**
 * Parse the DSL file into an array of player objects.
 * Each player has { header, events[] }.
 */
function parseDSL(filePath) {
	var content = fs.readFileSync(filePath, 'utf8');
	var lines = content.split('\n');
	var players = [];
	var current = null;

	for (var i = 0; i < lines.length; i++) {
		var line = lines[i];

		// Player header
		if (line.match(/^\S/) && line.indexOf('|') > 0) {
			if (current) players.push(current);
			current = { header: line.trim(), events: [], lineNumber: i + 1 };
			continue;
		}

		// Event line
		if (current) {
			var event = parseEvent(line);
			if (event) {
				event.lineNumber = i + 1;
				event.raw = line;
				current.events.push(event);
			}
		}
	}
	if (current) players.push(current);

	return players;
}

// =============================================================================
// Checks
// =============================================================================

// Events that set ownership (from unowned state)
var ACQUIRE_EVENTS = { draft: true, auction: true, fa: true };

// Events that transfer ownership (from owned state) — handled separately
// trade, expansion

// Events that clear ownership
var RELEASE_EVENTS = { drop: true, cut: true };

/**
 * Check 1: Owner consistency on cuts/drops.
 * The owner in "drop/cut # by OWNER" should match the current owner.
 */
function checkOwnerConsistency(player) {
	var issues = [];
	var owner = null;

	for (var i = 0; i < player.events.length; i++) {
		var e = player.events[i];

		if (ACQUIRE_EVENTS[e.type] || e.type === 'trade' || e.type === 'expansion') {
			owner = e.owner;
		} else if (RELEASE_EVENTS[e.type]) {
			if (owner && !sameOwner(e.owner, owner)) {
				issues.push({
					check: 'owner-mismatch',
					player: player.header,
					message: 'Released by ' + e.owner + ' but owned by ' + owner,
					line: e.raw.trim(),
					lineNumber: e.lineNumber
				});
			}
			owner = null;
		}
		// contract and protect don't change ownership
	}

	return issues;
}

/**
 * Parse the end year from a contract detail string.
 * Examples: "08/10" -> 2010, "FA/09" -> 2009, "unsigned" -> null
 */
function parseContractEnd(detail) {
	if (!detail) return null;
	var m = detail.match(/(\d+)$/);
	if (m) return 2000 + parseInt(m[1]);
	return null;
}

/**
 * Check 2: Acquire/release state machine.
 * - Acquire events (draft, auction, fa, expansion) require unowned state.
 * - Trade requires owned state (transfers ownership).
 * - Release events (drop, cut) require owned state.
 * - Contract expiration is an implicit release (new season > contract end year).
 * - No double-acquires or double-releases.
 */
function checkAcquireRelease(player) {
	var issues = [];
	var owned = false;
	var owner = null;
	var contractEnd = null;

	for (var i = 0; i < player.events.length; i++) {
		var e = player.events[i];

		// Contract expiration: implicit release when the contract has ended.
		// Only triggers before acquire/transfer events — if the next event is
		// a cut/drop, that IS the explicit release and we shouldn't preempt it.
		//
		// Offseason events (auction, draft, expansion, cut) happen before the
		// season starts, so a contract ending in season N is expired by season N.
		// In-season events (fa, trade, drop) need the season to be strictly past.
		if (owned && contractEnd !== null && !RELEASE_EVENTS[e.type]) {
			// Auction and draft replace the contract, so >= is correct.
			// Expansion happens before the auction — players are still rostered.
			var isOffseasonEvent = (e.type === 'auction' || e.type === 'draft');
			var expired = isOffseasonEvent
				? e.season >= contractEnd
				: e.season > contractEnd;
			if (expired) {
				owned = false;
				owner = null;
				contractEnd = null;
			}
		}

		if (e.type === 'contract') {
			contractEnd = parseContractEnd(e.detail);
		} else if (e.type === 'trade' || e.type === 'expansion') {
			// Trades and expansion selections transfer ownership — player must be owned
			if (!owned) {
				issues.push({
					check: e.type + '-unowned',
					player: player.header,
					message: (e.type === 'trade' ? 'Traded to ' : 'Expansion selected by ') + e.owner + ' but player is not owned',
					line: e.raw.trim(),
					lineNumber: e.lineNumber
				});
			}
			owned = true;
			owner = e.owner;
		} else if (ACQUIRE_EVENTS[e.type]) {
			if (owned) {
				issues.push({
					check: 'double-acquire',
					player: player.header,
					message: 'Acquired by ' + e.owner + ' via ' + e.type + ' but already owned by ' + owner,
					line: e.raw.trim(),
					lineNumber: e.lineNumber
				});
			}
			owned = true;
			owner = e.owner;
			// FA events embed contract info (e.g. "$15 FA/18") — extract end year
			// For other acquire events, contractEnd will be set by a following contract event
			contractEnd = (e.type === 'fa') ? parseContractEnd(e.detail) : null;
		} else if (RELEASE_EVENTS[e.type]) {
			if (!owned) {
				issues.push({
					check: 'release-unowned',
					player: player.header,
					message: 'Released by ' + e.owner + ' but player is not owned',
					line: e.raw.trim(),
					lineNumber: e.lineNumber
				});
			}
			owned = false;
			owner = null;
			contractEnd = null;
		}
		// protect doesn't change state
	}

	return issues;
}

// =============================================================================
// Main
// =============================================================================

var checks = [
	{ name: 'Owner consistency on cuts/drops', fn: checkOwnerConsistency },
	{ name: 'Acquire/release state machine', fn: checkAcquireRelease }
];

function main() {
	var players = parseDSL(DSL_FILE);
	console.log('Parsed ' + players.length + ' players from ' + DSL_FILE);
	console.log('');

	var totalIssues = 0;

	checks.forEach(function(check) {
		var issues = [];
		players.forEach(function(player) {
			issues = issues.concat(check.fn(player));
		});

		console.log('Check: ' + check.name);
		if (issues.length === 0) {
			console.log('  PASS (' + players.length + ' players)');
		} else {
			console.log('  FAIL (' + issues.length + ' issues)');
			issues.forEach(function(issue) {
				console.log('  ' + issue.player);
				console.log('    ' + issue.message);
				console.log('    ' + issue.line);
			});
		}
		console.log('');
		totalIssues += issues.length;
	});

	console.log('Total: ' + totalIssues + ' issues');
	process.exit(totalIssues > 0 ? 1 : 0);
}

main();
