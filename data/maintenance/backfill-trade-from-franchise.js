#!/usr/bin/env node

/**
 * Backfill fromFranchiseId for traded players.
 * 
 * For each trade, determines which franchise gave up each player
 * by looking at the transaction history.
 * 
 * Usage:
 *   node data/maintenance/backfill-trade-from-franchise.js --dry-run
 *   node data/maintenance/backfill-trade-from-franchise.js
 */

var dotenv = require('dotenv').config({ path: __dirname + '/../../.env' });
var mongoose = require('mongoose');

var Transaction = require('../../models/Transaction');
var Franchise = require('../../models/Franchise');
var Player = require('../../models/Player');
var PSO = require('../../config/pso');

var DRY_RUN = process.argv.includes('--dry-run');

async function findPreTradeOwner(playerId, tradeTimestamp) {
	var priorTx = await Transaction.findOne({
		timestamp: { $lt: tradeTimestamp },
		$or: [
			{ 'parties.receives.players.playerId': playerId },
			{ 'adds.playerId': playerId },
			{ playerId: playerId, type: { $in: ['draft-select', 'expansion-draft-select', 'contract', 'auction-ufa', 'auction-rfa-matched', 'auction-rfa-unmatched'] } }
		]
	}).sort({ timestamp: -1 }).lean();

	if (!priorTx) return null;

	// Direct franchiseId (draft, auction, contract)
	if (priorTx.franchiseId) {
		return priorTx.franchiseId;
	}

	// Trade parties
	if (priorTx.parties) {
		for (var j = 0; j < priorTx.parties.length; j++) {
			var party = priorTx.parties[j];
			var receivedPlayers = (party.receives && party.receives.players) || [];
			var hasPlayer = receivedPlayers.some(function(rp) {
				return rp.playerId.toString() === playerId.toString();
			});
			if (hasPlayer) {
				return party.franchiseId;
			}
		}
	}

	// FA adds
	if (priorTx.adds) {
		var addEntry = priorTx.adds.find(function(a) {
			return a.playerId.toString() === playerId.toString();
		});
		if (addEntry && priorTx.franchiseId) {
			return priorTx.franchiseId;
		}
	}

	return null;
}

async function main() {
	await mongoose.connect(process.env.MONGODB_URI);
	console.log('Connected to MongoDB\n');

	if (DRY_RUN) {
		console.log('DRY RUN - no changes will be made\n');
	}

	// Get all trades
	var trades = await Transaction.find({ type: 'trade' }).sort({ timestamp: 1 });
	console.log('Found ' + trades.length + ' trades\n');

	// Build franchise lookup
	var franchises = await Franchise.find({}).lean();
	var franchiseById = {};
	franchises.forEach(function(f) {
		franchiseById[f._id.toString()] = f;
	});

	// Build player lookup
	var players = await Player.find({}).lean();
	var playerById = {};
	players.forEach(function(p) {
		playerById[p._id.toString()] = p;
	});

	var stats = { updated: 0, skipped: 0, alreadySet: 0, notFound: 0, inconsistent: 0 };
	var inconsistencies = [];

	for (var i = 0; i < trades.length; i++) {
		var trade = trades[i];
		var modified = false;
		var isTwoParty = trade.parties.length === 2;

		for (var j = 0; j < trade.parties.length; j++) {
			var party = trade.parties[j];
			var players = (party.receives && party.receives.players) || [];

			for (var k = 0; k < players.length; k++) {
				var player = players[k];

				if (player.fromFranchiseId) {
					stats.alreadySet++;
					continue;
				}

				var fromFranchiseId = await findPreTradeOwner(player.playerId, trade.timestamp);

				// Validate that fromFranchiseId is one of the other parties in the trade
				if (fromFranchiseId) {
					var otherPartyIds = trade.parties
						.filter(function(p) { return p.franchiseId.toString() !== party.franchiseId.toString(); })
						.map(function(p) { return p.franchiseId.toString(); });
					
					var isValidSource = otherPartyIds.includes(fromFranchiseId.toString());
					
					if (!isValidSource) {
						var fromFranchise = franchiseById[fromFranchiseId.toString()];
						var toFranchise = franchiseById[party.franchiseId.toString()];
						var playerInfo = playerById[player.playerId.toString()];
						var playerName = playerInfo ? playerInfo.name : player.playerId;
						var otherRosters = otherPartyIds.map(function(id) {
							var f = franchiseById[id];
							return f ? f.rosterId : '?';
						}).join(', ');
						
						var msg = 'Trade #' + trade.tradeId + ': INCONSISTENT - ' + playerName +
							' history says roster ' + (fromFranchise ? fromFranchise.rosterId : '?') +
							' but trade parties are rosters ' + otherRosters +
							' (receiving party: roster ' + (toFranchise ? toFranchise.rosterId : '?') + ')';
						console.log('\x1b[31m' + msg + '\x1b[0m');
						inconsistencies.push(msg);
						stats.inconsistent++;
						
						// For 2-party trades, we can use the deterministic answer
						if (isTwoParty) {
							var otherPartyIndex = j === 0 ? 1 : 0;
							fromFranchiseId = trade.parties[otherPartyIndex].franchiseId;
						} else {
							// For multi-way trades, we can't fix it - skip this player
							console.log('  -> Cannot determine correct source for multi-way trade, skipping');
							stats.notFound++;
							continue;
						}
					}
				}

				if (fromFranchiseId) {
					var fromFranchise = franchiseById[fromFranchiseId.toString()];
					var toFranchise = franchiseById[party.franchiseId.toString()];
					var playerInfo = playerById[player.playerId.toString()];
					var playerName = playerInfo ? playerInfo.name : player.playerId;
					
					console.log('Trade #' + trade.tradeId + ': ' + playerName + 
						' from roster ' + (fromFranchise ? fromFranchise.rosterId : '?') +
						' to roster ' + (toFranchise ? toFranchise.rosterId : '?'));

					if (!DRY_RUN) {
						trade.parties[j].receives.players[k].fromFranchiseId = fromFranchiseId;
						modified = true;
					}
					stats.updated++;
				} else {
					var playerInfo = playerById[player.playerId.toString()];
					var playerName = playerInfo ? playerInfo.name : player.playerId;
					console.log('Trade #' + trade.tradeId + ': Could not find pre-trade owner for ' + playerName);
					stats.notFound++;
				}
			}
		}

		if (modified && !DRY_RUN) {
			await trade.save();
		}
	}

	console.log('\n=== Summary ===');
	console.log('Updated: ' + stats.updated);
	console.log('Already set: ' + stats.alreadySet);
	console.log('Not found: ' + stats.notFound);
	console.log('Inconsistent: ' + stats.inconsistent);

	if (inconsistencies.length > 0) {
		console.log('\n=== Inconsistencies (history gaps) ===');
		inconsistencies.forEach(function(msg) {
			console.log('  ' + msg);
		});
		console.log('\nThese indicate gaps in transaction history. The trade structure was used as the source of truth.');
	}

	await mongoose.disconnect();
	
	if (stats.inconsistent > 0) {
		process.exit(1);
	}
}

main().catch(function(err) {
	console.error(err);
	process.exit(1);
});
