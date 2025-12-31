var dotenv = require('dotenv').config({ path: __dirname + '/../../.env' });
var mongoose = require('mongoose');
var request = require('superagent');

var Budget = require('../../models/Budget');
var Franchise = require('../../models/Franchise');
var PSO = require('../../pso.js');

var sheetLink = 'https://sheets.googleapis.com/v4/spreadsheets/1nas3AqWZtCu_UZIV77Jgxd9oriF1NQjzSjFWW86eong/values/Cash';

mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });

// Map owner display names to sleeperRosterId (1-12)
function getSleeperRosterId(ownerName) {
	return PSO.franchiseIds[ownerName];
}

async function fetchCashData() {
	var response = await request
		.get(sheetLink)
		.query({ alt: 'json', key: process.env.GOOGLE_API_KEY });

	var dataJson = JSON.parse(response.text);
	var budgets = [];
	var owners = [];
	var currentSeason = null;

	dataJson.values.forEach(function(row, i) {
		// First row has owner names
		if (i === 0) {
			row.forEach(function(value, j) {
				if (j >= 2) { // Skip first two columns
					owners.push(value);
				}
			});
			return;
		}

		// Row with "Buy-outs" indicates start of a new season
		if (row.includes('Buy-outs')) {
			currentSeason = parseInt(row[0]);
			return;
		}

		// Row with "Remaining" has the final budget values
		if (row.includes('Remaining') && currentSeason) {
			row.forEach(function(value, j) {
				if (j >= 2 && owners[j - 2]) {
					budgets.push({
						season: currentSeason,
						owner: owners[j - 2],
						available: parseInt(value.replace('$', '')) || 0
					});
				}
			});
		}
	});

	return budgets;
}

async function seed() {
	console.log('Seeding budgets from spreadsheet...\n');

	var clearExisting = process.argv.includes('--clear');
	if (clearExisting) {
		console.log('Clearing existing budgets...');
		await Budget.deleteMany({});
	}

	// Load franchises (to map sleeperRosterId -> _id)
	var franchises = await Franchise.find({});
	var franchiseByRosterId = {};
	franchises.forEach(function(f) {
		franchiseByRosterId[f.sleeperRosterId] = f._id;
	});

	console.log('Loaded', franchises.length, 'franchises');

	// Fetch cash data from spreadsheet
	var cashData = await fetchCashData();
	console.log('Found', cashData.length, 'budget entries in spreadsheet\n');

	var created = 0;
	var skipped = 0;
	var errors = [];

	for (var i = 0; i < cashData.length; i++) {
		var entry = cashData[i];

		// Find franchise
		var sleeperRosterId = getSleeperRosterId(entry.owner);
		if (!sleeperRosterId) {
			errors.push({ entry: entry.owner + ' ' + entry.season, reason: 'Unknown owner: ' + entry.owner });
			skipped++;
			continue;
		}

		var franchiseId = franchiseByRosterId[sleeperRosterId];
		if (!franchiseId) {
			errors.push({ entry: entry.owner + ' ' + entry.season, reason: 'No franchise for rosterId: ' + sleeperRosterId });
			skipped++;
			continue;
		}

		// Create budget
		try {
			await Budget.create({
				franchiseId: franchiseId,
				season: entry.season,
				available: entry.available
				// baseAmount, payroll, deadMoney, cashIn, cashOut will use defaults
			});
			created++;
		}
		catch (err) {
			if (err.code === 11000) {
				errors.push({ entry: entry.owner + ' ' + entry.season, reason: 'Duplicate budget' });
				skipped++;
			}
			else {
				throw err;
			}
		}
	}

	console.log('Done!');
	console.log('  Created:', created);
	console.log('  Skipped:', skipped);

	if (errors.length > 0) {
		console.log('\nErrors:');
		errors.forEach(function(e) {
			console.log('  -', e.entry + ':', e.reason);
		});
	}

	process.exit(0);
}

seed().catch(function(err) {
	console.error('Error:', err);
	process.exit(1);
});

