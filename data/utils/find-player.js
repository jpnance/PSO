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

if (matches.length === 0) {
	console.log('No matches found for "' + search + '"');
} else {
	var currentYear = new Date().getFullYear();
	matches.forEach(function(p) {
		var draftYear = p.years_exp !== undefined ? (currentYear - p.years_exp) : '?';
		console.log(
			p.player_id,
			p.full_name,
			p.team || 'FA',
			(p.fantasy_positions || []).join('/'),
			p.college || '?',
			'~' + draftYear,
			p.active ? 'active' : 'inactive'
		);
	});
}
