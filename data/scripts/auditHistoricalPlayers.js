/**
 * Audit historical players to see if any actually exist in Sleeper data.
 * 
 * Usage:
 *   docker compose run --rm -it web node data/scripts/auditHistoricalPlayers.js
 */

var dotenv = require('dotenv').config({ path: __dirname + '/../../.env' });
var mongoose = require('mongoose');
var readline = require('readline');

var Player = require('../../models/Player');
var resolver = require('./playerResolver');

var sleeperData = Object.values(require('../../public/data/sleeper-data.json'));

mongoose.connect(process.env.MONGODB_URI);

var rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout
});

function prompt(question) {
	return new Promise(function(resolve) {
		rl.question(question, resolve);
	});
}

// Common nickname mappings
var nicknames = {
	'matt': 'matthew', 'matthew': 'matt',
	'mike': 'michael', 'michael': 'mike',
	'chris': 'christopher', 'christopher': 'chris',
	'rob': 'robert', 'robert': 'rob',
	'bob': 'robert',
	'will': 'william', 'william': 'will',
	'bill': 'william',
	'dan': 'daniel', 'daniel': 'dan',
	'dave': 'david', 'david': 'dave',
	'tom': 'thomas', 'thomas': 'tom',
	'jim': 'james', 'james': 'jim',
	'joe': 'joseph', 'joseph': 'joe',
	'ben': 'benjamin', 'benjamin': 'ben',
	'tony': 'anthony', 'anthony': 'tony',
	'steve': 'steven', 'steven': 'steve',
	'jon': 'jonathan', 'jonathan': 'jon',
	'nick': 'nicholas', 'nicholas': 'nick',
	'drew': 'andrew', 'andrew': 'drew',
	'alex': 'alexander', 'alexander': 'alex',
	'ed': 'edward', 'edward': 'ed',
	'ted': 'theodore', 'theodore': 'ted',
	'pat': 'patrick', 'patrick': 'pat',
	'rick': 'richard', 'richard': 'rick',
	'greg': 'gregory', 'gregory': 'greg',
	'jeff': 'jeffrey', 'jeffrey': 'jeff',
	'ken': 'kenneth', 'kenneth': 'ken',
	'josh': 'joshua', 'joshua': 'josh',
	'zach': 'zachary', 'zachary': 'zach', 'zack': 'zachary',
	'sam': 'samuel', 'samuel': 'sam',
	'tim': 'timothy', 'timothy': 'tim',
	'jake': 'jacob', 'jacob': 'jake'
};

function findSleeperMatches(name) {
	var searchName = name.replace(/[\. '-]/g, '').toLowerCase();
	
	// Try exact match first
	var matches = sleeperData.filter(function(p) {
		return p.search_full_name === searchName;
	});
	
	if (matches.length > 0) {
		return { type: 'exact', matches: matches };
	}
	
	// Try nickname expansion
	var nameParts = name.split(' ');
	var firstName = nameParts[0].toLowerCase();
	var lastName = nameParts.slice(1).join(' ');
	
	if (nicknames[firstName] && lastName) {
		var altFirstName = nicknames[firstName];
		var altFullName = altFirstName + lastName.toLowerCase();
		var altSearchName = altFullName.replace(/[\. '-]/g, '');
		
		matches = sleeperData.filter(function(p) {
			return p.search_full_name === altSearchName;
		});
		
		if (matches.length > 0) {
			var displayAlt = altFirstName.charAt(0).toUpperCase() + altFirstName.slice(1) + ' ' + lastName;
			return { type: 'nickname', altName: displayAlt, matches: matches };
		}
	}
	
	return { type: 'none', matches: [] };
}

async function audit() {
	console.log('=== Audit Historical Players ===\n');
	
	var historicalPlayers = await Player.find({ sleeperId: null }).lean();
	console.log('Found', historicalPlayers.length, 'historical players\n');
	
	var remapped = 0;
	var confirmed = 0;
	var skipped = 0;
	
	for (var i = 0; i < historicalPlayers.length; i++) {
		var player = historicalPlayers[i];
		var result = findSleeperMatches(player.name);
		
		if (result.matches.length === 0) {
			// No matches - definitely historical
			confirmed++;
			continue;
		}
		
		// Found potential matches
		console.log('\n[' + (i + 1) + '/' + historicalPlayers.length + '] ' + player.name);
		
		if (result.type === 'nickname') {
			console.log('  No exact match, but found matches for "' + result.altName + '":');
		} else {
			console.log('  Found Sleeper matches:');
		}
		
		result.matches.forEach(function(m, j) {
			var details = [
				m.full_name,
				m.team || 'FA',
				(m.fantasy_positions || []).join('/'),
				m.college || '?',
				m.years_exp != null ? '~' + (2025 - m.years_exp) : '',
				m.active ? 'Active' : 'Inactive',
				'ID: ' + m.player_id
			].filter(Boolean).join(' | ');
			console.log('    ' + (j + 1) + ') ' + details);
		});
		console.log('    0) Keep as historical (none of these)');
		
		var choice = await prompt('  Select option: ');
		var idx = parseInt(choice);
		
		if (idx > 0 && idx <= result.matches.length) {
			var selected = result.matches[idx - 1];
			
			// Update the Player document
			await Player.updateOne(
				{ _id: player._id },
				{ 
					sleeperId: selected.player_id,
					name: selected.full_name,
					positions: selected.fantasy_positions || []
				}
			);
			
			// Update resolver cache
			resolver.addResolution(player.name, selected.player_id);
			
			console.log('  ✓ Remapped to: ' + selected.full_name + ' (ID: ' + selected.player_id + ')');
			remapped++;
		} else {
			console.log('  Kept as historical');
			skipped++;
		}
	}
	
	// Save resolver changes
	resolver.save();
	
	console.log('\n=== Audit Complete ===');
	console.log('  Confirmed historical (no matches):', confirmed);
	console.log('  Remapped to Sleeper:', remapped);
	console.log('  Kept as historical (user choice):', skipped);
	
	rl.close();
	process.exit(0);
}

audit().catch(function(err) {
	rl.close();
	console.error('Error:', err);
	process.exit(1);
});
