/**
 * Seed trades from trades.json into the database.
 * Uses the player resolver for matching and interactive disambiguation.
 * 
 * Usage:
 *   docker compose run --rm -it web node data/seed/trades.js
 *   docker compose run --rm -it web node data/seed/trades.js --clear
 */

var dotenv = require('dotenv').config({ path: __dirname + '/../../.env' });
var mongoose = require('mongoose');
var readline = require('readline');

var Transaction = require('../../models/Transaction');
var Franchise = require('../../models/Franchise');
var Player = require('../../models/Player');
var PSO = require('../../config/pso.js');
var resolver = require('../utils/player-resolver');

// Facts and inference engine integration
var facts = require('../facts');
var tradeFacts = require('../facts/trade-facts');
var contractTermInference = require('../inference/contract-term');

var sleeperData = Object.values(require('../../public/data/sleeper-data.json'));

// Inference context (loaded once at startup)
var inferenceContext = null;

/**
 * Load inference context data (snapshots, cuts, preseason rosters).
 * Called once at startup before processing trades.
 */
function loadInferenceContext() {
	if (inferenceContext) return inferenceContext;
	
	console.log('Loading inference context...');
	var snapshots = facts.snapshots.loadAll();
	var cuts = facts.cuts.checkAvailability() ? facts.cuts.loadAll() : [];
	var preseasonRosters = snapshots.filter(function(s) {
		return s.source === 'contracts';
	});
	
	inferenceContext = {
		snapshots: snapshots,
		cuts: cuts,
		preseasonRosters: preseasonRosters
	};
	
	console.log('  Loaded ' + snapshots.length + ' snapshots, ' + cuts.length + ' cuts');
	return inferenceContext;
}

// Build ESPN ID → Sleeper ID lookup
var espnToSleeperId = {};
sleeperData.forEach(function(p) {
	if (p.espn_id) {
		espnToSleeperId[String(p.espn_id)] = p.player_id;
	}
});

mongoose.connect(process.env.MONGODB_URI);

// Global readline interface and player lookup
var rl = null;
var playersByNormalizedName = {};
var playersBySleeperId = {};

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
 * Parse a contract string using the inference engine.
 * Returns { startYear, endYear, ambiguous }
 * 
 * Uses snapshots, cuts, and preseason roster data to achieve high-confidence inference.
 * 
 * @param {string} contractStr - The contract notation (e.g., "2019", "2019/2021", "FA", "2019-R", "2019-U")
 * @param {string} playerName - The player's name (for snapshot/cuts matching)
 * @param {number} salary - The player's salary
 * @param {Date} tradeDate - The date of the trade
 */
