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

// ============================================
// Contract parsing with heuristics
// ============================================

// Auction dates per season (when contracts for that season are signed)
var auctionDates = {
	2008: new Date('2008-08-18'),
	2009: new Date('2009-08-16'),
	2010: new Date('2010-08-22'),
	2011: new Date('2011-08-20'),
	2012: new Date('2012-08-25'),
	2013: new Date('2013-08-24'),
	2014: new Date('2014-08-23'),
	2015: new Date('2015-08-29'),
	2016: new Date('2016-08-20'),
	2017: new Date('2017-08-19'),
	2018: new Date('2018-08-25'),
	2019: new Date('2019-08-24'),
	2020: new Date('2020-08-29'),
	2021: new Date('2021-08-28'),
	2022: new Date('2022-08-27'),
	2023: new Date('2023-08-26'),
	2024: new Date('2024-08-26'),
	2025: new Date('2025-08-23')
};

/**
 * Get the "season year" for a trade date.
 * A trade that happens before this year's auction is in the previous season.
 * e.g., a trade on Jan 15, 2016 is in the 2015 season.
 */
function getSeasonYear(tradeDate) {
	var calendarYear = tradeDate.getFullYear();
	var auctionDate = auctionDates[calendarYear];
	
	// If trade is before this year's auction, it's last season
	if (auctionDate && tradeDate < auctionDate) {
		return calendarYear - 1;
	}
	return calendarYear;
}

// Contract due dates per season (contracts must be submitted by this date)
var contractDueDates = {
	2008: new Date('2008-08-24'),
	2009: new Date('2009-09-02'),
	2010: new Date('2010-08-31'),
	2011: new Date('2011-08-26'),
	2012: new Date('2012-09-01'),
	2013: new Date('2013-08-31'),
	2014: new Date('2014-08-31'),
	2015: new Date('2015-09-05'),
	2016: new Date('2016-08-28'),
	2017: new Date('2017-08-27'),
	2018: new Date('2018-09-01'),
	2019: new Date('2019-09-01'),
	2020: new Date('2020-09-07'),
	2021: new Date('2021-09-06'),
	2022: new Date('2022-09-05'),
	2023: new Date('2023-09-04'),
	2024: new Date('2024-09-02'),
	2025: new Date('2025-09-01')
};

// NFL season start dates (first game of the season)
var seasonStartDates = {
	2008: new Date('2008-09-04'),
	2009: new Date('2009-09-10'),
	2010: new Date('2010-09-09'),
	2011: new Date('2011-09-08'),
	2012: new Date('2012-09-05'),
	2013: new Date('2013-09-05'),
	2014: new Date('2014-09-04'),
	2015: new Date('2015-09-10'),
	2016: new Date('2016-09-08'),
	2017: new Date('2017-09-07'),
	2018: new Date('2018-09-06'),
	2019: new Date('2019-09-05'),
	2020: new Date('2020-09-10'),
	2021: new Date('2021-09-09'),
	2022: new Date('2022-09-08'),
	2023: new Date('2023-09-07'),
	2024: new Date('2024-09-05'),
	2025: new Date('2025-09-04')
};

/**
 * Parse a contract string and apply heuristics to determine start/end years.
 * Returns { startYear, endYear, ambiguous }
 * 
 * @param {string} contractStr - The contract notation (e.g., "2019", "2019/2021", "FA", "2019-R", "2019-U")
 * @param {number} salary - The player's salary (used for high-salary heuristic)
 * @param {Date} tradeDate - The date of the trade
 */
