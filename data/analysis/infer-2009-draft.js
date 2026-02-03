#!/usr/bin/env node
/**
 * Infer 2009 Rookie Draft from snapshot facts.
 * 
 * Usage:
 *   node data/analysis/infer-2009-draft.js
 *   node data/analysis/infer-2009-draft.js --nfl-draft=path/to/nfl-2009.txt
 *   node data/analysis/infer-2009-draft.js --draft-order=path/to/order.txt
 */

var fs = require('fs');
var path = require('path');
var facts = require('../facts');

// 2009 rookie salaries - averages of top 10 salaries at each position (from rookies.php)
var POSITION_AVERAGES = {
	'DB': 12.4,
	'DL': 13.4,
	'K': 2.2,
	'LB': 14,
	'QB': 124.5,
	'RB': 270.2,
	'TE': 53,
	'WR': 137.3
};

// 2009 PSO draft order (same order every round, not snake)
var DRAFT_ORDER = ['Daniel', 'Patrick', 'Syed', 'John', 'Koci', 'Luke', 'Trevor', 'James', 'Keyon', 'Schexes'];

// Normalize owner names for matching
function normalizeOwner(owner) {
	if (!owner) return null;
	// Handle "Jake/Luke" -> "Luke"
	if (owner === 'Jake/Luke') return 'Luke';
	return owner;
}

// Linear decay formula for 2009
function computeSalary(firstRoundValue, round) {
	return Math.ceil(firstRoundValue * (11 - round) / 10);
}

// Build salary -> round lookup for each position
function buildSalaryToRound() {
	var lookup = {};
	
	Object.keys(POSITION_AVERAGES).forEach(function(pos) {
		lookup[pos] = {};
		var avg = POSITION_AVERAGES[pos];
		
		for (var round = 1; round <= 10; round++) {
			var salary = computeSalary(avg, round);
			lookup[pos][salary] = round;
		}
	});
	
	return lookup;
}

// Compute overall pick number from owner and round
function computeOverallPick(owner, round) {
	var normalized = normalizeOwner(owner);
	var slotInRound = DRAFT_ORDER.indexOf(normalized);
	if (slotInRound < 0) return null;
	
	return (round - 1) * 10 + slotInRound + 1;
}

// Parse command line for file paths
function parseArgs() {
	var args = {
		nflDraftFile: null,
		draftOrderFile: null
	};
	
	process.argv.forEach(function(arg) {
		if (arg.startsWith('--nfl-draft=')) {
			args.nflDraftFile = arg.split('=')[1];
		}
		if (arg.startsWith('--draft-order=')) {
			args.draftOrderFile = arg.split('=')[1];
		}
	});
	
	return args;
}

// Load NFL draft list (CSV format: Round,Pick,Team,Player,Position,College,Conference,Notes)
function loadNflDraft(filepath) {
	if (!filepath || !fs.existsSync(filepath)) return null;
	
	var content = fs.readFileSync(filepath, 'utf8');
	var lines = content.trim().split('\n');
	var players = {};
	
	lines.forEach(function(line) {
		// Skip header and note rows
		if (line.startsWith('Rnd') || line.startsWith('from ') || !line.trim()) return;
		
		var cols = line.split(',');
		if (cols.length < 5) return;
		
		var name = cols[3].trim();
		var nflPos = cols[4].trim();
		
		if (name) {
			players[name.toLowerCase()] = {
				name: name,
				nflPosition: nflPos,
				nflRound: parseInt(cols[0]),
				nflPick: parseInt(cols[1])
			};
		}
	});
	
	return players;
}

