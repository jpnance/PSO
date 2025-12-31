var dotenv = require('dotenv').config({ path: __dirname + '/../../.env' });
var mongoose = require('mongoose');

var Pick = require('../../models/Pick');
var Player = require('../../models/Player');
var Transaction = require('../../models/Transaction');
var sleeperData = require('../../public/data/sleeper-data.json');
var draftSelections = require('./draft-selections.json');

mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });

// Get or create player from sleeperId or as historical
async function getOrCreatePlayer(selection) {
	var sleeperId = selection.sleeperId;
	var normalizedName = selection.playerNameNormalized;
	
	// No sleeperId means skip
	if (!sleeperId) {
		return null;
	}
	
	// "historical" means create as historical player
	if (sleeperId === 'historical') {
		var existing = await Player.findOne({ name: normalizedName, sleeperId: null });
		if (existing) {
			return existing._id;
		}
		var player = await Player.create({
			sleeperId: null,
			name: normalizedName,
			positions: []
		});
		console.log('  Created historical player:', normalizedName);
		return player._id;
	}
	
	// Otherwise, it's a Sleeper ID
	var existing = await Player.findOne({ sleeperId: sleeperId });
	if (existing) {
		return existing._id;
	}
	
	// Create from Sleeper data
	var sleeperPlayer = sleeperData[sleeperId];
	if (!sleeperPlayer) {
		console.log('  WARNING: Sleeper ID not found:', sleeperId, 'for', normalizedName);
		return null;
	}
	
	var player = await Player.create({
		sleeperId: sleeperId,
		name: sleeperPlayer.full_name,
		positions: sleeperPlayer.fantasy_positions || []
	});
	console.log('  Created player from Sleeper:', sleeperPlayer.full_name);
	return player._id;
}

async function seed() {
	console.log('Seeding draft selections from draft-selections.json...\n');
	console.log('Total selections in file:', draftSelections.length);

	var clearExisting = process.argv.includes('--clear');
	if (clearExisting) {
		console.log('Clearing existing draft-select transactions...');
		await Transaction.deleteMany({ type: 'draft-select' });
		await Pick.updateMany({ status: 'used' }, { $unset: { transactionId: 1 } });
	}

	var created = 0;
	var skipped = 0;
	var errors = [];

	for (var i = 0; i < draftSelections.length; i++) {
		var sel = draftSelections[i];
		
		// Skip if no sleeperId
		if (!sel.sleeperId) {
			errors.push(sel.season + ' R' + sel.round + ' #' + sel.pickNumber + ': No sleeperId specified');
			skipped++;
			continue;
		}
		
		// Find the Pick document
		var pick = await Pick.findOne({
			season: sel.season,
			pickNumber: sel.pickNumber
		});
		
		if (!pick) {
			errors.push(sel.season + ' R' + sel.round + ' #' + sel.pickNumber + ': Pick not found in DB');
			skipped++;
			continue;
		}
		
		// Get or create player
		var playerId = await getOrCreatePlayer(sel);
		if (!playerId) {
			errors.push(sel.season + ' R' + sel.round + ' #' + sel.pickNumber + ': Could not resolve player');
			skipped++;
			continue;
		}
		
		// Create transaction
		var timestamp = new Date(sel.season + '-08-15T12:00:00Z');
		
		try {
			var transaction = await Transaction.create({
				type: 'draft-select',
				timestamp: timestamp,
				source: 'snapshot',
				franchiseId: pick.currentFranchiseId,
				playerId: playerId,
				pickId: pick._id
			});
			
			// Update pick with transaction reference
			pick.transactionId = transaction._id;
			await pick.save();
			
			created++;
		}
		catch (err) {
			errors.push(sel.season + ' R' + sel.round + ' #' + sel.pickNumber + ': ' + err.message);
			skipped++;
		}
	}

	console.log('\n\nDone!');
	console.log('  Created:', created, 'draft-select transactions');
	console.log('  Skipped:', skipped);

	if (errors.length > 0) {
		console.log('\nErrors:');
		errors.forEach(function(e) {
			console.log('  - ' + e);
		});
	}

	process.exit(0);
}

seed().catch(function(err) {
	console.error('Error:', err);
	process.exit(1);
});
