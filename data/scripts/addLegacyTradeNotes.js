/**
 * Fix legacy trade contract data and add notes for ambiguous cases.
 * 
 * For trades with tradeId <= 360, contract data may be incomplete.
 * This script:
 *   1. Parses the original WordPress post data
 *   2. Applies rules to unambiguously determine contracts where possible
 *   3. Updates transaction data with resolved contracts
 *   4. Only adds notes for contracts that remain ambiguous
 * 
 * Rules for unambiguous contracts:
 *   - Single year (e.g. "2010") with trade before Aug 1 of prior year = 3-year contract
 *   - Year with -R (e.g. "2021-R") with trade before Aug 1 of prior year = 3-year contract
 *   - "unsigned" = no contract data needed
 * 
 * Usage:
 *   docker compose run --rm web node data/scripts/addLegacyTradeNotes.js
 *   docker compose run --rm web node data/scripts/addLegacyTradeNotes.js --dry-run
 */

var dotenv = require('dotenv').config({ path: __dirname + '/../../.env' });
var mongoose = require('mongoose');
var request = require('superagent');

var Transaction = require('../../models/Transaction');
var Player = require('../../models/Player');
var resolver = require('./playerResolver');

mongoose.connect(process.env.MONGODB_URI);

var LEGACY_CUTOFF = 360;

// Track resolved player contracts: { playerId: { salary, startYear, endYear } }
var resolvedContracts = {};

/**
 * Fetch all trade posts from WordPress.
 */
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

/**
 * Decode common HTML entities.
 */
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
		.replace(/&gt;/g, '>')
		.replace(/&nbsp;/g, ' ');
}

/**
 * Parse a player contract string from WordPress.
 * Returns { name, salary, contractStr, startYear, endYear, isUnsigned, isAmbiguous }
 */
function parsePlayerContract(itemText, tradeDate) {
	// Match: Player Name ($salary, contractInfo)
	var match = itemText.match(/^(.+?)\s*\(\$?(\d+),\s*([^)]+)\)$/);
	if (!match) {
		// Check for RFA rights
		var rfaMatch = itemText.match(/^(.+?)\s*\(RFA rights\)$/i);
		if (rfaMatch) {
			return {
				name: rfaMatch[1].trim(),
				salary: null,
				contractStr: 'RFA rights',
				startYear: null,
				endYear: null,
				isUnsigned: false,
				isAmbiguous: false,
				isRfaRights: true
			};
		}
		return null;
	}

	var name = match[1].trim();
	var salary = parseInt(match[2]);
	var contractStr = match[3].trim();

	var result = {
		name: name,
		salary: salary,
		contractStr: contractStr,
		startYear: null,
		endYear: null,
		isUnsigned: false,
		isAmbiguous: false,
		isRfaRights: false
	};

	var tradeYear = tradeDate.getFullYear();
	var tradeMonth = tradeDate.getMonth(); // 0-indexed, so July = 6
	var tradeDay = tradeDate.getDate();
	// Before August 21 = contracts for this season not yet due
	var isBeforeAugust21 = (tradeMonth < 7) || (tradeMonth === 7 && tradeDay < 21);

	// Check for "unsigned", "FA", "franchise"
	var lowerContract = contractStr.toLowerCase();
	if (lowerContract === 'unsigned' || lowerContract === 'fa' || lowerContract === 'franchise') {
		result.isUnsigned = true;
		return result;
	}

	// Check for year range: "2019/21" or "2019/2021" or "19/21"
	var rangeMatch = contractStr.match(/^(\d{2,4})\/(\d{2,4})$/);
	if (rangeMatch) {
		var start = rangeMatch[1];
		var end = rangeMatch[2];
		result.startYear = start.length === 2 ? parseInt('20' + start) : parseInt(start);
		result.endYear = end.length === 2 ? parseInt('20' + end) : parseInt(end);
		return result;
	}

	// Check for single year with -R: "2021-R"
	var yearRMatch = contractStr.match(/^(\d{2,4})-R$/i);
	if (yearRMatch) {
		var year = yearRMatch[1];
		var endYear = year.length === 2 ? parseInt('20' + year) : parseInt(year);
		
		// League started in 2008, so any trade in 2008 with multi-year contracts must start in 2008
		// (But single-year 2008 contracts are ambiguous: could be "08/08" or "FA/08")
		// If trade year is 2+ years before end year, it's definitely a 3-year contract
		// If trade year is 1 year before end year AND before Aug 21, it's a 3-year contract
		// If trade year equals end year AND before Aug 21, it's a 2-year contract
		if (tradeYear === 2008 && endYear > 2008) {
			result.startYear = 2008;
			result.endYear = endYear;
		} else if (tradeYear <= endYear - 2) {
			result.startYear = endYear - 2;
			result.endYear = endYear;
		} else if (tradeYear === endYear - 1 && isBeforeAugust21) {
			result.startYear = endYear - 2;
			result.endYear = endYear;
		} else if (tradeYear === 2009 && endYear === 2009 && isBeforeAugust21) {
			// Special case: league started in 2008, so a 2009 contract before Aug 2009
			// must be 2008-2009 (can't be 2007-2009 because no 2007 season)
			result.startYear = 2008;
			result.endYear = 2009;
		} else {
			// Ambiguous - can't determine start year
			result.endYear = endYear;
			result.isAmbiguous = true;
		}
		return result;
	}

	// Check for single year: "2010" or "10"
	var singleYearMatch = contractStr.match(/^(\d{2,4})$/);
	if (singleYearMatch) {
		var year = singleYearMatch[1];
		var endYear = year.length === 2 ? parseInt('20' + year) : parseInt(year);
		
		// League started in 2008, so any trade in 2008 with multi-year contracts must start in 2008
		// (But single-year 2008 contracts are ambiguous: could be "08/08" or "FA/08")
		// If trade year is 2+ years before end year, it's definitely a 3-year contract
		// If trade year is 1 year before end year AND before Aug 21, it's a 3-year contract
		// If trade year equals end year AND before Aug 21, it's a 2-year contract
		if (tradeYear === 2008 && endYear > 2008) {
			result.startYear = 2008;
			result.endYear = endYear;
		} else if (tradeYear <= endYear - 2) {
			result.startYear = endYear - 2;
			result.endYear = endYear;
		} else if (tradeYear === endYear - 1 && isBeforeAugust21) {
			result.startYear = endYear - 2;
			result.endYear = endYear;
		} else if (tradeYear === 2009 && endYear === 2009 && isBeforeAugust21) {
			// Special case: league started in 2008, so a 2009 contract before Aug 2009
			// must be 2008-2009 (can't be 2007-2009 because no 2007 season)
			result.startYear = 2008;
			result.endYear = 2009;
		} else {
			// Ambiguous - can't determine start year
			result.endYear = endYear;
			result.isAmbiguous = true;
		}
		return result;
	}

	// Check for year with -U (unclear what this means, treat as ambiguous)
	var yearUMatch = contractStr.match(/^(\d{2,4})-U$/i);
	if (yearUMatch) {
		var year = yearUMatch[1];
		result.endYear = year.length === 2 ? parseInt('20' + year) : parseInt(year);
		result.isAmbiguous = true;
		return result;
	}

	// Unknown format - ambiguous
	result.isAmbiguous = true;
	return result;
}

