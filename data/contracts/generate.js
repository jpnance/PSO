#!/usr/bin/env node
/**
 * Generate contracts.json from contracts-YEAR.txt snapshot files.
 *
 * A contract entry is created for every row where the contract's start year
 * matches the file year (i.e. the player signed a contract that season).
 *
 * This includes ALL contracts - drafted players, auctioned players, etc.
 * For auction-specific data, see data/auctions/generate.js.
 *
 * Usage:
 *   node data/contracts/generate.js
 *   node data/contracts/generate.js --dry-run
 */

var fs = require('fs');
var path = require('path');

var PSO = require('../../config/pso.js');

var SNAPSHOTS_DIR = path.join(__dirname, '../archive/snapshots');
var OUTPUT_FILE = path.join(__dirname, 'contracts.json');

// Build owner name -> rosterId for each year from PSO.franchiseNames
var ownerToRosterIdByYear = {};

Object.keys(PSO.franchiseNames).forEach(function(rosterId) {
	var yearMap = PSO.franchiseNames[rosterId];
	Object.keys(yearMap).forEach(function(year) {
		var y = parseInt(year, 10);
		if (!ownerToRosterIdByYear[y]) {
			ownerToRosterIdByYear[y] = {};
		}
		ownerToRosterIdByYear[y][yearMap[year]] = parseInt(rosterId, 10);
	});
});

function getRosterId(ownerName, season) {
	if (!ownerName) return null;
	var yearMap = ownerToRosterIdByYear[season];
	if (!yearMap) return null;

	var direct = yearMap[ownerName];
	if (direct !== undefined) return direct;

	// Partial match (e.g. snapshot "John" vs config "John/Zach")
	var owners = Object.keys(yearMap);
	for (var i = 0; i < owners.length; i++) {
		if (owners[i].indexOf(ownerName) >= 0 || ownerName.indexOf(owners[i]) >= 0) {
			return yearMap[owners[i]];
		}
	}
	return null;
}

function parseContractsFile(filePath, year) {
	var content = fs.readFileSync(filePath, 'utf8');
	var lines = content.split(/\r?\n/).filter(function(line) { return line.trim(); });
	if (lines.length === 0) return [];

	var header = lines[0].toLowerCase();
	var nameCol = header.indexOf('player') >= 0 ? 'Player' : 'Name';
	var cols = lines[0].split(',');
	var idx = {};
	cols.forEach(function(c, i) {
		idx[c.trim()] = i;
	});

	var results = [];
	for (var i = 1; i < lines.length; i++) {
		var row = lines[i].split(',');
		if (row.length < cols.length) continue;

		var startStr = row[idx['Start']] ? row[idx['Start']].trim() : '';
		var startYear = startStr ? parseInt(startStr, 10) : null;
		if (isNaN(startYear) || startYear !== year) continue;

		var idStr = row[idx['ID']] ? row[idx['ID']].trim() : '';
		var sleeperId = (idStr === '' || idStr === '-1') ? null : String(parseInt(idStr, 10));

		var name = row[idx[nameCol]] ? row[idx[nameCol]].trim() : '';
		var position = row[idx['Position']] ? row[idx['Position']].trim() : '';
		var positions = position ? position.split('/').map(function(p) { return p.trim(); }) : [];
		var owner = row[idx['Owner']] ? row[idx['Owner']].trim() : '';
		var endStr = row[idx['End']] ? row[idx['End']].trim() : '';
		var endYear = endStr && endStr !== 'FA' ? parseInt(endStr, 10) : null;
		if (endYear !== null && isNaN(endYear)) endYear = null;

		var salaryStr = row[idx['Salary']] ? row[idx['Salary']].trim().replace(/^\$/, '') : '0';
		var salary = parseInt(salaryStr, 10) || 0;

		var rosterId = getRosterId(owner, year);
		if (rosterId === null) {
			console.warn('Unknown owner "' + owner + '" for ' + name + ' in ' + year);
			continue;
		}

		results.push({
			season: year,
			sleeperId: sleeperId,
			name: name,
			positions: positions,
			rosterId: rosterId,
			salary: salary,
			startYear: startYear,
			endYear: endYear
		});
	}
	return results;
}

function main() {
	var dryRun = process.argv.indexOf('--dry-run') >= 0;

	var all = [];
	var files = fs.readdirSync(SNAPSHOTS_DIR);
	files.sort();

	files.forEach(function(file) {
		var match = file.match(/^contracts-(\d{4})\.txt$/);
		if (!match) return;
		var year = parseInt(match[1], 10);
		var filePath = path.join(SNAPSHOTS_DIR, file);
		var entries = parseContractsFile(filePath, year);
		all = all.concat(entries);
	});

	all.sort(function(a, b) {
		if (a.season !== b.season) return a.season - b.season;
		return (a.name || '').localeCompare(b.name || '');
	});

	if (dryRun) {
		console.log('Dry run: would write ' + all.length + ' contract entries to ' + OUTPUT_FILE);
		var bySeason = {};
		all.forEach(function(e) {
			bySeason[e.season] = (bySeason[e.season] || 0) + 1;
		});
		Object.keys(bySeason).sort().forEach(function(y) {
			console.log('  ' + y + ': ' + bySeason[y]);
		});
		return;
	}

	fs.writeFileSync(OUTPUT_FILE, JSON.stringify(all, null, 2), 'utf8');
	console.log('Wrote ' + all.length + ' entries to ' + OUTPUT_FILE);
}

main();
