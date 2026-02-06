/**
 * Seed RFA rights conveyance for end of 2008 season.
 * 
 * Before 2019, ALL players rostered at end of season convey RFA rights
 * to their controlling franchise (regardless of contract length).
 * 
 * Usage:
 *   docker compose run --rm web node data/seed/rfa-2008.js
 *   docker compose run --rm web node data/seed/rfa-2008.js --dry-run
 */

require('dotenv').config();

var mongoose = require('mongoose');

var Franchise = require('../../models/Franchise');
var Player = require('../../models/Player');
var Regime = require('../../models/Regime');
var Transaction = require('../../models/Transaction');

mongoose.connect(process.env.MONGODB_URI);

// RFA rights convey on January 15 of the following year
var RFA_TIMESTAMP = new Date(Date.UTC(2009, 0, 15, 17, 0, 33)); // Jan 15, 2009 12:00:33 ET

var dryRun = process.argv.includes('--dry-run');

/**
 * Get a player's current franchise holder based on their transaction history.
 * Returns the franchiseId of whoever holds them at the given point in time.
 */
async function getPlayerFranchise(playerId, asOfDate) {
	// Find the most recent transaction that put this player on a roster
	
	// Check direct player transactions (auction, contract, draft, rfa-conversion)
	var directTxn = await Transaction.findOne({
		playerId: playerId,
		type: { $in: ['auction-ufa', 'contract', 'rfa-rights-conversion', 'draft-select'] },
		timestamp: { $lt: asOfDate }
	}).sort({ timestamp: -1 });
	
	// Check FA pickups
	var faTxn = await Transaction.findOne({
		type: 'fa',
		'adds.playerId': playerId,
		timestamp: { $lt: asOfDate }
	}).sort({ timestamp: -1 });
	
	// Check trades (player received)
	var tradeTxn = await Transaction.findOne({
		type: 'trade',
		'parties.receives.players.playerId': playerId,
		timestamp: { $lt: asOfDate }
	}).sort({ timestamp: -1 });
	
	// Find the most recent of these
	var candidates = [];
	
	if (directTxn) {
		candidates.push({ timestamp: directTxn.timestamp, franchiseId: directTxn.franchiseId, type: directTxn.type });
	}
	
	if (faTxn) {
		candidates.push({ timestamp: faTxn.timestamp, franchiseId: faTxn.franchiseId, type: 'fa' });
	}
	
	if (tradeTxn) {
		// Find which party received this player
		for (var party of tradeTxn.parties) {
			var received = party.receives.players.find(function(p) {
				return p.playerId.toString() === playerId.toString();
			});
			if (received) {
				candidates.push({ timestamp: tradeTxn.timestamp, franchiseId: party.franchiseId, type: 'trade' });
				break;
			}
		}
	}
	
	if (candidates.length === 0) {
		return null;
	}
	
	// Sort by timestamp descending and return the most recent
	candidates.sort(function(a, b) {
		return b.timestamp - a.timestamp;
	});
	
	return candidates[0];
}

/**
 * Check if a player is still rostered (not cut) as of a given date.
 * Returns true if the most recent roster-affecting transaction was an acquisition.
 */
async function isPlayerRostered(playerId, asOfDate) {
	// Find the most recent FA transaction that dropped this player
	var lastCut = await Transaction.findOne({
		type: 'fa',
		'drops.playerId': playerId,
		timestamp: { $lt: asOfDate }
	}).sort({ timestamp: -1 });
	
	if (!lastCut) {
		// Never cut, still rostered
		return true;
	}
	
	// Check if there was a subsequent acquisition after the cut
	var holder = await getPlayerFranchise(playerId, asOfDate);
	
	if (holder && holder.timestamp > lastCut.timestamp) {
		// Acquired after being cut
		return true;
	}
	
	return false;
}