/**
 * Extract player contracts from WordPress HTML.
 */
function extractPlayerContracts(html, tradeDate) {
	var allContracts = [];

	// Split by <strong> tags to find each party's section
	var sections = html.split(/<strong>/);

	for (var i = 1; i < sections.length; i++) {
		var section = sections[i];

		// Extract owner name
		var ownerMatch = section.match(/^([^<]+)<\/strong>/);
		if (!ownerMatch) continue;

		var ownerName = decodeHtmlEntities(ownerMatch[1].trim());

		// Extract list items
		var listItems = section.match(/<li>.*?<\/li>/g) || [];

		for (var j = 0; j < listItems.length; j++) {
			var item = listItems[j];
			var cleanItem = decodeHtmlEntities(item.replace(/<[^>]+>/g, '')).trim();
			
			// Skip picks and cash
			if (/\d+(?:st|nd|rd|th)\s+round/i.test(cleanItem)) continue;
			if (/^\$\d+\s+(from|in)/i.test(cleanItem)) continue;
			
			var parsed = parsePlayerContract(cleanItem, tradeDate);
			if (parsed) {
				parsed.receiver = ownerName;
				parsed.rawText = cleanItem;
				allContracts.push(parsed);
			}
		}
	}

	return allContracts;
}

/**
 * Find a player by name using the player resolver.
 */
