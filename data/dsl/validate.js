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

// Events that set ownership
var ACQUIRE_EVENTS = { draft: true, auction: true, fa: true, trade: true, expansion: true };

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

		if (ACQUIRE_EVENTS[e.type]) {
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

// =============================================================================
// Main
// =============================================================================

var checks = [
	{ name: 'Owner consistency on cuts/drops', fn: checkOwnerConsistency }
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
