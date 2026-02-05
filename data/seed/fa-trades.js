/**
 * Seed FA Pickups from Trade Data
 * 
 * Infers FA pickups for players who were traded away but have no prior
 * acquisition transaction. If party A receives a player from party B,
 * and party B has no prior transaction for that player, party B must
 * have picked them up as a free agent.
 * 
 * Usage:
 *   node data/seed/fa-trades.js [--dry-run] [--year=YYYY]
 */

var readline = require('readline');
var mongoose = require('mongoose');
var Player = require('../../models/Player');
var Franchise = require('../../models/Franchise');
var Transaction = require('../../models/Transaction');
var Regime = require('../../models/Regime');
var tradeFacts = require('../facts/trade-facts');
var resolver = require('../utils/player-resolver');

var FIRST_YEAR = 2008;
var LAST_YEAR = 2019;

// Global state
var rl = null;
var playersByNormalizedName = {};

/**
 * Get conventional FA timestamp: shortly before the trade
 * We'll use the trade date minus 1 day at 12:00:33 ET
 */
function getFaTimestampBeforeTrade(tradeDate) {
	var d = new Date(tradeDate);
	d.setDate(d.getDate() - 1);
	// Set to 12:00:33 ET (approximate, ignoring DST for simplicity)
	d.setUTCHours(17, 0, 33, 0);
	return d;
}

/**
 * Build a map of owner name -> franchise ID for a given season
 */
function buildOwnerMap(regimes, franchises, season) {
	var ownerToFranchise = {};
	
	franchises.forEach(function(franchise) {
		for (var i = 0; i < regimes.length; i++) {
			var regime = regimes[i];
			for (var j = 0; j < regime.tenures.length; j++) {
				var tenure = regime.tenures[j];
				if (tenure.franchiseId.equals(franchise._id) &&
					tenure.startSeason <= season &&
					(tenure.endSeason === null || tenure.endSeason >= season)) {
					ownerToFranchise[regime.displayName.toLowerCase()] = franchise._id;
					
					var parts = regime.displayName.split('/');
					parts.forEach(function(part) {
						ownerToFranchise[part.toLowerCase().trim()] = franchise._id;
					});
				}
			}
		}
	});
	
	return ownerToFranchise;
}

/**
 * Check if a franchise has a prior acquisition for a player before a given date
 */
async function hasPriorAcquisition(franchiseId, playerId, beforeDate) {
	var txn = await Transaction.findOne({
		timestamp: { $lt: beforeDate },
		$or: [
			// Direct player transactions
			{ franchiseId: franchiseId, playerId: playerId },
			// FA pickups (in adds array)
			{ franchiseId: franchiseId, 'adds.playerId': playerId },
			// Trade receives
			{ 
				type: 'trade',
				'parties': {
					$elemMatch: {
						franchiseId: franchiseId,
						'receives.players.playerId': playerId
					}
				}
			},
			// Auction/draft
			{ franchiseId: franchiseId, type: { $in: ['auction-ufa', 'auction-rfa-matched', 'auction-rfa-unmatched', 'draft-select'] }, 'adds.playerId': playerId }
		]
	});
	
	return txn !== null;
}

