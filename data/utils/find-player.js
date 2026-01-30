// Quick player lookup - includes inactive players
// Usage: node data/utils/find-player.js <name>

var sleeperData = require('../../public/data/sleeper-data.json');

var search = process.argv.slice(2).join(' ').toLowerCase();

if (!search) {
	console.log('Usage: node data/utils/find-player.js <name>');
	process.exit(1);
}

var matches = Object.values(sleeperData).filter(function(p) {
	return p.full_name?.toLowerCase().includes(search);
});

function getRookieYearDisplay(p) {
	// Reliable: metadata.rookie_year
	if (p.metadata && p.metadata.rookie_year && parseInt(p.metadata.rookie_year) > 1990) {
		return String(p.metadata.rookie_year);
	}
	// Estimated: birth_date + 23
	if (p.birth_date) {
		var birthYear = parseInt(p.birth_date.split('-')[0]);
		if (birthYear > 1950) {
			return '~' + (birthYear + 23);
		}
	}
	return '?';
}

if (matches.length === 0) {
	console.log('No matches found for "' + search + '"');
} else {
	matches.forEach(function(p) {
		console.log(
			p.player_id,
			p.full_name,
			p.team || 'FA',
			(p.fantasy_positions || []).join('/'),
			p.college || '?',
			getRookieYearDisplay(p),
			p.active ? 'active' : 'inactive'
		);
	});
}
