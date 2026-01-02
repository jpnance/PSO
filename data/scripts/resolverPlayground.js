/**
 * Interactive playground for testing the player resolver.
 * 
 * Usage:
 *   node data/scripts/resolverPlayground.js
 * 
 * Try entering names like:
 *   - "CeeDee Lamb" (should find cached resolution)
 *   - "Mike Williams" (should say ambiguous)
 *   - "Totally Fake Player" (should say not found)
 *   - "Marion Barber III" (test ordinal stripping)
 */

var readline = require('readline');
var resolver = require('./playerResolver');
var sleeperData = Object.values(require('../../public/data/sleeper-data.json'));

var rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout
});

function askQuestion(query) {
	return new Promise(function(resolve) {
		rl.question(query, resolve);
	});
}

// Find Sleeper candidates for a name
function findSleeperCandidates(name) {
	var normalized = resolver.normalizePlayerName(name);
	
	return sleeperData.filter(function(p) {
		if (!p.full_name) return false;
		var pNormalized = resolver.normalizePlayerName(p.full_name);
		return pNormalized === normalized || 
		       pNormalized.includes(normalized) || 
		       normalized.includes(pNormalized);
	}).slice(0, 10); // Limit to 10
}

async function main() {
	console.log('=== Player Resolver Playground ===\n');
	console.log('Loaded', resolver.count(), 'cached resolutions');
	console.log('Type a player name to test resolution, or "quit" to exit.\n');
	
	while (true) {
		var name = await askQuestion('Enter player name: ');
		
		if (name.toLowerCase() === 'quit' || name.toLowerCase() === 'q') {
			break;
		}
		
		if (!name.trim()) continue;
		
		console.log('\nNormalized:', resolver.normalizePlayerName(name));
		
		// Try lookup without context
		var result = resolver.lookup(name);
		
		if (result && result.ambiguous) {
			console.log('→ AMBIGUOUS: This name is in the ambiguous list.');
			console.log('  Would prompt for disambiguation with context.\n');
			
			// Show candidates
			var candidates = findSleeperCandidates(name);
			if (candidates.length > 0) {
				console.log('  Sleeper candidates:');
				candidates.forEach(function(p, i) {
					var pos = (p.fantasy_positions || []).join('/');
					var team = p.team || 'FA';
					var exp = p.years_exp !== undefined ? (2025 - p.years_exp) : '?';
					var college = p.college || '?';
					console.log('    ' + (i + 1) + ') ' + p.player_id + ' - ' + p.full_name + ' (' + pos + ', ' + team + ', ~' + exp + ', ' + college + ')');
				});
			}
			
			// Demo: let them pick one with context
			var pick = await askQuestion('\n  Pick a number (or Enter to skip): ');
			if (pick && candidates[parseInt(pick) - 1]) {
				var chosen = candidates[parseInt(pick) - 1];
				var year = await askQuestion('  Context year (e.g., 2020): ');
				var context = year ? { year: parseInt(year) } : null;
				
				resolver.addResolution(name, chosen.player_id, null, context);
				resolver.save();
				console.log('  ✓ Saved resolution' + (context ? ' with context' : ''));
			}
			
		} else if (result && result.sleeperId) {
			var player = sleeperData.find(function(p) { return p.player_id === result.sleeperId; });
			var displayName = player ? player.full_name : result.sleeperId;
			console.log('→ FOUND: Sleeper ID', result.sleeperId, '(' + displayName + ')\n');
			
		} else if (result && result.name) {
			console.log('→ FOUND: Historical player "' + result.name + '"\n');
			
		} else {
			console.log('→ NOT FOUND: No cached resolution.');
			console.log('  Would search Sleeper data and prompt.\n');
			
			var candidates = findSleeperCandidates(name);
			if (candidates.length > 0) {
				console.log('  Possible Sleeper matches:');
				candidates.forEach(function(p, i) {
					var pos = (p.fantasy_positions || []).join('/');
					var team = p.team || 'FA';
					var exp = p.years_exp !== undefined ? (2025 - p.years_exp) : '?';
					var college = p.college || '?';
					console.log('    ' + (i + 1) + ') ' + p.player_id + ' - ' + p.full_name + ' (' + pos + ', ' + team + ', ~' + exp + ', ' + college + ')');
				});
				
				var pick = await askQuestion('\n  Pick a number, "h" for historical, or Enter to skip: ');
				if (pick === 'h') {
					var displayName = await askQuestion('  Display name for historical player: ');
					resolver.addResolution(name, null, displayName || name);
					resolver.save();
					console.log('  ✓ Saved as historical player');
				} else if (pick && candidates[parseInt(pick) - 1]) {
					var chosen = candidates[parseInt(pick) - 1];
					resolver.addResolution(name, chosen.player_id);
					resolver.save();
					console.log('  ✓ Saved resolution');
				}
			} else {
				console.log('  No Sleeper matches found.');
				var createHistorical = await askQuestion('  Create as historical? (y/n): ');
				if (createHistorical.toLowerCase() === 'y') {
					var displayName = await askQuestion('  Display name: ');
					resolver.addResolution(name, null, displayName || name);
					resolver.save();
					console.log('  ✓ Saved as historical player');
				}
			}
		}
		
		console.log('');
	}
	
	console.log('\nGoodbye!');
	rl.close();
	process.exit(0);
}

main().catch(function(err) {
	console.error('Error:', err);
	process.exit(1);
});
