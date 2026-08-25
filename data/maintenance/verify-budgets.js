var dotenv = require('dotenv').config({ path: __dirname + '/../../.env' });
var mongoose = require('mongoose');

var Budget = require('../../models/Budget');
var Franchise = require('../../models/Franchise');
var Regime = require('../../models/Regime');
var Contract = require('../../models/Contract');
var Transaction = require('../../models/Transaction');
var LeagueConfig = require('../../models/LeagueConfig');
var budgetHelper = require('../../helpers/budget');
var contractHelper = require('../../helpers/contract');
var notifications = require('../../helpers/notifications');

var computeBuyOutIfCut = budgetHelper.computeBuyOutIfCut;
var contractAffectsSeason = contractHelper.contractAffectsSeason;

mongoose.connect(process.env.MONGODB_URI);

var BASE_AMOUNT = 1000;

async function verify() {
	console.log('Verifying budgets against contracts and transactions...\n');

	// Load all data
	var franchises = await Franchise.find({}).lean();
	var regimes = await Regime.find({ 'tenures.endSeason': null }).lean();
	var contracts = await Contract.find({}).lean();
	var trades = await Transaction.find({ type: 'trade' }).lean();
	var cuts = await Transaction.find({ type: 'fa', 'drops.0': { $exists: true } }).lean();

	// Build franchise name lookup from current regimes
	var franchiseNames = {};
	regimes.forEach(function(regime) {
		regime.tenures.forEach(function(tenure) {
			if (tenure.endSeason === null) {
				franchiseNames[tenure.franchiseId.toString()] = regime.displayName;
			}
		});
	});

	// Get current season from LeagueConfig
	var leagueConfig = await LeagueConfig.findOne({});
	if (!leagueConfig || !leagueConfig.season) {
		console.error('Error: No LeagueConfig found or season not set');
		process.exit(1);
	}
	var currentSeason = leagueConfig.season;
	var seasons = [currentSeason, currentSeason + 1, currentSeason + 2];

	console.log('Checking seasons:', seasons.join(', '), '\n');

	var drifts = [];

	for (var i = 0; i < franchises.length; i++) {
		var franchise = franchises[i];
		var franchiseId = franchise._id;
		var franchiseName = franchiseNames[franchiseId.toString()] || ('Franchise ' + franchise.rosterId);

		for (var j = 0; j < seasons.length; j++) {
			var season = seasons[j];

			// Calculate expected values
			var payroll = 0;
			var recoverable = 0;
			contracts.forEach(function(c) {
				if (!c.franchiseId.equals(franchiseId)) return;
				if (!contractAffectsSeason(c, season, currentSeason)) return;
				payroll += c.salary;
				var buyOut = computeBuyOutIfCut(c.salary, c.startYear, c.endYear, season);
				recoverable += (c.salary - buyOut);
			});

			var buyOuts = 0;
			cuts.forEach(function(cut) {
				if (!cut.franchiseId || !cut.franchiseId.equals(franchiseId)) return;
				if (!cut.drops) return;
				cut.drops.forEach(function(drop) {
					if (!drop.buyOuts) return;
					drop.buyOuts.forEach(function(bo) {
						if (bo.season === season) {
							buyOuts += bo.amount;
						}
					});
				});
			});

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

			var expectedAvailable = BASE_AMOUNT - payroll - buyOuts + cashIn - cashOut;

			// Get actual budget document
			var actual = await Budget.findOne({ franchiseId: franchiseId, season: season }).lean();

			if (!actual) {
				drifts.push(`${franchiseName} ${season}: missing budget`);
				continue;
			}

			// Compare
			if (actual.payroll !== payroll) {
				drifts.push(`${franchiseName} ${season}: payroll is ${actual.payroll}, expected ${payroll}`);
			}
			if (actual.buyOuts !== buyOuts) {
				drifts.push(`${franchiseName} ${season}: buyOuts is ${actual.buyOuts}, expected ${buyOuts}`);
			}
			if (actual.cashIn !== cashIn) {
				drifts.push(`${franchiseName} ${season}: cashIn is ${actual.cashIn}, expected ${cashIn}`);
			}
			if (actual.cashOut !== cashOut) {
				drifts.push(`${franchiseName} ${season}: cashOut is ${actual.cashOut}, expected ${cashOut}`);
			}
			if (actual.available !== expectedAvailable) {
				drifts.push(`${franchiseName} ${season}: available is ${actual.available}, expected ${expectedAvailable}`);
			}
			if (actual.recoverable !== recoverable) {
				drifts.push(`${franchiseName} ${season}: recoverable is ${actual.recoverable}, expected ${recoverable}`);
			}
		}
	}

	if (drifts.length > 0) {
		console.log('DRIFT DETECTED:\n');
		drifts.forEach(function(d) {
			console.log('  - ' + d);
		});
		console.log('\n' + drifts.length + ' discrepancies found.');

		var summary = drifts.slice(0, 5).join('\n');
		var message = 'Budget drift detected! ' + drifts.length + ' discrepancies:\n' + summary;
		if (drifts.length > 5) {
			message += '\n... and ' + (drifts.length - 5) + ' more';
		}
		await notifications.alertCommissioner(message);

		process.exit(1);
	} else {
		console.log('All budgets verified. No drift detected.');
		process.exit(0);
	}
}

verify().catch(function(err) {
	console.error('Error:', err);
	notifications.alertCommissioner('Budget verification script crashed: ' + err.message).then(function() {
		process.exit(1);
	});
});
