/**
 * Enrich a contracts snapshot with contract data from cuts.
 * 
 * When a player was cut during/after the season, the snapshot may show them
 * as FA with $1 salary. The cuts data tells us what their actual contract was.
 * 
 * This script patches the snapshot with correct contract info from cuts.
 * 
 * Usage:
 *   node data/archive/scripts/enrich-snapshot-from-cuts.js 2009
 *   node data/archive/scripts/enrich-snapshot-from-cuts.js 2009 --write
 */

var fs = require('fs');
var path = require('path');

var SNAPSHOTS_DIR = path.join(__dirname, '../snapshots');
var CUTS_FILE = path.join(__dirname, '../../cuts/cuts.json');
var PSO = require('../../../config/pso.js');

/**
 * Get the historical owner name for a cut based on rosterId and year.
 */
function getHistoricalOwner(cut) {
	if (!cut.rosterId) {
		return cut.owner; // fallback to current owner
	}
	
	var yearNames = PSO.franchiseNames[cut.rosterId];
	if (!yearNames) {
		return cut.owner;
	}
	
	return yearNames[cut.cutYear] || cut.owner;
}

function run() {
	var args = process.argv.slice(2);
	var year = parseInt(args.find(function(a) { return !a.startsWith('--'); }), 10);
	var write = args.includes('--write');
	
	if (!year || isNaN(year)) {
		console.log('Usage: node enrich-snapshot-from-cuts.js <year> [--write]');
		process.exit(1);
	}
	
	// Load snapshot
	var snapshotPath = path.join(SNAPSHOTS_DIR, 'contracts-' + year + '.txt');
	if (!fs.existsSync(snapshotPath)) {
		console.log('Snapshot not found:', snapshotPath);
		process.exit(1);
	}
	
	var content = fs.readFileSync(snapshotPath, 'utf8');
	var lines = content.split('\n');
	var header = lines[0];
	
	// Parse snapshot into objects
	var snapshot = [];
	for (var i = 1; i < lines.length; i++) {
		var line = lines[i].trim();
		if (!line) continue;
		
		var parts = line.split(',');
		snapshot.push({
			id: parts[0],
			owner: parts[1],
			name: parts[2],
			position: parts[3],
			start: parts[4],
			end: parts[5],
			salary: parts[6],
			originalLine: line
		});
	}
	
	console.log('Loaded snapshot with', snapshot.length, 'entries');
	
	// Load cuts
	var cuts = require(CUTS_FILE);
	
	// Filter to cuts for this year where the contract started in this year or earlier
	// (meaning they were auctioned/acquired and had a contract)
	var relevantCuts = cuts.filter(function(c) {
		return c.cutYear === year && c.startYear !== null && c.startYear <= year;
	});
	
	console.log('Found', relevantCuts.length, 'relevant cuts for', year);
	
	// Build cuts lookup by normalized name
	var cutsByName = {};
	relevantCuts.forEach(function(c) {
		var key = c.name.toLowerCase();
		// Keep the one with earliest startYear (original contract)
		if (!cutsByName[key] || c.startYear < cutsByName[key].startYear) {
			cutsByName[key] = c;
		}
	});
	
	// Patch snapshot
	var patched = 0;
	var added = 0;
	var patchedNames = [];
	
	snapshot.forEach(function(entry) {
		var key = entry.name.toLowerCase();
		var cut = cutsByName[key];
		
		if (!cut) return;
		
		// Check if snapshot shows FA but cuts show a real contract
		if (entry.start === 'FA' && cut.startYear !== null) {
			var historicalOwner = getHistoricalOwner(cut);
			
			patchedNames.push({
				name: entry.name,
				oldOwner: entry.owner,
				newOwner: historicalOwner,
				oldStart: entry.start,
				newStart: cut.startYear,
				oldEnd: entry.end,
				newEnd: cut.endYear,
				oldSalary: entry.salary,
				newSalary: '$' + cut.salary
			});
			
			entry.owner = historicalOwner;
			entry.start = String(cut.startYear);
			entry.end = String(cut.endYear);
			entry.salary = '$' + cut.salary;
			patched++;
		}
		
		// Remove from cutsByName so we can track unmatched cuts
		delete cutsByName[key];
	});
	
	// Check for cuts of players not in snapshot at all
	var missing = Object.values(cutsByName);
	if (missing.length > 0) {
		console.log('');
		console.log('Cuts for players NOT in snapshot (' + missing.length + '):');
		missing.slice(0, 20).forEach(function(c) {
			console.log('  ' + c.name + ' (' + c.owner + ', ' + c.startYear + '-' + c.endYear + ', $' + c.salary + ')');
		});
		if (missing.length > 20) {
			console.log('  ... and ' + (missing.length - 20) + ' more');
		}
	}
	
	console.log('');
	console.log('Patched', patched, 'entries');
	
	if (patchedNames.length > 0) {
		console.log('');
		console.log('Changes:');
		patchedNames.forEach(function(p) {
			console.log('  ' + p.name + ': ' + p.oldOwner + ' FA/' + p.oldEnd + ' ' + p.oldSalary + 
				' -> ' + p.newOwner + ' ' + p.newStart + '/' + p.newEnd + ' ' + p.newSalary);
		});
	}
	
	if (write) {
		// Generate new content
		var newLines = [header];
		snapshot.forEach(function(entry) {
			newLines.push([
				entry.id,
				entry.owner,
				entry.name,
				entry.position,
				entry.start,
				entry.end,
				entry.salary
			].join(','));
		});
		
		fs.writeFileSync(snapshotPath, newLines.join('\n') + '\n');
		console.log('');
		console.log('Updated:', snapshotPath);
	} else {
		console.log('');
		console.log('Run with --write to update snapshot in place');
	}
}

run();