async function run() {
	var args = process.argv.slice(2);
	var dryRun = args.includes('--dry-run');
	var yearArg = args.find(function(a) { return a.startsWith('--year='); });
	var targetYear = yearArg ? parseInt(yearArg.split('=')[1]) : null;
	
	if (dryRun) {
		console.log('=== DRY RUN MODE ===\n');
	}
	
	// Set up readline for interactive resolution
	if (!dryRun) {
		rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout
		});
	}
	
	await mongoose.connect(process.env.MONGODB_URI || 'mongodb://mongo:27017/pso');
	
	var regimes = await Regime.find({}).lean();
	var franchises = await Franchise.find({}).lean();
	var players = await Player.find({}).lean();
	
	// Build player lookup by normalized name (array per name for ambiguity handling)
	players.forEach(function(p) {
		var normalized = resolver.normalizePlayerName(p.name);
		if (!playersByNormalizedName[normalized]) {
			playersByNormalizedName[normalized] = [];
		}
		playersByNormalizedName[normalized].push(p);
	});
	
	// Load all trade facts from trades.json (the canonical source)
	if (!tradeFacts.checkAvailability()) {
		console.error('ERROR: trades.json not found. This file is the canonical source for trade data.');
		process.exit(1);
	}
	var allTrades = tradeFacts.loadAll();
	
	var startYear = targetYear || FIRST_YEAR;
	var endYear = targetYear || LAST_YEAR;
	
	var totalCreated = 0;
	var totalSkipped = 0;
	
	for (var year = startYear; year <= endYear; year++) {
		var ownerMap = buildOwnerMap(regimes, franchises, year);
		var yearTrades = allTrades.filter(function(t) {
			return t.date.getFullYear() === year;
		});
		
		console.log(year + ': ' + yearTrades.length + ' trades');
		var yearCreated = 0;
		
		for (var i = 0; i < yearTrades.length; i++) {
			var trade = yearTrades[i];
			
			// For each party that receives players, those players came from the other parties
			for (var j = 0; j < trade.parties.length; j++) {
				var receivingParty = trade.parties[j];
				if (!receivingParty.players || receivingParty.players.length === 0) continue;
				
				// Find the giving party (in a 2-party trade, it's the other one)
				// For multi-party trades, we can't determine who gave what without more info
				if (trade.parties.length !== 2) continue;
				
				var givingPartyIndex = j === 0 ? 1 : 0;
				var givingParty = trade.parties[givingPartyIndex];
				var givingFranchiseId = ownerMap[givingParty.owner.toLowerCase()];
				
				if (!givingFranchiseId) {
					console.log('  Could not find franchise for: ' + givingParty.owner);
					continue;
				}
				
				// Check each player the receiving party got (i.e., the giving party gave)
				for (var k = 0; k < receivingParty.players.length; k++) {
					var player = receivingParty.players[k];
					
					// Resolve the player with context-specific key
					var context = { 
						year: year, 
						type: 'fa-trade', 
						trade: trade.tradeId || trade.tradeNumber,
						franchise: givingParty.owner 
					};
					
					var result = await resolver.promptForPlayer({
						name: player.name,
						context: context,
						candidates: playersByNormalizedName[resolver.normalizePlayerName(player.name)] || [],
						Player: Player,
						rl: rl,
						playerCache: playersByNormalizedName
					});
					
					if (result.action === 'quit') {
						console.log('\nUser quit. Exiting...');
						if (rl) rl.close();
						await mongoose.disconnect();
						return;
					}
					
					var dbPlayer = result.player;
					if (!dbPlayer) {
						totalSkipped++;
						continue;
					}
					
					// Check if giving party has prior acquisition
					var hasPrior = await hasPriorAcquisition(givingFranchiseId, dbPlayer._id, trade.date);
					
					if (!hasPrior) {
						// Contract end year is the trade year (FA contracts expire end of season)
						var contractEndYear = year;
						
						if (dryRun) {
							console.log('  Would create FA: ' + player.name + ' -> ' + givingParty.owner + ' (before trade ' + trade.tradeId + ')');
							yearCreated++;
						} else {
							var timestamp = getFaTimestampBeforeTrade(trade.date);
							
							try {
								await Transaction.create({
									type: 'fa',
									franchiseId: givingFranchiseId,
									timestamp: timestamp,
									source: 'snapshot', // Using snapshot source since this is inferred
									adds: [{
										playerId: dbPlayer._id,
										salary: player.salary || null,
										startYear: null,
										endYear: contractEndYear
									}]
								});
								yearCreated++;
							} catch (err) {
								console.log('  Error creating FA for ' + player.name + ': ' + err.message);
							}
						}
					}
				}
			}
		}
		
		totalCreated += yearCreated;
		if (yearCreated > 0) {
			console.log('  Created: ' + yearCreated);
		}
	}
	
	console.log('\n=== Summary ===');
	console.log('Created: ' + totalCreated);
	console.log('Skipped: ' + totalSkipped);
	
	if (rl) rl.close();
	await mongoose.disconnect();
}

run().catch(function(err) {
	console.error(err);
	process.exit(1);
});
