/**
 * Analyze transaction chain starts.
 * 
 * Find players whose first transaction isn't a valid acquisition
 * (draft, auction, FA pickup, expansion draft).
 */

require('dotenv').config();
var mongoose = require('mongoose');
var Transaction = require('../../models/Transaction');
var Player = require('../../models/Player');

var VALID_STARTS = [
	'draft-select',
	'auction-ufa',
	'auction-rfa-matched',
	'auction-rfa-unmatched',
	'fa',
	'expansion-draft-select'
];

// Lifecycle markers that don't count as "starts"
var LIFECYCLE_MARKERS = [
	'rfa-rights-conversion',
	'contract-expiry',
	'contract',
	'rfa-rights-lapsed'
];

/**
 * Get all transactions involving a player (checks playerId, adds, and drops).
 */
async function getPlayerTransactions(playerId, excludeTypes) {
	var query = {
		$or: [
			{ playerId: playerId },
			{ 'adds.playerId': playerId },
			{ 'drops.playerId': playerId }
		]
	};
	if (excludeTypes && excludeTypes.length > 0) {
		query.type = { $nin: excludeTypes };
	}
	return Transaction.find(query).sort({ timestamp: 1 }).lean();
}

async function run() {
	await mongoose.connect(process.env.MONGODB_URI);
	
	// Get all unique playerIds with transactions (from playerId field and adds/drops arrays)
	var fromPlayerId = await Transaction.distinct('playerId', { playerId: { $ne: null } });
	var fromAdds = await Transaction.distinct('adds.playerId');
	var fromDrops = await Transaction.distinct('drops.playerId');
	
	// Combine and dedupe
	var allIds = new Set();
	fromPlayerId.forEach(function(id) { if (id) allIds.add(id.toString()); });
	fromAdds.forEach(function(id) { if (id) allIds.add(id.toString()); });
	fromDrops.forEach(function(id) { if (id) allIds.add(id.toString()); });
	
	var playerIds = Array.from(allIds);
	console.log('Players with transactions:', playerIds.length);
	
	// Build player name lookup
	var players = await Player.find({}).lean();
	var playerNames = {};
	players.forEach(function(p) { playerNames[p._id.toString()] = p.name; });
	
	var badStarts = [];
	var goodStarts = 0;
	var onlyLifecycle = [];
	
	for (var i = 0; i < playerIds.length; i++) {
		var playerId = playerIds[i];
		var playerName = playerNames[playerId] || 'Unknown';
		
		// Get all transactions for this player (excluding lifecycle markers)
		var txns = await getPlayerTransactions(playerId, LIFECYCLE_MARKERS);
		
		if (txns.length === 0) {
			// Only has lifecycle markers
			var allTxns = await getPlayerTransactions(playerId, []);
			if (allTxns.length > 0) {
				var any = allTxns[0];
				onlyLifecycle.push({
					name: playerName,
					type: any.type,
					date: any.timestamp.toISOString().split('T')[0]
				});
			}
			continue;
		}
		
		var first = txns[0];
		
		if (VALID_STARTS.includes(first.type)) {
			goodStarts++;
		} else {
			badStarts.push({
				name: playerName,
				type: first.type,
				date: first.timestamp.toISOString().split('T')[0]
			});
		}
	}
	
	console.log('Valid starts:', goodStarts);
	console.log('Invalid starts:', badStarts.length);
	console.log('Only lifecycle markers:', onlyLifecycle.length);
	console.log('');
	console.log('=== Invalid Start Types ===');
	
	var byType = {};
	badStarts.forEach(function(b) {
		byType[b.type] = (byType[b.type] || 0) + 1;
	});
	
	Object.entries(byType).sort(function(a, b) { return b[1] - a[1]; }).forEach(function(entry) {
		console.log('  ' + entry[1] + 'x ' + entry[0]);
	});
	
	console.log('');
	console.log('=== Invalid Start Examples ===');
	badStarts.slice(0, 25).forEach(function(b) {
		console.log('  ' + b.name + ': ' + b.type + ' (' + b.date + ')');
	});
	
	if (onlyLifecycle.length > 0) {
		console.log('');
		console.log('=== Only Lifecycle Markers (all ' + onlyLifecycle.length + ') ===');
		onlyLifecycle.forEach(function(b) {
			console.log('  ' + b.name + ': ' + b.type + ' (' + b.date + ')');
		});
	}
	
	process.exit(0);
}

run().catch(function(err) {
	console.error(err);
	process.exit(1);
});