async function run() {
	console.log('=== 2008 RFA Rights Seeder ===');
	if (dryRun) console.log('[DRY RUN]');
	console.log('');
	console.log('Timestamp:', RFA_TIMESTAMP.toISOString());
	console.log('');
	
	// Check for existing RFA transactions
	var existingCount = await Transaction.countDocuments({
		type: 'rfa-rights-conversion',
		timestamp: RFA_TIMESTAMP
	});
	
	if (existingCount > 0 && !dryRun) {
		console.log('Found', existingCount, 'existing RFA transactions. Clearing...');
		await Transaction.deleteMany({
			type: 'rfa-rights-conversion',
			timestamp: RFA_TIMESTAMP
		});
	}
	
	// Find all players with 2008 transactions
	var playerIds = await Transaction.distinct('playerId', {
		timestamp: { $gte: new Date('2008-01-01'), $lt: new Date('2009-01-01') },
		playerId: { $exists: true, $ne: null }
	});
	
	// Also check adds arrays for FA transactions
	var faTxns = await Transaction.find({
		type: 'fa',
		timestamp: { $gte: new Date('2008-01-01'), $lt: new Date('2009-01-01') }
	});
	
	faTxns.forEach(function(txn) {
		(txn.adds || []).forEach(function(add) {
			if (add.playerId && !playerIds.some(function(id) { return id.toString() === add.playerId.toString(); })) {
				playerIds.push(add.playerId);
			}
		});
	});
	
	// Also check trade parties
	var tradeTxns = await Transaction.find({
		type: 'trade',
		timestamp: { $gte: new Date('2008-01-01'), $lt: new Date('2009-01-01') }
	});
	
	tradeTxns.forEach(function(txn) {
		(txn.parties || []).forEach(function(party) {
			(party.receives.players || []).forEach(function(p) {
				if (p.playerId && !playerIds.some(function(id) { return id.toString() === p.playerId.toString(); })) {
					playerIds.push(p.playerId);
				}
			});
		});
	});
	
	console.log('Found', playerIds.length, 'players with 2008 transactions');
	console.log('');
	
	// Check each player for RFA eligibility
	// Before 2019, ALL rostered players convey RFA rights
	var rfaPlayers = [];
	
	for (var playerId of playerIds) {
		// Check if player is still rostered (not cut)
		var rostered = await isPlayerRostered(playerId, RFA_TIMESTAMP);
		
		if (!rostered) continue;
		
		var holder = await getPlayerFranchise(playerId, RFA_TIMESTAMP);
		
		if (holder) {
			var player = await Player.findById(playerId);
			rfaPlayers.push({
				playerId: playerId,
				playerName: player ? player.name : 'Unknown',
				franchiseId: holder.franchiseId
			});
		}
	}
	
	console.log('Found', rfaPlayers.length, 'players with RFA rights to convey');
	console.log('');
	
	// Group by franchise for display
	var byFranchise = {};
	var regimes = await Regime.find({});
	var franchiseNames = {};
	
	regimes.forEach(function(r) {
		r.tenures.forEach(function(t) {
			if (t.startSeason <= 2008 && (!t.endSeason || t.endSeason >= 2008)) {
				franchiseNames[t.franchiseId.toString()] = r.displayName;
			}
		});
	});
	
	rfaPlayers.forEach(function(rfa) {
		var fid = rfa.franchiseId.toString();
		if (!byFranchise[fid]) {
			byFranchise[fid] = {
				name: franchiseNames[fid] || 'Unknown',
				players: []
			};
		}
		byFranchise[fid].players.push(rfa);
	});
	
	// Display summary
	Object.keys(byFranchise).sort(function(a, b) {
		return byFranchise[a].name.localeCompare(byFranchise[b].name);
	}).forEach(function(fid) {
		var franchise = byFranchise[fid];
		console.log(franchise.name + ': ' + franchise.players.length + ' RFA rights');
	});
	console.log('');
	
	// Create transactions
	if (dryRun) {
		console.log('[DRY RUN] Would create', rfaPlayers.length, 'transactions');
	} else {
		var created = 0;
		
		for (var rfa of rfaPlayers) {
			await Transaction.create({
				type: 'rfa-rights-conversion',
				timestamp: RFA_TIMESTAMP,
				playerId: rfa.playerId,
				franchiseId: rfa.franchiseId,
				source: 'snapshot'
			});
			created++;
		}
		
		console.log('Created', created, 'RFA rights transactions');
	}
	
	process.exit(0);
}

run().catch(function(err) {
	console.error('Error:', err);
	process.exit(1);
});
