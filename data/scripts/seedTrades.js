var dotenv = require('dotenv').config({ path: __dirname + '/../../.env' });
var mongoose = require('mongoose');
var readline = require('readline');

var Transaction = require('../../models/Transaction');
var Franchise = require('../../models/Franchise');
var Player = require('../../models/Player');
var PSO = require('../../pso.js');
var resolver = require('./playerResolver');

var tradeHistory = require('./trade-history.json');
var sleeperData = Object.values(require('../../public/data/sleeper-data.json'));

mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });

var rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout
});

function prompt(question) {
	return new Promise(function(resolve) {
		rl.question(question, resolve);
	});
}

// Decode common HTML entities
function decodeHtmlEntities(str) {
	if (!str) return str;
	return str
		.replace(/&#8217;/g, "'")  // Right single quote
		.replace(/&#8216;/g, "'")  // Left single quote
		.replace(/&#8220;/g, '"')  // Left double quote
		.replace(/&#8221;/g, '"')  // Right double quote
		.replace(/&#038;/g, '&')   // Ampersand
		.replace(/&#39;/g, "'")    // Apostrophe
		.replace(/&amp;/g, '&')
		.replace(/&apos;/g, "'")
		.replace(/&quot;/g, '"')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>');
}

// Static alias map for owner names (same as seedPicks.js)
var ownerAliases = {
	'Koci': 2,
	'John': 4,
	'James': 9,
	'Schex': 10,
	'Daniel': 8,
	'Syed': 3,
	'Trevor': 5,
	'Terence': 8,
	'Charles': 11,
	'Jeff': 7,
	'Syed/Terence': 3,
	'Syed/Kuan': 3,
	'Brett/Luke': 7,
	'John/Zach': 4,
	'Mitch/Mike': 12,
	'James/Charles': 9,
	'Schex/Jeff': 10,
	'Jake/Luke': 7,
	'Pat/Quinn': 1
};

function getSleeperRosterId(ownerName) {
	if (!ownerName) return null;
	var name = ownerName.trim();
	return PSO.franchiseIds[name] || ownerAliases[name] || null;
}

// Try to find or create a Player document
// Returns the Player's _id
// tradeContext is for display purposes when prompting
async function findOrCreatePlayer(rawName, tradeContext, contextInfo) {
	if (!rawName) return null;
	
	// Decode HTML entities first
	var name = decodeHtmlEntities(rawName);
	
	// Check resolver cache first
	var cached = resolver.lookup(name, contextInfo);
	
	if (cached && !cached.ambiguous && cached.sleeperId) {
		// Found cached Sleeper ID
		var player = await Player.findOne({ sleeperId: cached.sleeperId });
		if (player) {
			return player._id;
		}
		// Player not in DB yet - find in Sleeper data and create
		var sleeperPlayer = sleeperData.find(function(p) { return p.player_id === cached.sleeperId; });
		if (sleeperPlayer) {
			var newPlayer = await Player.create({
				name: sleeperPlayer.full_name,
				sleeperId: cached.sleeperId,
				positions: sleeperPlayer.fantasy_positions || []
			});
			return newPlayer._id;
		}
	}
	
	if (cached && !cached.ambiguous && cached.sleeperId === null && cached.name) {
		// Cached as historical player
		var player = await Player.findOne({ sleeperId: null, name: cached.name });
		if (player) {
			return player._id;
		}
		// Create historical player with cached name
		var newPlayer = await Player.create({
			name: cached.name,
			sleeperId: null,
			positions: []
		});
		return newPlayer._id;
	}
	
	// Need to search Sleeper data - use Sleeper's format: no spaces, no punctuation, lowercase
	var sleeperSearchName = name.replace(/[\. '-]/g, '').toLowerCase();
	
	var matches = sleeperData.filter(function(p) {
		return p.search_full_name === sleeperSearchName;
	});
	
	// Single match and not marked ambiguous - cache and return
	if (matches.length === 1 && !cached) {
		resolver.addResolution(name, matches[0].player_id);
		
		var player = await Player.findOne({ sleeperId: matches[0].player_id });
		if (player) {
			return player._id;
		}
		var newPlayer = await Player.create({
			name: matches[0].full_name,
			sleeperId: matches[0].player_id,
			positions: matches[0].fantasy_positions || []
		});
		return newPlayer._id;
	}
	
	// Try to find by name (for already-created historical players)
	var existing = await Player.findOne({ sleeperId: null, name: name });
	if (existing && !cached) {
		resolver.addResolution(name, null, name);
		return existing._id;
	}

	// Multiple Sleeper matches or marked ambiguous - need to disambiguate
	if (matches.length > 1 || (cached && cached.ambiguous)) {
		var displayMatches = matches;
		
		if (cached && cached.ambiguous) {
			// For ambiguous names, show all matches regardless of initial filter
			displayMatches = sleeperData.filter(function(p) {
				return p.search_full_name === sleeperSearchName;
			});
		}
		
		// Sort: active first, on team first
		displayMatches.sort(function(a, b) {
			var aActive = a.active ? 0 : 1;
			var bActive = b.active ? 0 : 1;
			if (aActive !== bActive) return aActive - bActive;
			
			var aTeam = a.team ? 0 : 1;
			var bTeam = b.team ? 0 : 1;
			return aTeam - bTeam;
		});
		
		console.log('\n⚠️  ' + (cached && cached.ambiguous ? 'Ambiguous name: ' : 'Multiple matches for: ') + name);
		console.log('   Trade context: ' + tradeContext);
		displayMatches.forEach(function(m, i) {
			var details = [
				m.full_name,
				m.team || 'FA',
				(m.fantasy_positions || []).join('/'),
				m.college || '?',
				m.years_exp != null ? '~' + (2025 - m.years_exp) : '',
				m.active ? 'Active' : 'Inactive',
				'ID: ' + m.player_id
			].filter(Boolean).join(' | ');
			console.log('  ' + (i + 1) + ') ' + details);
		});
		console.log('  0) Create as historical player (none of the above)');

		var choice = await prompt('Select option: ');
		var idx = parseInt(choice);

		if (idx > 0 && idx <= displayMatches.length) {
			var selected = displayMatches[idx - 1];
			resolver.addResolution(name, selected.player_id, null, contextInfo);
			
			var existingPlayer = await Player.findOne({ sleeperId: selected.player_id });
			if (existingPlayer) {
				return existingPlayer._id;
			}
			var newPlayer = await Player.create({
				name: selected.full_name,
				sleeperId: selected.player_id,
				positions: selected.fantasy_positions || []
			});
			return newPlayer._id;
		}
		// Fall through to create historical player
	}

	// No Sleeper matches - try common name variations first
	if (matches.length === 0 && !cached) {
		// Try common nickname expansions
		var nicknames = {
			'matt': 'matthew', 'matthew': 'matt',
			'mike': 'michael', 'michael': 'mike',
			'chris': 'christopher', 'christopher': 'chris',
			'rob': 'robert', 'robert': 'rob',
			'bob': 'robert', 'robert': 'bob',
			'will': 'william', 'william': 'will',
			'bill': 'william', 'william': 'bill',
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
			'dick': 'richard',
			'greg': 'gregory', 'gregory': 'greg',
			'jeff': 'jeffrey', 'jeffrey': 'jeff',
			'ken': 'kenneth', 'kenneth': 'ken',
			'josh': 'joshua', 'joshua': 'josh',
			'zach': 'zachary', 'zachary': 'zach', 'zack': 'zachary',
			'sam': 'samuel', 'samuel': 'sam',
			'tim': 'timothy', 'timothy': 'tim',
			'jake': 'jacob', 'jacob': 'jake',
			'ike': 'isaac', 'isaac': 'ike'
		};
		
		var nameParts = name.split(' ');
		var firstName = nameParts[0].toLowerCase();
		var lastName = nameParts.slice(1).join(' ');
		
		if (nicknames[firstName] && lastName) {
			var altFirstName = nicknames[firstName].charAt(0).toUpperCase() + nicknames[firstName].slice(1);
			var altFullName = altFirstName + ' ' + lastName;
			var altSearchName = altFullName.replace(/[\. '-]/g, '').toLowerCase();
			
			var altMatches = sleeperData.filter(function(p) {
				return p.search_full_name === altSearchName;
			});
			
			if (altMatches.length > 0) {
				console.log('\n⚠️  No matches for "' + name + '", but found matches for "' + altFullName + '":');
				console.log('   Trade context: ' + tradeContext);
				altMatches.forEach(function(m, i) {
					var details = [
						m.full_name,
						m.team || 'FA',
						(m.fantasy_positions || []).join('/'),
						m.college || '?',
						m.years_exp != null ? '~' + (2025 - m.years_exp) : '',
						'ID: ' + m.player_id
					].filter(Boolean).join(' | ');
					console.log('  ' + (i + 1) + ') ' + details);
				});
				console.log('  0) None of these');
				
				var altChoice = await prompt('Select option: ');
				var altIdx = parseInt(altChoice);
				
				if (altIdx > 0 && altIdx <= altMatches.length) {
					var selected = altMatches[altIdx - 1];
					resolver.addResolution(name, selected.player_id, null, contextInfo);
					
					var existingPlayer = await Player.findOne({ sleeperId: selected.player_id });
					if (existingPlayer) {
						return existingPlayer._id;
					}
					var newPlayer = await Player.create({
						name: selected.full_name,
						sleeperId: selected.player_id,
						positions: selected.fantasy_positions || []
					});
					return newPlayer._id;
				}
			}
		}
		
		console.log('\n⚠️  No Sleeper matches for: ' + name);
		console.log('   Trade context: ' + tradeContext);
		console.log('  1) Create as historical player');
		console.log('  2) Search by different name');
		console.log('  3) Enter Sleeper ID manually');

		var choice = await prompt('Select option: ');

		if (choice === '2') {
			var altName = await prompt('Enter alternate name to search: ');
			// Use Sleeper's format: no spaces, no punctuation, lowercase
			var altSearchName = altName.replace(/[\. '-]/g, '').toLowerCase();
			var altMatches = sleeperData.filter(function(p) {
				return p.search_full_name === altSearchName;
			});

			if (altMatches.length === 1) {
				var selected = altMatches[0];
				resolver.addResolution(name, selected.player_id, null, contextInfo);
				
				var existingPlayer = await Player.findOne({ sleeperId: selected.player_id });
				if (existingPlayer) {
					return existingPlayer._id;
				}
				var newPlayer = await Player.create({
					name: selected.full_name,
					sleeperId: selected.player_id,
					positions: selected.fantasy_positions || []
				});
				return newPlayer._id;
			} else if (altMatches.length > 1) {
				console.log('Multiple matches for "' + altName + '":');
				altMatches.forEach(function(m, i) {
					var college = m.college || '?';
					var year = m.years_exp != null ? '~' + (2025 - m.years_exp) : '';
					console.log('  ' + (i + 1) + ') ' + m.full_name + ' | ' + (m.team || 'FA') + ' | ' + college + ' | ' + year + ' | ID: ' + m.player_id);
				});
				var subChoice = await prompt('Select (0 to skip): ');
				var subIdx = parseInt(subChoice);
				if (subIdx > 0 && subIdx <= altMatches.length) {
					var selected = altMatches[subIdx - 1];
					resolver.addResolution(name, selected.player_id, null, contextInfo);
					
					var existingPlayer = await Player.findOne({ sleeperId: selected.player_id });
					if (existingPlayer) {
						return existingPlayer._id;
					}
					var newPlayer = await Player.create({
						name: selected.full_name,
						sleeperId: selected.player_id,
						positions: selected.fantasy_positions || []
					});
					return newPlayer._id;
				}
			} else {
				console.log('No matches for "' + altName + '"');
			}
		} else if (choice === '3') {
			var sleeperId = await prompt('Enter Sleeper ID: ');
			if (sleeperId.trim()) {
				resolver.addResolution(name, sleeperId.trim(), null, contextInfo);
				
				var existingPlayer = await Player.findOne({ sleeperId: sleeperId.trim() });
				if (existingPlayer) {
					return existingPlayer._id;
				}
				var sleeperPlayer = sleeperData.find(function(p) {
					return p.player_id === sleeperId.trim();
				});
				var newPlayer = await Player.create({
					name: sleeperPlayer ? sleeperPlayer.full_name : name,
					sleeperId: sleeperId.trim(),
					positions: sleeperPlayer ? sleeperPlayer.fantasy_positions || [] : []
				});
				return newPlayer._id;
			}
		}
	}

	// Final confirmation before creating historical
	var confirmCreate = await prompt('  Create "' + name + '" as historical player? (y/n): ');
	if (confirmCreate.toLowerCase() !== 'y') {
		console.log('  Skipped.');
		return null;
	}
	
	// Check if historical players with similar names already exist
	var resolverSearchName = resolver.normalizePlayerName(name);
	var existingHistoricals = await Player.find({ sleeperId: null }).lean();
	var matchingHistoricals = existingHistoricals.filter(function(p) {
		return resolver.normalizePlayerName(p.name) === resolverSearchName;
	});
	
	if (matchingHistoricals.length > 0) {
		console.log('\n  Existing historical player(s) with this name:');
		matchingHistoricals.forEach(function(p, i) {
			console.log('    ' + (i + 1) + ') ' + p.name + ' (ID: ' + p._id + ')');
		});
		console.log('    0) Create NEW historical player (different person)');
		
		var histChoice = await prompt('  Select option: ');
		var histIdx = parseInt(histChoice);
		
		if (histIdx > 0 && histIdx <= matchingHistoricals.length) {
			// Reuse existing historical player
			var selected = matchingHistoricals[histIdx - 1];
			// Save with context so this specific trade context maps to this player
			resolver.addResolution(name, null, selected.name, contextInfo);
			return selected._id;
		}
		// Fall through to create new historical player
	}
	
	// Create NEW historical player - prompt for display name (to strip ordinals, etc.)
	var displayName = name;
	// Strip ordinals by default
	var cleanedName = name.replace(/\s+(Jr\.?|Sr\.?|III|II|IV|V)$/i, '').trim();
	if (cleanedName !== name) {
		displayName = cleanedName;
		console.log('  (Stripped ordinal: "' + name + '" → "' + displayName + '")');
	}
	
	var customName = await prompt('  Display name (Enter for "' + displayName + '"): ');
	if (customName.trim()) {
		displayName = customName.trim();
	}
	
	console.log('  Creating historical player: ' + displayName);
	
	// For ambiguous names, save with context; for unique names, save without
	if (resolver.isAmbiguous(searchName)) {
		resolver.addResolution(name, null, displayName, contextInfo);
	} else {
		resolver.addResolution(name, null, displayName);
	}
	
	var newPlayer = await Player.create({
		name: displayName,
		sleeperId: null,
		positions: []
	});

	return newPlayer._id;
}

async function seed() {
	console.log('Importing trade history...\n');
	console.log('Loaded', resolver.count(), 'cached player resolutions');

	var clearExisting = process.argv.includes('--clear');
	if (clearExisting) {
		console.log('Clearing existing trade transactions...');
		await Transaction.deleteMany({ type: 'trade' });
		
		console.log('Clearing historical players (will be recreated)...');
		await Player.deleteMany({ sleeperId: null });
	}

	// Load franchises
	var franchises = await Franchise.find({});
	var franchiseByRosterId = {};
	franchises.forEach(function(f) {
		franchiseByRosterId[f.sleeperRosterId] = f._id;
	});

	console.log('Loaded', franchises.length, 'franchises');
	console.log('Processing', tradeHistory.length, 'trades...\n');

	var created = 0;
	var skipped = 0;
	var historicalPlayersCreated = 0;
	var errors = [];
	var unmatchedPlayers = new Set();

	// Track historical players we create
	var initialPlayerCount = await Player.countDocuments({ sleeperId: null });

	for (var i = 0; i < tradeHistory.length; i++) {
		var trade = tradeHistory[i];
		var tradeYear = new Date(trade.timestamp).getFullYear();

		// Skip if no parties
		if (!trade.parties || trade.parties.length < 2) {
			errors.push({ trade: trade.tradeNumber, reason: 'Less than 2 parties' });
			skipped++;
			continue;
		}

		var parties = [];
		var hasError = false;

		for (var j = 0; j < trade.parties.length; j++) {
			var p = trade.parties[j];

			// Map owner to franchise
			var rosterId = getSleeperRosterId(p.owner);
			if (!rosterId) {
				errors.push({ trade: trade.tradeNumber, reason: 'Unknown owner: ' + p.owner });
				hasError = true;
				break;
			}

			var franchiseId = franchiseByRosterId[rosterId];
			if (!franchiseId) {
				errors.push({ trade: trade.tradeNumber, reason: 'No franchise for rosterId: ' + rosterId });
				hasError = true;
				break;
			}

			var party = {
				franchiseId: franchiseId,
				receives: {
					players: [],
					picks: [],
					cash: [],
					rfaRights: []
				},
				drops: []
			};

			// Process players
			for (var k = 0; k < p.receives.players.length; k++) {
				var player = p.receives.players[k];
				var tradeContext = 'Trade #' + trade.tradeNumber + ' (' + new Date(trade.timestamp).toISOString().split('T')[0] + ') - ' + p.owner + ' receives';
				var contextInfo = { year: tradeYear, franchise: p.owner.toLowerCase() };
				
				var playerId = await findOrCreatePlayer(player.name, tradeContext, contextInfo);

				if (!playerId) {
					unmatchedPlayers.add(player.name);
					continue;
				}

				if (player.rfaRights) {
					party.receives.rfaRights.push({ playerId: playerId });
				} else {
					party.receives.players.push({
						playerId: playerId,
						salary: player.salary,
						startYear: player.startYear,
						endYear: player.endYear
					});
				}
			}

			// Process picks
			for (var k = 0; k < p.receives.picks.length; k++) {
				var pick = p.receives.picks[k];

				// Map fromOwner to franchise
				var fromRosterId = getSleeperRosterId(pick.fromOwner);
				if (fromRosterId && franchiseByRosterId[fromRosterId]) {
					party.receives.picks.push({
						round: pick.round,
						season: pick.season || new Date(trade.timestamp).getFullYear() + 1,
						fromFranchiseId: franchiseByRosterId[fromRosterId]
					});
				}
			}

			// Process cash
			for (var k = 0; k < p.receives.cash.length; k++) {
				var cash = p.receives.cash[k];

				// Map fromOwner to franchise
				var fromRosterId = getSleeperRosterId(cash.fromOwner);
				if (fromRosterId && franchiseByRosterId[fromRosterId]) {
					party.receives.cash.push({
						amount: cash.amount,
						season: cash.season,
						fromFranchiseId: franchiseByRosterId[fromRosterId]
					});
				}
			}

			parties.push(party);
		}

		if (hasError) {
			skipped++;
			continue;
		}

		// Create transaction
		try {
			await Transaction.create({
				type: 'trade',
				timestamp: new Date(trade.timestamp),
				source: 'wordpress',
				wordpressTradeId: trade.tradeNumber,
				parties: parties
			});
			created++;
		}
		catch (err) {
			if (err.code === 11000) {
				errors.push({ trade: trade.tradeNumber, reason: 'Duplicate trade' });
				skipped++;
			}
			else {
				errors.push({ trade: trade.tradeNumber, reason: err.message });
				skipped++;
			}
		}

		// Progress update
		if ((i + 1) % 100 === 0) {
			console.log('  Processed', i + 1, 'trades...');
		}
	}

	// Count historical players created
	var finalPlayerCount = await Player.countDocuments({ sleeperId: null });
	historicalPlayersCreated = finalPlayerCount - initialPlayerCount;

	// Save resolutions
	resolver.save();

	console.log('\nDone!');
	console.log('  Trades created:', created);
	console.log('  Trades skipped:', skipped);
	console.log('  Historical players created:', historicalPlayersCreated);

	if (unmatchedPlayers.size > 0) {
		console.log('\nUnmatched players (null names):', unmatchedPlayers.size);
		var playerList = Array.from(unmatchedPlayers).slice(0, 20);
		playerList.forEach(function(name) {
			console.log('  -', name);
		});
		if (unmatchedPlayers.size > 20) {
			console.log('  ... and', unmatchedPlayers.size - 20, 'more');
		}
	}

	if (errors.length > 0) {
		console.log('\nErrors:');
		errors.slice(0, 20).forEach(function(e) {
			console.log('  - Trade #' + e.trade + ':', e.reason);
		});
		if (errors.length > 20) {
			console.log('  ... and', errors.length - 20, 'more');
		}
	}

	rl.close();
	process.exit(0);
}

seed().catch(function(err) {
	resolver.save();
	rl.close();
	console.error('Error:', err);
	process.exit(1);
});
