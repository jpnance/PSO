var dotenv = require('dotenv').config({ path: '/app/.env' });

var mongoose = require('mongoose');
mongoose.Promise = global.Promise;
mongoose.connect(process.env.MONGODB_URI);

var Pick = require('../models/Pick');
var Franchise = require('../models/Franchise');
var PSO = require('../pso.js');

async function generatePicksJson() {
	// Load franchises to map _id -> owner name
	var franchises = await Franchise.find({});
	var franchiseNameById = {};
	franchises.forEach(function(f) {
		franchiseNameById[f._id.toString()] = PSO.franchises[f.sleeperRosterId];
	});

	// Get available picks for current and future seasons
	var currentYear = new Date().getFullYear();
	var picks = await Pick.find({
		status: 'available',
		season: { $gte: currentYear }
	}).sort({ season: 1, round: 1, pickNumber: 1 });

	var result = picks.map(function(p) {
		var currentOwner = franchiseNameById[p.currentFranchiseId.toString()];
		var originalOwner = franchiseNameById[p.originalFranchiseId.toString()];

		return {
			season: p.season,
			number: p.pickNumber || null,
			round: p.round,
			owner: currentOwner,
			origin: originalOwner !== currentOwner ? originalOwner : undefined,
			player: null
		};
	});

	console.log(JSON.stringify(result));
	process.exit(0);
}

generatePicksJson().catch(function(err) {
	console.error('Error:', err);
	process.exit(1);
});
