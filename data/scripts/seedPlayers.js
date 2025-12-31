var dotenv = require('dotenv').config({ path: __dirname + '/../../.env' });
var mongoose = require('mongoose');

var Player = require('../../models/Player');
var sleeperData = require('../../public/data/sleeper-data.json');

mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });

var relevantPositions = ['QB', 'RB', 'WR', 'TE', 'DL', 'LB', 'DB', 'K'];

function hasRelevantPosition(player) {
	if (!player.fantasy_positions || player.fantasy_positions.length === 0) {
		return false;
	}
	return player.fantasy_positions.some(function(pos) {
		return relevantPositions.includes(pos);
	});
}

async function seed() {
	console.log('Seeding players from Sleeper data...\n');

	var clearExisting = process.argv.includes('--clear');
	if (clearExisting) {
		console.log('Clearing existing players...');
		await Player.deleteMany({});
	}

	var players = Object.values(sleeperData);
	console.log('Total players in Sleeper data:', players.length);

	var created = 0;
	var skipped = 0;
	var batch = [];
	var batchSize = 500;

	for (var i = 0; i < players.length; i++) {
		var p = players[i];

		// Skip players without a name or without relevant positions
		if (!p.full_name || !hasRelevantPosition(p)) {
			skipped++;
		}
		else {
			batch.push({
				sleeperId: p.player_id,
				name: p.full_name,
				positions: p.fantasy_positions || []
			});
		}

		// Insert batch when full OR at the end of the loop
		if (batch.length >= batchSize || (i === players.length - 1 && batch.length > 0)) {
			try {
				await Player.insertMany(batch, { ordered: false });
				created += batch.length;
			}
			catch (err) {
				// Handle duplicate key errors (if re-running without --clear)
				if (err.code === 11000) {
					// Some were duplicates, count the ones that succeeded
					created += err.result?.nInserted || 0;
					skipped += batch.length - (err.result?.nInserted || 0);
				}
				else {
					throw err;
				}
			}
			batch = [];

			if ((i + 1) % 2000 === 0 || i === players.length - 1) {
				console.log('  Processed', i + 1, 'players...');
			}
		}
	}

	console.log('\nDone!');
	console.log('  Created:', created);
	console.log('  Skipped:', skipped);

	process.exit(0);
}

seed().catch(function(err) {
	console.error('Error:', err);
	process.exit(1);
});