// Main
function run() {
	var args = parseArgs();
	
	console.log('=== 2009 Rookie Draft Inference ===\n');
	
	// Load all snapshot facts
	var snapshots = facts.snapshots.loadAll(2009, 2009);
	console.log('Loaded', snapshots.length, 'snapshot facts for 2009');
	
	// Find contracts starting in 2009
	var startingIn2009 = snapshots.filter(function(s) {
		return s.startYear === 2009 && s.owner;
	});
	console.log('Contracts starting in 2009:', startingIn2009.length);
	
	// Build salary lookup
	var salaryToRound = buildSalaryToRound();
	
	// Load NFL draft if provided
	var nflDraft = loadNflDraft(args.nflDraftFile);
	if (nflDraft) {
		console.log('NFL draft list loaded:', Object.keys(nflDraft).length, 'players');
	}
	
	console.log('\n--- Potential Rookies (contracts starting 2009) ---\n');
	
	// Analyze each contract
	var candidates = [];
	
	startingIn2009.forEach(function(contract) {
		var pos = contract.position ? contract.position.split('/')[0] : null;
		var salary = contract.salary;
		var inferredRound = null;
		
		// Check if salary matches a rookie slot
		if (pos && salaryToRound[pos] && salaryToRound[pos][salary]) {
			inferredRound = salaryToRound[pos][salary];
		}
		
		// Check if in NFL draft list
		var nflInfo = null;
		if (nflDraft) {
			var normalized = contract.playerName.toLowerCase();
			nflInfo = nflDraft[normalized] || null;
		}
		
		candidates.push({
			name: contract.playerName,
			owner: contract.owner,
			position: contract.position,
			salary: salary,
			startYear: contract.startYear,
			endYear: contract.endYear,
			inferredRound: inferredRound,
			nflInfo: nflInfo,
			espnId: contract.espnId
		});
	});
	
	// Sort by salary descending (higher salary = higher pick likely)
	candidates.sort(function(a, b) { return b.salary - a.salary; });
	
	// Dedupe by player name (keep first occurrence)
	var seen = {};
	candidates = candidates.filter(function(c) {
		var key = c.name.toLowerCase();
		if (seen[key]) return false;
		seen[key] = true;
		return true;
	});
	
	// Filter to drafted rookies (in NFL draft list AND salary matches a slot)
	var draftedRookies = candidates.filter(function(c) {
		return c.nflInfo !== null && c.inferredRound !== null;
	});
	
	if (draftedRookies.length > 0) {
		// Add inferred PSO pick numbers
		draftedRookies.forEach(function(c) {
			c.psoPick = computeOverallPick(c.owner, c.inferredRound);
		});
		
		// Sort by PSO pick
		draftedRookies.sort(function(a, b) {
			return a.psoPick - b.psoPick;
		});
		
		console.log('2009 PSO Drafted Rookies (' + draftedRookies.length + '):\n');
		console.log('PSO Pick | Round | Salary | Pos | Player | Owner | NFL Draft');
		console.log('---------|-------|--------|-----|--------|-------|----------');
		
		draftedRookies.forEach(function(c) {
			var pickStr = String(c.psoPick).padStart(3);
			var roundStr = 'R' + c.inferredRound;
			var salaryStr = ('$' + c.salary).padStart(5);
			var posStr = (c.position || '??').padEnd(4).slice(0, 4);
			var nameStr = c.name.padEnd(25).slice(0, 25);
			var ownerStr = c.owner.padEnd(10).slice(0, 10);
			var nflStr = 'R' + c.nflInfo.nflRound + ' #' + c.nflInfo.nflPick + ' ' + c.nflInfo.nflPosition;
			console.log('    ' + pickStr + ' |  ' + roundStr + '  | ' + salaryStr + ' | ' + posStr + '| ' + nameStr + '| ' + ownerStr + '| ' + nflStr);
		});
	}
	
	// Summary by position
	console.log('\n--- Rookie slot salary reference ---\n');
	console.log('Position | R1    | R2    | R3    | R4    | R5');
	console.log('---------|-------|-------|-------|-------|-------');
	
	['QB', 'RB', 'WR', 'TE', 'DL', 'LB', 'DB', 'K'].forEach(function(pos) {
		var avg = POSITION_AVERAGES[pos];
		var row = pos.padEnd(8) + ' | ';
		for (var r = 1; r <= 5; r++) {
			row += ('$' + computeSalary(avg, r)).padEnd(5) + ' | ';
		}
		console.log(row);
	});
}

run();
