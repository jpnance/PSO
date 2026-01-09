var dotenv = require('dotenv').config({ path: __dirname + '/../../.env' });
var mongoose = require('mongoose');

var Budget = require('../../models/Budget');
var Franchise = require('../../models/Franchise');
var Contract = require('../../models/Contract');
var Transaction = require('../../models/Transaction');
var LeagueConfig = require('../../models/LeagueConfig');
var budgetHelper = require('../../helpers/budget');

var computeBuyOutIfCut = budgetHelper.computeBuyOutIfCut;

mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });

var BASE_AMOUNT = 1000;

// Seed budgets by calculating from contracts and transactions.
// This must run AFTER trades and cuts are seeded, since it derives values from them.
async function seed() {
	console.log('Seeding budgets from contracts and transactions...\n');

	// Clear existing budgets
	console.log('Clearing existing budgets...');
	await Budget.deleteMany({});

	// Load all franchises
	var franchises = await Franchise.find({}).lean();
	console.log('Loaded', franchises.length, 'franchises');

	// Load all contracts
	var contracts = await Contract.find({}).lean();
	console.log('Loaded', contracts.length, 'contracts');

	// Load all trades
	var trades = await Transaction.find({ type: 'trade' }).lean();
	console.log('Loaded', trades.length, 'trades');

	// Load all cuts
	var cuts = await Transaction.find({ type: 'fa-cut' }).lean();
	console.log('Loaded', cuts.length, 'cuts\n');

	// Get current season from LeagueConfig
	var leagueConfig = await LeagueConfig.findOne({});
	if (!leagueConfig || !leagueConfig.season) {
		console.error('Error: No LeagueConfig found or season not set');
		process.exit(1);
	}
	var currentSeason = leagueConfig.season;
	var seasons = [currentSeason, currentSeason + 1, currentSeason + 2];
	console.log('Calculating for seasons:', seasons.join(', '), '\n');

	var created = 0;

	for (var i = 0; i < franchises.length; i++) {
		var franchise = franchises[i];
		var franchiseId = franchise._id;

		for (var j = 0; j < seasons.length; j++) {
			var season = seasons[j];

			// Calculate payroll and recoverable: sum of salaries for contracts active in this season
			var payroll = 0;
			var recoverable = 0;
			contracts.forEach(function(c) {
				if (!c.franchiseId.equals(franchiseId)) return;
				if (c.salary === null) return; // RFA rights don't count
				if (!c.endYear || c.endYear < season) return; // Contract ended before this season
				if (c.startYear && c.startYear > season) return; // Contract hasn't started yet
				payroll += c.salary;
				var buyOut = computeBuyOutIfCut(c.salary, c.startYear, c.endYear, season);
				recoverable += (c.salary - buyOut);
			});

			// Calculate buy-outs from cuts
			var buyOuts = 0;
			cuts.forEach(function(cut) {
				if (!cut.franchiseId || !cut.franchiseId.equals(franchiseId)) return;
				if (!cut.buyOuts) return;
				cut.buyOuts.forEach(function(bo) {
					if (bo.season === season) {
						buyOuts += bo.amount;
					}
				});
			});

			// Calculate cash in/out from trades
			var cashIn = 0;
			var cashOut = 0;
			trades.forEach(function(trade) {
				if (!trade.parties) return;
				trade.parties.forEach(function(party) {
					if (!party.receives || !party.receives.cash) return;
					party.receives.cash.forEach(function(c) {
						if (c.season !== season) return;
						if (party.franchiseId.equals(franchiseId)) {
							cashIn += c.amount || 0;
						}
						if (c.fromFranchiseId && c.fromFranchiseId.equals(franchiseId)) {
							cashOut += c.amount || 0;
						}
					});
				});
			});

			// Calculate available
			var available = BASE_AMOUNT - payroll - buyOuts + cashIn - cashOut;

			// Create budget document
			await Budget.create({
				franchiseId: franchiseId,
				season: season,
				baseAmount: BASE_AMOUNT,
				payroll: payroll,
				buyOuts: buyOuts,
				cashIn: cashIn,
				cashOut: cashOut,
				available: available,
				recoverable: recoverable
			});

			created++;

			console.log(
				franchise.sleeperRosterId + ' ' + season + ':',
				'payroll=' + payroll,
				'buyOuts=' + buyOuts,
				'cashIn=' + cashIn,
				'cashOut=' + cashOut,
				'available=' + available,
				'recoverable=' + recoverable
			);
		}
	}

	console.log('\nDone! Created', created, 'budget documents.');
	process.exit(0);
}

seed().catch(function(err) {
	console.error('Error:', err);
	process.exit(1);
});