function parseContract(contractStr, playerName, salary, tradeDate) {
	var result = { startYear: null, endYear: null, ambiguous: false };
	
	if (!contractStr) return result;
	
	// Ensure inference context is loaded
	var ctx = loadInferenceContext();
	
	// Get preseason roster for this trade's season
	var seasonYear = contractTermInference.getSeasonYear(tradeDate);
	var preseasonRoster = ctx.preseasonRosters.filter(function(p) {
		return p.season === seasonYear;
	});
	
	// Run inference
	var inference = contractTermInference.infer(contractStr, {
		date: tradeDate,
		playerName: playerName,
		salary: salary,
		snapshots: ctx.snapshots,
		cuts: ctx.cuts,
		preseasonRoster: preseasonRoster
	});
	
	result.startYear = inference.startYear;
	result.endYear = inference.endYear;
	result.ambiguous = (inference.confidence === 'ambiguous');
	
	return result;
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

/**
 * Get franchise rosterId for an owner name in a specific season.
 * Uses PSO.franchiseNames which maps rosterId -> { year: ownerName }.
 * This handles ownership changes over time (e.g., "Schexes" was franchise 10 in 2008-2011,
 * but franchise 9 in 2024+).
 */
function getRosterIdForSeason(ownerName, season) {
	if (!ownerName) return null;
	var name = ownerName.trim();
	
	// Build a reverse lookup: for this season, which rosterId has this owner name?
	var rosterIds = Object.keys(PSO.franchiseNames);
	for (var i = 0; i < rosterIds.length; i++) {
		var rid = parseInt(rosterIds[i], 10);
		var yearMap = PSO.franchiseNames[rid];
		var ownerForYear = yearMap[season];
		if (ownerForYear && ownerForYear.toLowerCase() === name.toLowerCase()) {
			return rid;
		}
	}
	
	// Partial/fuzzy match (e.g., "Koci" matches "Koci/Mueller")
	for (var i = 0; i < rosterIds.length; i++) {
		var rid = parseInt(rosterIds[i], 10);
		var yearMap = PSO.franchiseNames[rid];
		var ownerForYear = yearMap[season];
		if (ownerForYear) {
			var lower = ownerForYear.toLowerCase();
			var nameLower = name.toLowerCase();
			if (lower.indexOf(nameLower) >= 0 || nameLower.indexOf(lower) >= 0) {
				return rid;
			}
		}
	}
	
	return null;
}

// Keep legacy function for cases where season isn't available (shouldn't happen for trades)
function getSleeperRosterId(ownerName) {
	if (!ownerName) return null;
	var name = ownerName.trim();
	return PSO.franchiseIds[name] || null;
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

async function findOrCreatePlayer(rawName, tradeContext, contextInfo, tradeUrl, espnId) {
	if (!rawName) return null;
	
	var name = decodeHtmlEntities(rawName);
	
	// Try ESPN ID first - this is unambiguous
	if (espnId && espnToSleeperId[espnId]) {
		var sleeperId = espnToSleeperId[espnId];
		var player = playersBySleeperId[sleeperId];
		if (player) {
			resolver.addResolution(name, sleeperId, null, contextInfo);
			resolver.save();
			return player._id;
		}
	}
	
	// Get candidates from DB lookup
	var normalizedName = resolver.normalizePlayerName(name);
	var candidates = playersByNormalizedName[normalizedName] || [];
	
	// Use unified prompt
	var result = await resolver.promptForPlayer({
		name: name,
		context: contextInfo,
		candidates: candidates,
		Player: Player,
		rl: rl,
		playerCache: playersByNormalizedName
	});
	
	if (result.action === 'quit') {
		console.log('\nQuitting...');
		rl.close();
		resolver.save();
		await mongoose.disconnect();
		process.exit(130);
	}
	
	if (result.action === 'skipped' || !result.player) {
		return null;
	}
	
	return result.player._id;
}

// ============================================
// Main seeding logic
// ============================================

async function seed() {
	console.log('Importing trade history from trades.json...\n');
	console.log('Loaded', resolver.count(), 'cached player resolutions');
	console.log('Loaded', Object.keys(espnToSleeperId).length, 'ESPN ID mappings from Sleeper data\n');

	// Create readline interface
	rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout
	});

	// Load all players and build lookups
	var allPlayers = await Player.find({});
	allPlayers.forEach(function(p) {
		var normalized = resolver.normalizePlayerName(p.name);
		if (!playersByNormalizedName[normalized]) {
			playersByNormalizedName[normalized] = [];
		}
		playersByNormalizedName[normalized].push(p);
		if (p.sleeperId) {
			playersBySleeperId[p.sleeperId] = p;
		}
	});
	console.log('Loaded', allPlayers.length, 'players from database');

	var clearExisting = process.argv.includes('--clear');
	if (clearExisting) {
		console.log('Clearing existing trade transactions...');
		await Transaction.deleteMany({ type: 'trade' });
		
		console.log('Clearing historical players (will be recreated)...');
		await Player.deleteMany({ sleeperId: null });
	}

	// Load trades from trades.json
	var rawTrades = tradeFacts.loadAll();
	console.log('Loaded', rawTrades.length, 'trades from trades.json\n');
	
	// Convert trades.json format to the format expected by the rest of this script
	// trades.json has: party.players, party.picks, party.cash, party.rfaRights
	// We need: party.receives.players, party.receives.picks, party.receives.cash
	// Also run contract inference on contractStr
	var tradeHistory = rawTrades.map(function(trade) {
		var tradeDate = trade.date instanceof Date ? trade.date : new Date(trade.date);
		
		var convertedParties = trade.parties.map(function(party) {
			// Convert players - use pre-computed contract data from trades.json
			var convertedPlayers = (party.players || []).map(function(player) {
				// Use pre-computed contract field if available, fall back to runtime inference
				var contract = player.contract || parseContract(player.contractStr, player.name, player.salary, tradeDate);
				return {
					name: player.name,
					espnId: player.espnId,
					salary: player.salary,
					startYear: contract.start !== undefined ? contract.start : contract.startYear,
					endYear: contract.end !== undefined ? contract.end : contract.endYear,
					ambiguous: contract.source === 'ambiguous'
				};
			});
			
			// Convert RFA rights
			var convertedRfaRights = (party.rfaRights || []).map(function(rfa) {
				return {
					name: rfa.name,
					espnId: rfa.espnId,
					rfaRights: true,
					salary: null,
					startYear: null,
					endYear: null
				};
			});
			
			return {
				owner: party.owner,
				receives: {
					players: convertedPlayers.concat(convertedRfaRights),
					picks: party.picks || [],
					cash: party.cash || []
				}
			};
		});
		
		return {
			tradeNumber: trade.tradeId,
			tradeId: trade.tradeId,
			timestamp: tradeDate,
			url: trade.url,
			parties: convertedParties
		};
	});

	// Sort by trade number
	tradeHistory.sort(function(a, b) { return a.tradeNumber - b.tradeNumber; });

	// Load franchises
	var franchises = await Franchise.find({});
	var franchiseByRosterId = {};
	franchises.forEach(function(f) {
		franchiseByRosterId[f.rosterId] = f._id;
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

			var rosterId = getRosterIdForSeason(p.owner, tradeYear);
			if (!rosterId) {
				errors.push({ trade: trade.tradeNumber, reason: 'Unknown owner: ' + p.owner + ' in ' + tradeYear });
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
				}
			};

			for (var k = 0; k < p.receives.players.length; k++) {
				var player = p.receives.players[k];
				var tradeContext = 'Trade #' + trade.tradeNumber + ' (' + new Date(trade.timestamp).toISOString().split('T')[0] + ') - ' + p.owner + ' receives';
				var tradeUrl = trade.url;
				var contextInfo = { year: tradeYear, type: 'trade', franchise: p.owner };
				
				var playerId = await findOrCreatePlayer(player.name, tradeContext, contextInfo, tradeUrl, player.espnId);

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
				var fromRosterId = getRosterIdForSeason(pick.fromOwner, tradeYear);
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
				var fromRosterId = getRosterIdForSeason(cash.fromOwner, tradeYear);
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
