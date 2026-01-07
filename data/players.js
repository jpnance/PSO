var dotenv = require('dotenv').config({ path: '/app/.env' });

var mongoose = require('mongoose');
mongoose.Promise = global.Promise;
mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });

var Player = require('../models/Player');
var Contract = require('../models/Contract');
var Franchise = require('../models/Franchise');
var PSO = require('../pso.js');

async function generatePlayersJson() {
	// Load franchises to map _id -> owner name
	var franchises = await Franchise.find({});
	var franchiseNameById = {};
	franchises.forEach(function(f) {
		franchiseNameById[f._id.toString()] = PSO.franchises[f.sleeperRosterId];
	});

	// Load all contracts and index by playerId
	var contracts = await Contract.find({});
	var contractByPlayerId = {};
	contracts.forEach(function(c) {
		contractByPlayerId[c.playerId.toString()] = c;
	});

	// Query fantasy-relevant players:
	// active == true && (team != null || (searchRank != null && searchRank < 9999999))
	var players = await Player.find({
		sleeperId: { $ne: null },
		active: true,
		$or: [
			{ team: { $ne: null } },
			{ searchRank: { $ne: null, $lt: 9999999 } }
		]
	}).sort({ name: 1 });

	var result = players.map(function(p) {
		var contract = contractByPlayerId[p._id.toString()];

		var player = {
			name: p.name,
			positions: p.positions,
			id: p.sleeperId
		};

		// Add roster info if player has a contract
		if (contract) {
			player.owner = franchiseNameById[contract.franchiseId.toString()];

			if (contract.salary != null) {
				// Active contract
				player.salary = contract.salary;
				player.start = contract.startYear;
				player.end = contract.endYear;
			}
			else {
				// RFA rights only (no active contract)
				player.rfaRights = true;
			}
		}

		return player;
	});

	console.log(JSON.stringify(result));
	process.exit(0);
}

generatePlayersJson().catch(function(err) {
	console.error('Error:', err);
	process.exit(1);
});
