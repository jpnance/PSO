/**
 * Seed trades from WordPress into the database.
 * Fetches trade posts directly from WordPress API.
 * Uses the player resolver for matching and interactive disambiguation.
 * 
 * Usage:
 *   docker compose run --rm -it web node data/scripts/seedTrades.js
 *   docker compose run --rm -it web node data/scripts/seedTrades.js --clear
 */

var dotenv = require('dotenv').config({ path: __dirname + '/../../.env' });
var mongoose = require('mongoose');
var readline = require('readline');
var request = require('superagent');

var Transaction = require('../../models/Transaction');
var Franchise = require('../../models/Franchise');
var Player = require('../../models/Player');
var PSO = require('../../pso.js');
var resolver = require('./playerResolver');

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

// ============================================
// WordPress fetching and parsing (from parseTradeHistory.js)
// ============================================

async function fetchAllTrades() {
	var allTrades = [];
	var page = 1;
	var hasMore = true;

	while (hasMore) {
		console.log('Fetching page', page, '...');

		var response = await request
			.get('https://public-api.wordpress.com/rest/v1.1/sites/thedynastyleague.wordpress.com/posts')
			.query({ category: 'trades', number: 100, page: page });

		var posts = response.body.posts;

		if (posts.length === 0) {
			hasMore = false;
		}
		else {
			allTrades = allTrades.concat(posts);
			page++;
		}
	}

	console.log('Fetched', allTrades.length, 'trades total\n');
	return allTrades;
}