function parseContract(contractStr, salary, tradeDate) {
	var result = { startYear: null, endYear: null, ambiguous: false };
	
	if (!contractStr) return result;
	
	contractStr = contractStr.trim();
	// Use season year (a trade before this year's auction is in the previous season)
	var seasonYear = getSeasonYear(tradeDate);
	// Use per-year contract due date, fall back to August 21 for unknown years
	var dueDate = contractDueDates[seasonYear] || new Date(seasonYear + '-08-21');
	var isBeforeContractsDue = tradeDate < dueDate;
	
	// Check for FA/unsigned/franchise - no contract
	var lowerContract = contractStr.toLowerCase();
	if (lowerContract === 'fa' || lowerContract === 'unsigned' || lowerContract === 'franchise') {
		return result; // startYear and endYear stay null
	}
	
	// Check for year range: "2019/21" or "2019/2021" or "19/21"
	var rangeMatch = contractStr.match(/^(\d{2,4})\/(\d{2,4})$/);
	if (rangeMatch) {
		var start = rangeMatch[1];
		var end = rangeMatch[2];
		result.startYear = start.length === 2 ? parseInt('20' + start) : parseInt(start);
		result.endYear = end.length === 2 ? parseInt('20' + end) : parseInt(end);
		return result; // Explicit range, not ambiguous
	}
	
	// Check for FA/year range: "FA/21" or "FA/2021"
	var faRangeMatch = contractStr.match(/^FA\/(\d{2,4})$/i);
	if (faRangeMatch) {
		var end = faRangeMatch[1];
		result.startYear = null; // FA pickup
		result.endYear = end.length === 2 ? parseInt('20' + end) : parseInt(end);
		return result; // Explicit FA notation, not ambiguous
	}
	
	// Check for single year with -R suffix: "2021-R" (Restricted Free Agent = multi-year)
	var yearRMatch = contractStr.match(/^(\d{2,4})-R$/i);
	if (yearRMatch) {
		var year = yearRMatch[1];
		var endYear = year.length === 2 ? parseInt('20' + year) : parseInt(year);
		result.endYear = endYear;
		
		// -R means multi-year contract (RFA status). Apply date-based heuristics.
		if (seasonYear === 2008 && endYear > 2008) {
			result.startYear = 2008;
		} else if (seasonYear <= endYear - 2) {
			result.startYear = endYear - 2;
		} else if (seasonYear === endYear - 1 && isBeforeContractsDue) {
			result.startYear = endYear - 2;
		} else if (seasonYear === 2009 && endYear === 2009 && isBeforeContractsDue) {
			result.startYear = 2008;
		} else {
			// Can't determine if 2-year or 3-year, but we know it's multi-year
			// Default to minimum possible (seasonYear) since contract must cover trade date
			result.startYear = Math.min(seasonYear, endYear);
			result.ambiguous = true;
		}
		return result;
	}
	
	// Check for single year with -U suffix: "2021-U" (Unrestricted Free Agent)
	var yearUMatch = contractStr.match(/^(\d{2,4})-U$/i);
	if (yearUMatch) {
		var year = yearUMatch[1];
		var endYear = year.length === 2 ? parseInt('20' + year) : parseInt(year);
		result.endYear = endYear;
		
		// -U means UFA. Can't determine contract length from notation alone.
		// Default to minimum possible (seasonYear) since contract must cover trade date
		result.startYear = Math.min(seasonYear, endYear);
		result.ambiguous = true;
		return result;
	}
	
	// Check for single year: "2010" or "10"
	var singleYearMatch = contractStr.match(/^(\d{2,4})$/);
	if (singleYearMatch) {
		var year = singleYearMatch[1];
		var endYear = year.length === 2 ? parseInt('20' + year) : parseInt(year);
		result.endYear = endYear;
		
		// Apply heuristics to determine startYear
		if (seasonYear === 2008 && endYear > 2008) {
			result.startYear = 2008;
		} else if (seasonYear <= endYear - 2) {
			// Trade 2+ years before contract ends = definitely 3-year contract
			result.startYear = endYear - 2;
		} else if (seasonYear === endYear - 1 && isBeforeContractsDue) {
			// Trade 1 year before end, before contracts due = 3-year contract
			result.startYear = endYear - 2;
		} else if (seasonYear === 2009 && endYear === 2009 && isBeforeContractsDue) {
			// Special case: league started 2008
			result.startYear = 2008;
		} else {
			// Can't determine - could be 1-year auction, FA pickup, or final year of multi-year deal
			// Default to minimum possible (seasonYear) since contract must cover trade date
			result.startYear = Math.min(seasonYear, endYear);
			result.ambiguous = true;
		}
		return result;
	}
	
	// Unknown format - mark as ambiguous
	result.ambiguous = true;
	return result;
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

function parseTradeContent(html, tradeDate) {
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
				var salary = parseInt(playerMatch[2].replace('$', ''));
				var contract = parseContract(contractStr, salary, tradeDate);

				party.receives.players.push({
					name: playerMatch[1].trim(),
					salary: salary,
					startYear: contract.startYear,
					endYear: contract.endYear,
					ambiguous: contract.ambiguous
				});
				continue;
			}

			// Player without link (plain text)
			var plainPlayerMatch = item.match(/<li>\s*([A-Za-z][A-Za-z\.\s'-]+[A-Za-z])\s*\((\$?\d+),?\s*([^)]+)\)/);
			if (plainPlayerMatch) {
				var contractStr = plainPlayerMatch[3].trim();
				var salary = parseInt(plainPlayerMatch[2].replace('$', ''));
				var contract = parseContract(contractStr, salary, tradeDate);

				party.receives.players.push({
					name: plainPlayerMatch[1].trim(),
					salary: salary,
					startYear: contract.startYear,
					endYear: contract.endYear,
					ambiguous: contract.ambiguous
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
		var tradeDate = new Date(post.date);

		var parsed = parseTradeContent(post.content, tradeDate);
		parsed.tradeNumber = tradeNumber;
		parsed.timestamp = tradeDate;
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

	// Load draft info for rookie contract heuristic
	var draftInfo = {};
	var draftTransactions = await Transaction.find({ type: 'draft-select' });
	draftTransactions.forEach(function(t) {
		if (t.playerId && t.timestamp) {
			draftInfo[t.playerId.toString()] = {
				draftYear: t.timestamp.getFullYear(),
				salary: t.salary || null
			};
		}
	});

	console.log('Loaded', franchises.length, 'franchises');
	console.log('Loaded', Object.keys(draftInfo).length, 'draft records for rookie heuristic');
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
					var playerEntry = {
						playerId: playerId,
						salary: player.salary,
						startYear: player.startYear,
						endYear: player.endYear
					};
					if (player.ambiguous) {
						playerEntry.ambiguous = true;
					}
					
					// Apply date-aware rookie contract heuristic
					// If player was drafted in our league, salary matches, and contract term
					// is consistent with a rookie deal, we can infer startYear = draftYear
					var draft = draftInfo[playerId.toString()];
					if (draft && playerEntry.ambiguous && playerEntry.endYear) {
						var yearsFromDraft = playerEntry.endYear - draft.draftYear;
						var salaryMatches = !draft.salary || playerEntry.salary === draft.salary;
						
						if (yearsFromDraft >= 0 && yearsFromDraft <= 2 && salaryMatches) {
							// Check timing: pre-season/early-season = any salary, mid-season = $5+
							var tradeDate = new Date(trade.timestamp);
							var seasonStart = seasonStartDates[tradeYear] || new Date(tradeYear + '-09-07');
							var daysFromSeasonStart = Math.round((tradeDate - seasonStart) / (1000 * 60 * 60 * 24));
							
							var isHighConfidence = false;
							if (daysFromSeasonStart < 28) {
								// Pre-season or early season (before week 5): any salary is fine
								isHighConfidence = true;
							} else if (daysFromSeasonStart < 84 && playerEntry.salary >= 5) {
								// Mid-season (weeks 5-12): require $5+ salary
								isHighConfidence = true;
							}
							
							if (isHighConfidence) {
								playerEntry.startYear = draft.draftYear;
								playerEntry.ambiguous = false;
							}
						}
					}
					
					party.receives.players.push(playerEntry);
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
