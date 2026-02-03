#!/usr/bin/env node

// Spike script to parse contract-history.txt and build per-player timelines
// Usage: node data/utils/contract-timeline.js [--player "Name"] [--year YYYY] [--changes-only]

var fs = require('fs');
var path = require('path');

var args = process.argv.slice(2);
var playerFilter = null;
var yearFilter = null;
var changesOnly = false;

for (var i = 0; i < args.length; i++) {
	if (args[i] === '--player' && args[i + 1]) {
		playerFilter = args[i + 1].toLowerCase();
		i++;
	} else if (args[i] === '--year' && args[i + 1]) {
		yearFilter = parseInt(args[i + 1], 10);
		i++;
	} else if (args[i] === '--changes-only') {
		changesOnly = true;
	}
}

var filePath = path.join(__dirname, '../archive/legacy/contract-history.txt');
var content = fs.readFileSync(filePath, 'utf8');
var lines = content.split('\n');

// Parse into snapshots by year
var snapshots = {};
var currentYear = null;

for (var i = 0; i < lines.length; i++) {
	var line = lines[i].trim();
	
	// Check for year header
	var yearMatch = line.match(/^=== (\d{4}) data ===$/);
	if (yearMatch) {
		currentYear = parseInt(yearMatch[1], 10);
		snapshots[currentYear] = [];
		continue;
	}
	
	// Skip header row
	if (line.startsWith('ID\t') || !line || !currentYear) {
		continue;
	}
	
	// Parse data row
	var parts = line.split('\t');
	if (parts.length < 5) continue;
	
	var record = {
		id: parts[0],
		owner: parts[1] || null,
		name: parts[2],
		position: parts[3],
		start: parts[4],
		end: parts[5] || null,
		salary: parts[6] ? parseInt(parts[6].replace(/[$,]/g, ''), 10) : null
	};
	
	snapshots[currentYear].push(record);
}

console.log('Parsed snapshots:');
Object.keys(snapshots).sort().forEach(function(year) {
	console.log('  ' + year + ': ' + snapshots[year].length + ' records');
});
console.log('');

// Build per-player timeline
var playerTimelines = {};

Object.keys(snapshots).sort().forEach(function(year) {
	year = parseInt(year, 10);
	snapshots[year].forEach(function(record) {
		var key = record.id + '|' + record.name; // Use ID + name as key
		
		if (!playerTimelines[key]) {
			playerTimelines[key] = {
				id: record.id,
				name: record.name,
				positions: new Set(),
				years: {}
			};
		}
		
		playerTimelines[key].positions.add(record.position);
		playerTimelines[key].years[year] = {
			owner: record.owner,
			start: record.start,
			end: record.end,
			salary: record.salary
		};
	});
});

// Convert position sets to arrays
Object.keys(playerTimelines).forEach(function(key) {
	playerTimelines[key].positions = Array.from(playerTimelines[key].positions);
});

console.log('Total players tracked: ' + Object.keys(playerTimelines).length);
console.log('');

// Analyze transitions
var stats = {
	newContracts: 0,
	faPickups: 0,
	ownerChanges: 0,
	contractExpiries: 0,
	rosterDrops: 0
};

var events = [];

Object.keys(playerTimelines).forEach(function(key) {
	var player = playerTimelines[key];
	var years = Object.keys(player.years).map(Number).sort();
	
	// Apply player filter
	if (playerFilter && !player.name.toLowerCase().includes(playerFilter)) {
		return;
	}
	
	for (var i = 0; i < years.length; i++) {
		var year = years[i];
		var data = player.years[year];
		var prevYear = years[i - 1];
		var prevData = prevYear ? player.years[prevYear] : null;
		
		// Apply year filter
		if (yearFilter && year !== yearFilter) {
			continue;
		}
		
		var event = null;
		
		// New contract (non-FA start year matching snapshot year)
		if (data.start !== 'FA' && parseInt(data.start, 10) === year && data.owner) {
			// Check if this is a rookie (would need draft data) or auction
			event = {
				year: year,
				player: player.name,
				type: 'new-contract',
				owner: data.owner,
				contract: data.start + '/' + data.end,
				salary: data.salary,
				note: 'Auction or draft'
			};
			stats.newContracts++;
		}
		// FA pickup (FA start, has owner and salary)
		else if (data.start === 'FA' && data.owner && data.salary) {
			event = {
				year: year,
				player: player.name,
				type: 'fa-pickup',
				owner: data.owner,
				salary: data.salary,
				note: 'Picked up from FA during ' + year
			};
			stats.faPickups++;
		}
		// Owner change (same contract, different owner)
		else if (prevData && data.owner && prevData.owner && data.owner !== prevData.owner) {
			// Check if contract is the same
			if (data.start === prevData.start || (data.start !== 'FA' && prevData.start !== 'FA')) {
				event = {
					year: year,
					player: player.name,
					type: 'owner-change',
					from: prevData.owner,
					to: data.owner,
					note: 'Trade or other transfer'
				};
				stats.ownerChanges++;
			}
		}
		// Dropped from roster (had owner, now no owner)
		else if (prevData && prevData.owner && !data.owner) {
			event = {
				year: year,
				player: player.name,
				type: 'roster-drop',
				from: prevData.owner,
				note: 'Cut or contract expired'
			};
			stats.rosterDrops++;
		}
		
		if (event) {
			events.push(event);
		}
	}
});

// Sort events
events.sort(function(a, b) {
	if (a.year !== b.year) return a.year - b.year;
	if (a.type !== b.type) return a.type.localeCompare(b.type);
	return a.player.localeCompare(b.player);
});

// Output
if (playerFilter) {
	// Show full timeline for filtered player
	Object.keys(playerTimelines).forEach(function(key) {
		var player = playerTimelines[key];
		if (!player.name.toLowerCase().includes(playerFilter)) return;
		
		console.log('=== ' + player.name + ' (' + player.positions.join('/') + ') ===');
		console.log('ID: ' + player.id);
		console.log('');
		
		var years = Object.keys(player.years).map(Number).sort();
		years.forEach(function(year) {
			var data = player.years[year];
			var line = '  ' + year + ': ';
			if (data.owner) {
				line += data.owner + ' - ';
			} else {
				line += '(unrostered) - ';
			}
			if (data.start === 'FA') {
				line += 'FA/' + data.end;
			} else {
				line += data.start + '/' + data.end;
			}
			if (data.salary) {
				line += ' $' + data.salary;
			}
			console.log(line);
		});
		console.log('');
	});
} else if (changesOnly || yearFilter) {
	// Show events
	console.log('=== Events ===');
	events.forEach(function(e) {
		var line = e.year + ' | ' + e.type.padEnd(14) + ' | ' + e.player.padEnd(25) + ' | ';
		if (e.type === 'new-contract') {
			line += e.owner + ' ' + e.contract + ' $' + e.salary;
		} else if (e.type === 'fa-pickup') {
			line += e.owner + ' $' + e.salary;
		} else if (e.type === 'owner-change') {
			line += e.from + ' → ' + e.to;
		} else if (e.type === 'roster-drop') {
			line += 'dropped by ' + e.from;
		}
		console.log(line);
	});
	console.log('');
}

console.log('=== Summary ===');
console.log('New contracts (auction/draft): ' + stats.newContracts);
console.log('FA pickups: ' + stats.faPickups);
console.log('Owner changes (trades): ' + stats.ownerChanges);
console.log('Roster drops: ' + stats.rosterDrops);
