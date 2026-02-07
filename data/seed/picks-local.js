/**
 * Seed draft picks from local drafts.json
 * 
 * Uses the enriched drafts.json with origin/originFranchiseId fields
 * instead of fetching from Google Sheets.
 * 
 * Usage:
 *   node data/seed/picks-local.js [--clear]
 */

require('dotenv').config({ path: __dirname + '/../../.env' });

var mongoose = require('mongoose');
var fs = require('fs');
var path = require('path');

var Pick = require('../../models/Pick');
var Franchise = require('../../models/Franchise');

mongoose.connect(process.env.MONGODB_URI);

async function seed() {
	console.log('Seeding picks from local drafts.json...\n');

	var clearExisting = process.argv.includes('--clear');
	if (clearExisting) {
		console.log('Clearing existing picks...');
		var result = await Pick.deleteMany({});
		console.log('  Deleted ' + result.deletedCount + ' picks\n');
	}

	// Load franchises (to map franchiseId number -> ObjectId)
	var franchises = await Franchise.find({});
	var franchiseByRosterId = {};
	franchises.forEach(function(f) {
		franchiseByRosterId[f.rosterId] = f._id;
	});
	console.log('Loaded ' + franchises.length + ' franchises');

	// Load drafts.json
	var draftsPath = path.join(__dirname, '../drafts/drafts.json');
	var drafts = JSON.parse(fs.readFileSync(draftsPath, 'utf8'));
	console.log('Loaded ' + drafts.length + ' draft picks\n');

	var created = 0;
	var skipped = 0;
	var errors = [];

	for (var i = 0; i < drafts.length; i++) {
		var pick = drafts[i];

		// Validate required fields
		if (!pick.ownerFranchiseId) {
			errors.push(pick.season + ' R' + pick.round + ' #' + pick.pickNumber + ': Missing ownerFranchiseId');
			skipped++;
			continue;
		}
		if (!pick.originFranchiseId) {
			errors.push(pick.season + ' R' + pick.round + ' #' + pick.pickNumber + ': Missing originFranchiseId');
			skipped++;
			continue;
		}

		var currentFranchiseId = franchiseByRosterId[pick.ownerFranchiseId];
		var originalFranchiseId = franchiseByRosterId[pick.originFranchiseId];

		if (!currentFranchiseId) {
			errors.push(pick.season + ' R' + pick.round + ' #' + pick.pickNumber + ': Unknown franchise ' + pick.ownerFranchiseId);
			skipped++;
			continue;
		}
		if (!originalFranchiseId) {
			errors.push(pick.season + ' R' + pick.round + ' #' + pick.pickNumber + ': Unknown franchise ' + pick.originFranchiseId);
			skipped++;
			continue;
		}

		try {
			await Pick.create({
				pickNumber: pick.pickNumber,
				round: pick.round,
				season: pick.season,
				originalFranchiseId: originalFranchiseId,
				currentFranchiseId: currentFranchiseId,
				status: pick.passed ? 'passed' : 'used'
			});
			created++;
		}
		catch (err) {
			if (err.code === 11000) {
				errors.push(pick.season + ' R' + pick.round + ' #' + pick.pickNumber + ': Duplicate');
				skipped++;
			} else {
				throw err;
			}
		}
	}

	console.log('Done!');
	console.log('  Created: ' + created);
	console.log('  Skipped: ' + skipped);

	if (errors.length > 0) {
		console.log('\nErrors:');
		errors.slice(0, 20).forEach(function(e) {
			console.log('  - ' + e);
		});
		if (errors.length > 20) {
			console.log('  ... and ' + (errors.length - 20) + ' more');
		}
	}

	process.exit(0);
}

seed().catch(function(err) {
	console.error('Error:', err);
	process.exit(1);
});
