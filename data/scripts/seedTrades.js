var dotenv = require('dotenv').config({ path: __dirname + '/../../.env' });
var mongoose = require('mongoose');
var readline = require('readline');

var Transaction = require('../../models/Transaction');
var Franchise = require('../../models/Franchise');
var Player = require('../../models/Player');
var PSO = require('../../pso.js');

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

// Strip ordinals and suffixes that Sleeper doesn't use
function normalizePlayerName(name) {
	return name
		.replace(/\s+(Jr\.?|Sr\.?|III|II|IV|V)$/i, '') // Remove suffixes
		.replace(/[\. '-]/g, '')  // Remove punctuation
		.toLowerCase();
}

// Try to find or create a Player document
// Returns the Player's _id
// tradeContext is for display purposes when prompting
async function findOrCreatePlayer(rawName, tradeContext) {
	if (!rawName) return null;
	
	// Decode HTML entities first
	var name = decodeHtmlEntities(rawName);
	var searchName = normalizePlayerName(name);

	// First try to find by Sleeper ID
	var matches = sleeperData.filter(function(p) {
		return p.search_full_name === searchName;
	});

	if (matches.length === 1) {
		var sleeperId = matches[0].player_id;
		var player = await Player.findOne({ sleeperId: sleeperId });
		if (player) {
			return player._id;
		}
		// Player exists in Sleeper but not in our DB - this shouldn't happen
		// but handle gracefully by creating with sleeperId
		var newPlayer = await Player.create({
			name: matches[0].full_name,
			sleeperId: sleeperId,
			positions: matches[0].fantasy_positions || []
		});
		return newPlayer._id;
	}

	// Try to find by name (for already-created historical players)
	var existing = await Player.findOne({ name: name });
	if (existing) {
		return existing._id;
	}

	// Multiple Sleeper matches - need to disambiguate
	if (matches.length > 1) {
		console.log('\n⚠️  Multiple Sleeper matches for: ' + name);
		console.log('   Trade context: ' + tradeContext);
		matches.forEach(function(m, i) {
			var details = [
				m.full_name,
				m.team || 'FA',
				(m.fantasy_positions || []).join('/'),
				m.status || 'Unknown',
				m.years_exp != null ? m.years_exp + ' yrs exp' : '',
				'ID: ' + m.player_id
			].filter(Boolean).join(' | ');
			console.log('  ' + (i + 1) + ') ' + details);
		});
		console.log('  0) Create as historical player (none of the above)');

		var choice = await prompt('Select option: ');
		var idx = parseInt(choice);

		if (idx > 0 && idx <= matches.length) {
			var selected = matches[idx - 1];
			// Check if this player already exists in our DB
			var existingPlayer = await Player.findOne({ sleeperId: selected.player_id });
			if (existingPlayer) {
				return existingPlayer._id;
			}
			// Create player with Sleeper data
			var newPlayer = await Player.create({
				name: selected.full_name,
				sleeperId: selected.player_id,
				positions: selected.fantasy_positions || []
			});
			return newPlayer._id;
		}
		// Fall through to create historical player
	}

	// No Sleeper matches - prompt user
	if (matches.length === 0) {
		console.log('\n⚠️  No Sleeper matches for: ' + name);
		console.log('   Trade context: ' + tradeContext);
		console.log('  1) Create as historical player');
		console.log('  2) Search by different name');
		console.log('  3) Enter Sleeper ID manually');

		var choice = await prompt('Select option: ');

		if (choice === '2') {
			var altName = await prompt('Enter alternate name to search: ');
			var altSearchName = normalizePlayerName(altName);
			var altMatches = sleeperData.filter(function(p) {
				return p.search_full_name === altSearchName;
			});

			if (altMatches.length === 1) {
				var selected = altMatches[0];
				var existingPlayer = await Player.findOne({ sleeperId: selected.player_id });
				if (existingPlayer) {
					return existingPlayer._id;
				}
				var newPlayer = await Player.create({
					name: name, // Keep original trade name
					sleeperId: selected.player_id,
					positions: selected.fantasy_positions || []
				});
				return newPlayer._id;
			} else if (altMatches.length > 1) {
				console.log('Multiple matches for "' + altName + '":');
				altMatches.forEach(function(m, i) {
					console.log('  ' + (i + 1) + ') ' + m.full_name + ' | ' + (m.team || 'FA') + ' | ID: ' + m.player_id);
				});
				var subChoice = await prompt('Select (0 to skip): ');
				var subIdx = parseInt(subChoice);
				if (subIdx > 0 && subIdx <= altMatches.length) {
					var selected = altMatches[subIdx - 1];
					var existingPlayer = await Player.findOne({ sleeperId: selected.player_id });
					if (existingPlayer) {
						return existingPlayer._id;
					}
					var newPlayer = await Player.create({
						name: name,
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
				var existingPlayer = await Player.findOne({ sleeperId: sleeperId.trim() });
				if (existingPlayer) {
					return existingPlayer._id;
				}
				var sleeperPlayer = sleeperData.find(function(p) {
					return p.player_id === sleeperId.trim();
				});
				var newPlayer = await Player.create({
					name: name,
					sleeperId: sleeperId.trim(),
					positions: sleeperPlayer ? sleeperPlayer.fantasy_positions || [] : []
				});
				return newPlayer._id;
			}
		}
	}

	// Create historical player
	console.log('  Creating historical player: ' + name);
	var newPlayer = await Player.create({
		name: name,
		sleeperId: null,
		positions: []
	});

	return newPlayer._id;
}

async function seed() {
	console.log('Importing trade history...\n');

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
				var playerId = await findOrCreatePlayer(player.name, tradeContext);

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
	rl.close();
	console.error('Error:', err);
	process.exit(1);
});

