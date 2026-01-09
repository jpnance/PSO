var dotenv = require('dotenv').config({ path: '/app/.env' });

var mongoose = require('mongoose');
mongoose.Promise = global.Promise;
mongoose.connect(process.env.MONGODB_URI);

var Budget = require('../models/Budget');
var Franchise = require('../models/Franchise');
var PSO = require('../pso.js');

async function generateCashJson() {
	// Load franchises to map _id -> owner name
	var franchises = await Franchise.find({});
	var franchiseNameById = {};
	franchises.forEach(function(f) {
		// Use sleeperRosterId to look up owner name from PSO.franchises
		franchiseNameById[f._id.toString()] = PSO.franchises[f.sleeperRosterId];
	});

	// Get all budgets, sorted by season then owner
	var budgets = await Budget.find({}).sort({ season: 1 });

	var cash = budgets.map(function(b) {
		return {
			season: b.season,
			owner: franchiseNameById[b.franchiseId.toString()],
			remaining: b.available
		};
	});

	console.log(JSON.stringify(cash));
	process.exit(0);
}

generateCashJson().catch(function(err) {
	console.error('Error:', err);
	process.exit(1);
});