function parseTradeContent(html) {
	var trade = {
		parties: []
	};

	// Split by <strong> tags to find each party's section
	var sections = html.split(/<strong>/);

	for (var i = 1; i < sections.length; i++) {
		var section = sections[i];

		// Extract owner name (everything before </strong>)
		var ownerMatch = section.match(/^([^<]+)<\/strong>/);
		if (!ownerMatch) continue;

		var ownerName = ownerMatch[1].trim();
		var party = {
			owner: ownerName,
			franchiseId: PSO.franchiseIds[ownerName] || null,
			receives: {
				players: [],
				picks: [],
				cash: []
			}
		};

		// Extract list items
		var listItems = section.match(/<li>.*?<\/li>/g) || [];

		for (var j = 0; j < listItems.length; j++) {
			var item = listItems[j];

			// Player with link: <a href="...">Player Name</a> ($salary, start/end) or ($salary, year)
			var playerMatch = item.match(/<a[^>]*>([^<]+)<\/a>\s*\((\$?\d+),?\s*([^)]+)\)/);
			if (playerMatch) {
				var contractStr = playerMatch[3].trim();
				var contractParts = contractStr.split('/');
				var startYear, endYear;

				if (contractParts.length === 1) {
					var year = contractParts[0];
					var yearLower = year.toLowerCase();
					if (yearLower === 'fa' || yearLower === 'unsigned' || yearLower === 'franchise') {
						startYear = null;
						endYear = null;
					}
					else {
						startYear = year.length === 2 ? parseInt('20' + year) : parseInt(year);
						endYear = startYear;
					}
				}
				else {
					startYear = contractParts[0] === 'FA' ? null : (contractParts[0].length === 2 ? parseInt('20' + contractParts[0]) : parseInt(contractParts[0]));
					endYear = contractParts[1] ? (contractParts[1].length === 2 ? parseInt('20' + contractParts[1]) : parseInt(contractParts[1])) : null;
				}

				party.receives.players.push({
					name: playerMatch[1].trim(),
					salary: parseInt(playerMatch[2].replace('$', '')),
					startYear: startYear,
					endYear: endYear
				});
				continue;
			}

			// Player without link (plain text)
			var plainPlayerMatch = item.match(/<li>\s*([A-Za-z][A-Za-z\.\s'-]+[A-Za-z])\s*\((\$?\d+),?\s*([^)]+)\)/);
			if (plainPlayerMatch) {
				var contractStr = plainPlayerMatch[3].trim();
				var contractParts = contractStr.split('/');
				var startYear, endYear;

				if (contractParts.length === 1) {
					var year = contractParts[0];
					var yearLower = year.toLowerCase();
					if (yearLower === 'fa' || yearLower === 'unsigned' || yearLower === 'franchise') {
						startYear = null;
						endYear = null;
					}
					else {
						startYear = year.length === 2 ? parseInt('20' + year) : parseInt(year);
						endYear = startYear;
					}
				}
				else {
					startYear = contractParts[0] === 'FA' ? null : (contractParts[0].length === 2 ? parseInt('20' + contractParts[0]) : parseInt(contractParts[0]));
					endYear = contractParts[1] ? (contractParts[1].length === 2 ? parseInt('20' + contractParts[1]) : parseInt(contractParts[1])) : null;
				}

				party.receives.players.push({
					name: plainPlayerMatch[1].trim(),
					salary: parseInt(plainPlayerMatch[2].replace('$', '')),
					startYear: startYear,
					endYear: endYear
				});
				continue;
			}

			// Cash: $X from Owner in Year
			var cashMatch = item.match(/\$(\d+)\s+from\s+([^\s]+(?:\/[^\s]+)?)\s+in\s+(\d+)/i);
			if (cashMatch) {
				party.receives.cash.push({
					amount: parseInt(cashMatch[1]),
					fromOwner: cashMatch[2],
					season: parseInt(cashMatch[3])
				});
				continue;
			}

			// Cash without "from" (old format): $X in Year
			var cashNoFromMatch = item.match(/\$(\d+)\s+in\s+(\d+)/i);
			if (cashNoFromMatch) {
				party.receives.cash.push({
					amount: parseInt(cashNoFromMatch[1]),
					fromOwner: null,
					season: parseInt(cashNoFromMatch[2])
				});
				continue;
			}

			// Pick: Xth round [draft] pick from Owner in Year
			var pickMatch = item.match(/(\d+)(?:st|nd|rd|th)\s+round\s+(?:draft\s+)?pick\s+from\s+([^\s(]+(?:\/[^\s(]+)?)\s+in\s+(\d+)/i);
			if (pickMatch) {
				party.receives.picks.push({
					round: parseInt(pickMatch[1]),
					fromOwner: pickMatch[2],
					season: parseInt(pickMatch[3])
				});
				continue;
			}

			// Pick with "via" notation
			var pickViaMatch = item.match(/(\d+)(?:st|nd|rd|th)\s+round\s+(?:draft\s+)?pick\s+from\s+([^\s(]+(?:\/[^\s(]+)?)\s*\(via\s+([^)]+)\)\s+in\s+(\d+)/i);
			if (pickViaMatch) {
				party.receives.picks.push({
					round: parseInt(pickViaMatch[1]),
					fromOwner: pickViaMatch[2],
					viaOwner: pickViaMatch[3],
					season: parseInt(pickViaMatch[4])
				});
				continue;
			}

			// Pick with year before via
			var pickYearBeforeViaMatch = item.match(/(\d+)(?:st|nd|rd|th)\s+round\s+(?:draft\s+)?pick\s+from\s+([^\s(]+(?:\/[^\s(]+)?)\s+in\s+(\d+)\s*\(via\s+([^)]+)\)/i);
			if (pickYearBeforeViaMatch) {
				party.receives.picks.push({
					round: parseInt(pickYearBeforeViaMatch[1]),
					fromOwner: pickYearBeforeViaMatch[2],
					season: parseInt(pickYearBeforeViaMatch[3]),
					viaOwner: pickYearBeforeViaMatch[4]
				});
				continue;
			}

			// Old format pick without year
			var pickNoYearViaMatch = item.match(/(\d+)(?:st|nd|rd|th)\s+round\s+(?:draft\s+)?pick\s+from\s+([^\s(]+(?:\/[^\s(]+)?)\s*\(via\s+([^)]+)\)$/i);
			if (pickNoYearViaMatch) {
				party.receives.picks.push({
					round: parseInt(pickNoYearViaMatch[1]),
					fromOwner: pickNoYearViaMatch[2],
					viaOwner: pickNoYearViaMatch[3],
					season: null
				});
				continue;
			}

			// RFA rights
			var rfaMatch = item.match(/<a[^>]*>([^<]+)<\/a>\s*\(RFA rights\)/i) || item.match(/<li>\s*([A-Za-z][A-Za-z\.\s'&#;0-9-]+[A-Za-z])\s*\(RFA rights\)/i);
			if (rfaMatch) {
				party.receives.players.push({
					name: rfaMatch[1].trim().replace(/&#8217;/g, "'"),
					rfaRights: true,
					salary: null,
					startYear: null,
					endYear: null
				});
				continue;
			}

			// Nothing: explicitly traded nothing
			if (item.match(/Nothing/i)) {
				continue;
			}

			// Unrecognized item
			console.log('Unrecognized trade item:', item.replace(/<[^>]+>/g, ''));
		}

		trade.parties.push(party);
	}

	return trade;
}

// ============================================
// Player resolution helpers
// ============================================

// Decode common HTML entities
function decodeHtmlEntities(str) {
	if (!str) return str;
	return str
		.replace(/&#8217;/g, "'")
		.replace(/&#8216;/g, "'")
		.replace(/&#8220;/g, '"')
		.replace(/&#8221;/g, '"')
		.replace(/&#038;/g, '&')
		.replace(/&#39;/g, "'")
		.replace(/&amp;/g, '&')
		.replace(/&apos;/g, "'")
		.replace(/&quot;/g, '"')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>');
}

// Static alias map for owner names
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

async function findOrCreatePlayer(rawName, tradeContext, contextInfo) {
	if (!rawName) return null;
	
	var name = decodeHtmlEntities(rawName);
	var cached = resolver.lookup(name, contextInfo);
	
	if (cached && !cached.ambiguous && cached.sleeperId) {
		var player = await Player.findOne({ sleeperId: cached.sleeperId });
		if (player) {
			return player._id;
		}
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
		var player = await Player.findOne({ sleeperId: null, name: cached.name });
		if (player) {
			return player._id;
		}
		var newPlayer = await Player.create({
			name: cached.name,
			sleeperId: null,
			positions: []
		});
		return newPlayer._id;
	}
	
	var sleeperSearchName = name.replace(/[\. '-]/g, '').toLowerCase();
	
	var matches = sleeperData.filter(function(p) {
		return p.search_full_name === sleeperSearchName;
	});
	
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
	
	var existing = await Player.findOne({ sleeperId: null, name: name });
	if (existing && !cached) {
		resolver.addResolution(name, null, name);
		return existing._id;
	}

	if (matches.length > 1 || (cached && cached.ambiguous)) {
		var displayMatches = matches;
		
		if (cached && cached.ambiguous) {
			displayMatches = sleeperData.filter(function(p) {
				return p.search_full_name === sleeperSearchName;
			});
		}
		
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
	}

	if (matches.length === 0 && !cached) {
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

	var confirmCreate = await prompt('  Create "' + name + '" as historical player? (y/n): ');
	if (confirmCreate.toLowerCase() !== 'y') {
		console.log('  Skipped.');
		return null;
	}
	
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
			var selected = matchingHistoricals[histIdx - 1];
			resolver.addResolution(name, null, selected.name, contextInfo);
			return selected._id;
		}
	}
	
	var displayName = name;
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
	
	resolver.addResolution(name, null, displayName, contextInfo);
	
	var newPlayer = await Player.create({
		name: displayName,
		sleeperId: null,
		positions: []
	});

	return newPlayer._id;
}

// ============================================
// Main seeding logic
// ============================================

async function seed() {
	console.log('Importing trade history from WordPress...\n');
	console.log('Loaded', resolver.count(), 'cached player resolutions\n');

	var clearExisting = process.argv.includes('--clear');
	if (clearExisting) {
		console.log('Clearing existing trade transactions...');
		await Transaction.deleteMany({ type: 'trade' });
		
		console.log('Clearing historical players (will be recreated)...');
		await Player.deleteMany({ sleeperId: null });
	}

	// Fetch trades from WordPress
	var posts = await fetchAllTrades();
	
	// Parse all trades
	var tradeHistory = [];
	for (var i = 0; i < posts.length; i++) {
		var post = posts[i];
		var tradeNumberMatch = post.title.match(/Trade #(\d+)/);
		var tradeNumber = tradeNumberMatch ? parseInt(tradeNumberMatch[1]) : null;

		var parsed = parseTradeContent(post.content);
		parsed.tradeNumber = tradeNumber;
		parsed.timestamp = new Date(post.date);
		parsed.tradeId = tradeNumber;
		parsed.url = post.URL;

		tradeHistory.push(parsed);
	}

	// Sort by trade number
	tradeHistory.sort(function(a, b) { return a.tradeNumber - b.tradeNumber; });

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

	var initialPlayerCount = await Player.countDocuments({ sleeperId: null });

	for (var i = 0; i < tradeHistory.length; i++) {
		var trade = tradeHistory[i];
		var tradeYear = new Date(trade.timestamp).getFullYear();

		if (!trade.parties || trade.parties.length < 2) {
			errors.push({ trade: trade.tradeNumber, reason: 'Less than 2 parties' });
			skipped++;
			continue;
		}

		var parties = [];
		var hasError = false;

		for (var j = 0; j < trade.parties.length; j++) {
			var p = trade.parties[j];

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

			for (var k = 0; k < p.receives.picks.length; k++) {
				var pick = p.receives.picks[k];
				var fromRosterId = getSleeperRosterId(pick.fromOwner);
				if (fromRosterId && franchiseByRosterId[fromRosterId]) {
					party.receives.picks.push({
						round: pick.round,
						season: pick.season || new Date(trade.timestamp).getFullYear() + 1,
						fromFranchiseId: franchiseByRosterId[fromRosterId]
					});
				}
			}

			for (var k = 0; k < p.receives.cash.length; k++) {
				var cash = p.receives.cash[k];
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

		try {
			await Transaction.create({
				type: 'trade',
				timestamp: new Date(trade.timestamp),
				source: 'wordpress',
				tradeId: trade.tradeNumber,
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

		if ((i + 1) % 100 === 0) {
			console.log('  Processed', i + 1, 'trades...');
		}
	}

	var finalPlayerCount = await Player.countDocuments({ sleeperId: null });
	historicalPlayersCreated = finalPlayerCount - initialPlayerCount;

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