async function findPlayerByName(name, contextInfo) {
	// Check the resolver cache first
	var cached = resolver.lookup(name, contextInfo);
	
	if (cached && !cached.ambiguous && cached.sleeperId) {
		// Found in cache with sleeperId
		var player = await Player.findOne({ sleeperId: cached.sleeperId });
		if (player) return player;
	}
	
	if (cached && !cached.ambiguous && cached.sleeperId === null && cached.name) {
		// Historical player (no sleeperId, but has a name)
		var player = await Player.findOne({ sleeperId: null, name: cached.name });
		if (player) return player;
	}
	
	// Not in resolver cache - try direct name match
	var player = await Player.findOne({ name: name });
	if (player) return player;

	// Try case-insensitive
	player = await Player.findOne({ name: new RegExp('^' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') });
	if (player) return player;

	// Try without suffix (Jr., III, etc.)
	var cleanName = name.replace(/\s+(Jr\.?|Sr\.?|III|II|IV|V)$/i, '').trim();
	if (cleanName !== name) {
		player = await Player.findOne({ name: new RegExp('^' + cleanName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') });
		if (player) return player;
	}

	return null;
}

async function run() {
	var dryRun = process.argv.includes('--dry-run');

	console.log('Processing legacy trades (tradeId <= ' + LEGACY_CUTOFF + ')...\n');
	console.log('Loaded', resolver.count(), 'cached player resolutions\n');
	if (dryRun) {
		console.log('DRY RUN - no changes will be made\n');
	}

	// Fetch WordPress posts
	var posts = await fetchAllTrades();

	// Build a map of trade number -> post data
	var postsByTradeNumber = {};
	for (var i = 0; i < posts.length; i++) {
		var post = posts[i];
		var tradeNumberMatch = post.title.match(/Trade #(\d+)/);
		if (tradeNumberMatch) {
			var tradeNumber = parseInt(tradeNumberMatch[1]);
			if (tradeNumber <= LEGACY_CUTOFF) {
				postsByTradeNumber[tradeNumber] = {
					content: post.content,
					url: post.URL,
					date: new Date(post.date)
				};
			}
		}
	}

	console.log('Found', Object.keys(postsByTradeNumber).length, 'legacy WordPress posts (<= #' + LEGACY_CUTOFF + ')\n');

	// Find all legacy trades in the database, sorted by trade number (chronological)
	var legacyTrades = await Transaction.find({
		type: 'trade',
		tradeId: { $lte: LEGACY_CUTOFF }
	}).sort({ tradeId: 1 });

	console.log('Found', legacyTrades.length, 'legacy trades in database\n');

	var stats = {
		contractsResolved: 0,
		contractsAlreadyKnown: 0,
		contractsAmbiguous: 0,
		tradesUpdated: 0,
		tradesWithNotes: 0,
		notesCleared: 0,
		tradesSkipped: 0,
		tradesNotFound: 0
	};

	for (var i = 0; i < legacyTrades.length; i++) {
		var trade = legacyTrades[i];
		var tradeNumber = trade.tradeId;
		var wpPost = postsByTradeNumber[tradeNumber];

		if (!wpPost) {
			console.log('Trade #' + tradeNumber + ': No WordPress post found');
			stats.tradesNotFound++;
			continue;
		}

		var contracts = extractPlayerContracts(wpPost.content, wpPost.date);
		
		if (contracts.length === 0) {
			// No player contracts in this trade
			stats.tradesSkipped++;
			continue;
		}

		var ambiguousContracts = [];
		var contractUpdates = []; // { partyIndex, playerIndex, startYear, endYear }
		var transactionNeedsUpdate = false;

		// Process each contract from WordPress
		for (var c = 0; c < contracts.length; c++) {
			var wpContract = contracts[c];
			
			// Skip RFA rights and unsigned
			if (wpContract.isRfaRights || wpContract.isUnsigned) {
				continue;
			}

			// Find the player using resolver with context
			var tradeYear = wpPost.date.getFullYear();
			var contextInfo = { year: tradeYear, franchise: wpContract.receiver.toLowerCase() };
			var player = await findPlayerByName(wpContract.name, contextInfo);
			if (!player) {
				console.log('  Trade #' + tradeNumber + ': Could not find player "' + wpContract.name + '"');
				ambiguousContracts.push(wpContract.rawText);
				continue;
			}

			var playerId = player._id.toString();

			// Check if we've already resolved this player's contract from an earlier trade
			var knownContract = resolvedContracts[playerId];
			if (knownContract) {
				// Apply the known contract to this trade if needed
				for (var p = 0; p < trade.parties.length; p++) {
					var party = trade.parties[p];
					for (var pl = 0; pl < party.receives.players.length; pl++) {
						var txPlayer = party.receives.players[pl];
						if (txPlayer.playerId.toString() === playerId) {
							var needsUpdate = false;
							if (txPlayer.startYear !== knownContract.startYear) needsUpdate = true;
							if (txPlayer.endYear !== knownContract.endYear) needsUpdate = true;

							if (needsUpdate) {
								contractUpdates.push({
									partyIndex: p,
									playerIndex: pl,
									startYear: knownContract.startYear,
									endYear: knownContract.endYear,
									playerName: wpContract.name,
									originalText: '(from earlier trade)'
								});
								transactionNeedsUpdate = true;
							}
						}
					}
				}
				stats.contractsAlreadyKnown++;
				continue;
			}

			// Check if this contract is ambiguous
			if (wpContract.isAmbiguous) {
				ambiguousContracts.push(wpContract.rawText);
				stats.contractsAmbiguous++;
				continue;
			}

			// We can resolve this contract!
			// Find the corresponding player in the transaction
			for (var p = 0; p < trade.parties.length; p++) {
				var party = trade.parties[p];
				for (var pl = 0; pl < party.receives.players.length; pl++) {
					var txPlayer = party.receives.players[pl];
					if (txPlayer.playerId.toString() === playerId) {
						// Check if we need to update
						var needsUpdate = false;
						if (txPlayer.startYear !== wpContract.startYear) needsUpdate = true;
						if (txPlayer.endYear !== wpContract.endYear) needsUpdate = true;

						if (needsUpdate) {
							contractUpdates.push({
								partyIndex: p,
								playerIndex: pl,
								startYear: wpContract.startYear,
								endYear: wpContract.endYear,
								playerName: wpContract.name,
								originalText: wpContract.rawText
							});
							transactionNeedsUpdate = true;
						}

						// Mark as resolved for future trades
						resolvedContracts[playerId] = {
							salary: wpContract.salary,
							startYear: wpContract.startYear,
							endYear: wpContract.endYear
						};
						stats.contractsResolved++;
					}
				}
			}
		}

		// Apply updates
		var tradeDate = wpPost.date.toISOString().split('T')[0];
		
		if (transactionNeedsUpdate && !dryRun) {
			console.log('Trade #' + tradeNumber + ' (' + tradeDate + ') updating:');
			for (var u = 0; u < contractUpdates.length; u++) {
				var update = contractUpdates[u];
				var path = 'parties.' + update.partyIndex + '.receives.players.' + update.playerIndex;
				var updateObj = {};
				updateObj[path + '.startYear'] = update.startYear;
				updateObj[path + '.endYear'] = update.endYear;
				
				await Transaction.updateOne(
					{ _id: trade._id },
					{ $set: updateObj }
				);
				console.log('  ✓ ' + update.playerName + ': "' + update.originalText + '" → ' + update.startYear + '/' + update.endYear);
			}
			stats.tradesUpdated++;
		}

		if (transactionNeedsUpdate && dryRun) {
			console.log('Trade #' + tradeNumber + ' (' + tradeDate + ') would update:');
			for (var u = 0; u < contractUpdates.length; u++) {
				var update = contractUpdates[u];
				console.log('  → ' + update.playerName + ': "' + update.originalText + '" → ' + update.startYear + '/' + update.endYear);
			}
			stats.tradesUpdated++;
		}

		// Handle notes based on ambiguous contracts
		if (ambiguousContracts.length > 0) {
			var note = 'Contract data may be incomplete: ' + ambiguousContracts.join('; ');
			
			if (dryRun) {
				console.log('Trade #' + tradeNumber + ' (' + tradeDate + ') ambiguous:');
				for (var a = 0; a < ambiguousContracts.length; a++) {
					console.log('  ? ' + ambiguousContracts[a]);
				}
			} else {
				// Always set/update the note to reflect current ambiguous contracts
				if (trade.notes !== note) {
					await Transaction.updateOne(
						{ _id: trade._id },
						{ $set: { notes: note } }
					);
					console.log('Trade #' + tradeNumber + ' (' + tradeDate + ') set note: ' + ambiguousContracts.join('; '));
				}
			}
			stats.tradesWithNotes++;
		} else if (trade.notes) {
			// All contracts resolved - clear any existing note
			if (dryRun) {
				console.log('Trade #' + tradeNumber + ' (' + tradeDate + ') would clear note (all resolved)');
			} else {
				await Transaction.updateOne(
					{ _id: trade._id },
					{ $unset: { notes: '' } }
				);
				console.log('Trade #' + tradeNumber + ' (' + tradeDate + ') cleared note (all resolved)');
			}
			stats.notesCleared++;
		}
	}

	console.log('\nDone!');
	console.log('  Contracts resolved (updated):', stats.contractsResolved);
	console.log('  Contracts already known from earlier trades:', stats.contractsAlreadyKnown);
	console.log('  Contracts ambiguous (notes added):', stats.contractsAmbiguous);
	console.log('  Trades updated:', stats.tradesUpdated);
	console.log('  Trades with notes:', stats.tradesWithNotes);
	console.log('  Notes cleared (all resolved):', stats.notesCleared);
	console.log('  Trades skipped (no players):', stats.tradesSkipped);
	console.log('  Trades not found in WordPress:', stats.tradesNotFound);
	console.log('  Total player contracts tracked:', Object.keys(resolvedContracts).length);

	process.exit(0);
}

run().catch(function(err) {
	console.error('Error:', err);
	process.exit(1);
});
