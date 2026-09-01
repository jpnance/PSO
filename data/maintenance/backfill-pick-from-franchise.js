#!/usr/bin/env node

/**
 * Backfill pick schema changes:
 * 1. Rename fromFranchiseId → originalFranchiseId (whose draft slot)
 * 2. Add fromFranchiseId (who gave it up in this trade)
 * 
 * Usage:
 *   node data/maintenance/backfill-pick-from-franchise.js --dry-run
 *   node data/maintenance/backfill-pick-from-franchise.js
 */

require('dotenv').config({ path: __dirname + '/../../.env' });
var mongoose = require('mongoose');

var Transaction = require('../../models/Transaction');
var Pick = require('../../models/Pick');
var Franchise = require('../../models/Franchise');

var DRY_RUN = process.argv.includes('--dry-run');

async function findPickOwnerBeforeTrade(pickSeason, pickRound, originalFranchiseId, tradeTimestamp) {
	// Find the most recent transaction that moved this pick before this trade
	var priorTx = await Transaction.findOne({
		timestamp: { $lt: tradeTimestamp },
		type: 'trade',
		'parties.receives.picks': {
			$elemMatch: {
				season: pickSeason,
				round: pickRound,
				$or: [
					{ originalFranchiseId: originalFranchiseId },
					{ fromFranchiseId: originalFranchiseId }  // fallback for old data
				]
			}
		}
	}).sort({ timestamp: -1 }).lean();

	if (priorTx) {
		// Find which party received this pick
		for (var party of priorTx.parties) {
			var matchingPick = (party.receives.picks || []).find(function(p) {
				var origId = p.originalFranchiseId || p.fromFranchiseId;
				return p.season === pickSeason && 
					   p.round === pickRound && 
					   origId && origId.toString() === originalFranchiseId.toString();
			});
			if (matchingPick) {
				return party.franchiseId;
			}
		}
	}

	// No prior trade - pick was still with original owner
	return originalFranchiseId;
}

async function main() {
	await mongoose.connect(process.env.MONGODB_URI);
	console.log('Connected to MongoDB\n');

	if (DRY_RUN) {
		console.log('DRY RUN - no changes will be made\n');
	}

	var franchises = await Franchise.find({}).lean();
	var franchiseById = {};
	franchises.forEach(function(f) {
		franchiseById[f._id.toString()] = f;
	});

	var trades = await Transaction.find({ type: 'trade' }).sort({ timestamp: 1 });
	console.log('Found ' + trades.length + ' trades\n');

	var stats = { renamed: 0, backfilled: 0, alreadyDone: 0, noPicks: 0 };

	for (var trade of trades) {
		var modified = false;

		for (var i = 0; i < trade.parties.length; i++) {
			var party = trade.parties[i];
			var picks = (party.receives && party.receives.picks) || [];

			for (var j = 0; j < picks.length; j++) {
				var pick = picks[j];

				// Step 1: Rename fromFranchiseId to originalFranchiseId if needed
				if (pick.fromFranchiseId && !pick.originalFranchiseId) {
					if (!DRY_RUN) {
						trade.parties[i].receives.picks[j].originalFranchiseId = pick.fromFranchiseId;
					}
					stats.renamed++;
					modified = true;
				}

				var originalFranchiseId = pick.originalFranchiseId || pick.fromFranchiseId;

				// Step 2: Backfill fromFranchiseId (who gave it up) if not set correctly
				// For 2-party trades, it's the other party
				// For multi-party, look up from history
				if (trade.parties.length === 2) {
					var otherPartyIndex = i === 0 ? 1 : 0;
					var expectedFrom = trade.parties[otherPartyIndex].franchiseId;
					
					// Check if fromFranchiseId needs to be set (missing or equals original draft slot)
					var needsBackfill = !pick.fromFranchiseId || 
						pick.fromFranchiseId.toString() === originalFranchiseId.toString();
					
					if (needsBackfill) {
						// fromFranchiseId is missing or same as originalFranchiseId (old data)
						var fromFranchise = franchiseById[expectedFrom.toString()];
						var toFranchise = franchiseById[party.franchiseId.toString()];
						console.log('Trade #' + trade.tradeId + ': ' + pick.season + ' R' + pick.round + 
							' pick from roster ' + (fromFranchise ? fromFranchise.rosterId : '?') +
							' to roster ' + (toFranchise ? toFranchise.rosterId : '?'));
						
						if (!DRY_RUN) {
							trade.parties[i].receives.picks[j].fromFranchiseId = expectedFrom;
						}
						stats.backfilled++;
						modified = true;
					} else {
						stats.alreadyDone++;
					}
				} else {
					// Multi-party trade - check if already done
					if (pick.fromFranchiseId && pick.originalFranchiseId &&
						pick.fromFranchiseId.toString() !== pick.originalFranchiseId.toString()) {
						// Already has distinct fromFranchiseId
						stats.alreadyDone++;
					} else {
						// Look up from history
						var fromFranchiseId = await findPickOwnerBeforeTrade(
							pick.season, pick.round, originalFranchiseId, trade.timestamp
						);
						
						if (fromFranchiseId) {
							var fromFranchise = franchiseById[fromFranchiseId.toString()];
							var toFranchise = franchiseById[party.franchiseId.toString()];
							console.log('Trade #' + trade.tradeId + ' (multi): ' + pick.season + ' R' + pick.round + 
								' pick from roster ' + (fromFranchise ? fromFranchise.rosterId : '?') +
								' to roster ' + (toFranchise ? toFranchise.rosterId : '?'));
							
							if (!DRY_RUN) {
								trade.parties[i].receives.picks[j].fromFranchiseId = fromFranchiseId;
							}
							stats.backfilled++;
							modified = true;
						}
					}
				}
			}
		}

		if (modified && !DRY_RUN) {
			await trade.save();
		}
	}

	console.log('\n=== Summary ===');
	console.log('Renamed (fromFranchiseId → originalFranchiseId): ' + stats.renamed);
	console.log('Backfilled fromFranchiseId: ' + stats.backfilled);
	console.log('Already done: ' + stats.alreadyDone);

	await mongoose.disconnect();
	console.log('\nDone.');
}

main().catch(function(err) {
	console.error(err);
	process.exit(1);
});
