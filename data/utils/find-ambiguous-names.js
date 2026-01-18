/**
 * Find player names that appear multiple times in Sleeper data.
 * These are candidates for the _ambiguous list.
 * 
 * Usage:
 *   node data/utils/find-ambiguous-names.js
 */

var sleeperData = Object.values(require('../../public/data/sleeper-data.json'));

function normalizePlayerName(name) {
	if (!name) return '';
	return name
		.replace(/\s+(III|II|IV|V|Jr\.|Sr\.)$/i, '')
		.replace(/[^\w\s]/g, '')
		.replace(/\s+/g, ' ')
		.trim()
		.toLowerCase();
}

// Only consider players at relevant fantasy positions
var relevantPositions = ['QB', 'RB', 'WR', 'TE', 'DL', 'LB', 'DB', 'K'];

function hasRelevantPosition(player) {
	if (!player.fantasy_positions) return false;
	return player.fantasy_positions.some(function(pos) {
		return relevantPositions.includes(pos);
	});
}

// Group players by normalized name
var byName = {};

sleeperData.forEach(function(player) {
	if (!player.full_name) return;
	if (!hasRelevantPosition(player)) return;
	
	var normalized = normalizePlayerName(player.full_name);
	
	if (!byName[normalized]) {
		byName[normalized] = [];
	}
	
	byName[normalized].push({
		id: player.player_id,
		name: player.full_name,
		team: player.team || 'FA',
		position: (player.fantasy_positions || []).join('/'),
		yearsExp: player.years_exp,
		active: player.active
	});
});

// Find duplicates
var duplicates = [];

Object.keys(byName).forEach(function(name) {
	if (byName[name].length > 1) {
		duplicates.push({
			normalizedName: name,
			count: byName[name].length,
			players: byName[name]
		});
	}
});

// Sort by count (most duplicates first), then by name
duplicates.sort(function(a, b) {
	if (b.count !== a.count) return b.count - a.count;
	return a.normalizedName.localeCompare(b.normalizedName);
});

console.log('=== Ambiguous Names in Sleeper Data ===\n');
console.log('Found', duplicates.length, 'names with multiple players\n');

duplicates.forEach(function(dup) {
	console.log(dup.normalizedName + ' (' + dup.count + ' players):');
	dup.players.forEach(function(p) {
		var status = p.active ? '' : ' [inactive]';
		var draftYear = p.yearsExp !== undefined ? (2025 - p.yearsExp) : '?';
		console.log('  ' + p.id + ' - ' + p.name + ' (' + p.position + ', ' + p.team + ', ~' + draftYear + ')' + status);
	});
	console.log('');
});

// Output just the names for easy copy-paste into _ambiguous
console.log('=== Copy-paste for _ambiguous array ===\n');
console.log(JSON.stringify(duplicates.map(function(d) { return d.normalizedName; }), null, 2));
