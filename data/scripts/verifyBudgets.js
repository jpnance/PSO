var dotenv = require('dotenv').config({ path: __dirname + '/../../.env' });
var request = require('superagent');
var mongoose = require('mongoose');

var Budget = require('../../models/Budget');
var Franchise = require('../../models/Franchise');
var Contract = require('../../models/Contract');
var Transaction = require('../../models/Transaction');
var LeagueConfig = require('../../models/LeagueConfig');
var budgetHelper = require('../../helpers/budget');

var computeBuyOutIfCut = budgetHelper.computeBuyOutIfCut;

mongoose.connect(process.env.MONGODB_URI);

var BASE_AMOUNT = 1000;

async function coinflipperAlert(message) {
	if (process.env.NODE_ENV != 'production') {
		console.log('[DEV] Would alert:', message);
		return Promise.resolve();
	}

	return request
		.post('https://ntfy.sh/coinflipper')
		.set('Content-Type', 'application/x-www-form-urlencoded')
		.send(`${(new Date()).toISOString()} [PSO] ${message}`)
		.then(response => {});
}

async function verify() {
	console.log('Verifying budgets against contracts and transactions...\n');

	// Load all data
	var franchises = await Franchise.find({}).lean();
	var contracts = await Contract.find({}).lean();
	var trades = await Transaction.find({ type: 'trade' }).lean();
	var cuts = await Transaction.find({ type: 'fa-cut' }).lean();

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

		for (var j = 0; j < seasons.length; j++) {
			var season = seasons[j];

			// Calculate expected values
			var payroll = 0;
			var recoverable = 0;
			contracts.forEach(function(c) {
				if (!c.franchiseId.equals(franchiseId)) return;
				if (c.salary === null) return;
				if (!c.endYear || c.endYear < season) return;
				if (c.startYear && c.startYear > season) return;
				payroll += c.salary;
				var buyOut = computeBuyOutIfCut(c.salary, c.startYear, c.endYear, season);
				recoverable += (c.salary - buyOut);
			});

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
				drifts.push(`Missing budget for franchise ${franchise.sleeperRosterId} season ${season}`);
				continue;
			}

			// Compare
			if (actual.payroll !== payroll) {
				drifts.push(`Franchise ${franchise.sleeperRosterId} ${season}: payroll is ${actual.payroll}, expected ${payroll}`);
			}
			if (actual.buyOuts !== buyOuts) {
				drifts.push(`Franchise ${franchise.sleeperRosterId} ${season}: buyOuts is ${actual.buyOuts}, expected ${buyOuts}`);
			}
			if (actual.cashIn !== cashIn) {
				drifts.push(`Franchise ${franchise.sleeperRosterId} ${season}: cashIn is ${actual.cashIn}, expected ${cashIn}`);
			}
			if (actual.cashOut !== cashOut) {
				drifts.push(`Franchise ${franchise.sleeperRosterId} ${season}: cashOut is ${actual.cashOut}, expected ${cashOut}`);
			}
			if (actual.available !== expectedAvailable) {
				drifts.push(`Franchise ${franchise.sleeperRosterId} ${season}: available is ${actual.available}, expected ${expectedAvailable}`);
			}
			if (actual.recoverable !== recoverable) {
				drifts.push(`Franchise ${franchise.sleeperRosterId} ${season}: recoverable is ${actual.recoverable}, expected ${recoverable}`);
			}
		}
	}

	if (drifts.length > 0) {
		console.log('DRIFT DETECTED:\n');
		drifts.forEach(function(d) {
			console.log('  - ' + d);
		});
		console.log('\n' + drifts.length + ' discrepancies found.');

		await coinflipperAlert('Budget drift detected! ' + drifts.length + ' discrepancies. Run seedBudgets.js to repair.');

		process.exit(1);
	} else {
		console.log('All budgets verified. No drift detected.');
		process.exit(0);
	}
}

verify().catch(function(err) {
	console.error('Error:', err);
	coinflipperAlert('Budget verification script crashed: ' + err.message).then(function() {
		process.exit(1);
	});
});
