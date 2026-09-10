/**
 * Sanity check service
 * 
 * Runs data integrity checks and returns results.
 * Used by both the admin web page and the cron job.
 */

var LeagueConfig = require('../models/LeagueConfig');
var Franchise = require('../models/Franchise');
var Regime = require('../models/Regime');
var Contract = require('../models/Contract');
var Budget = require('../models/Budget');
var Pick = require('../models/Pick');
var Player = require('../models/Player');
var Transaction = require('../models/Transaction');

var { isRfaRights, affectsBudget } = require('../helpers/contract');
var { buildRegimeMap } = require('../helpers/regime');
var sleeper = require('../helpers/sleeper');

/**
 * Run all sanity checks and return results.
 * 
 * @param {Object} [options]
 * @param {boolean} [options.includeSleeperCheck] - Force Sleeper check even outside normal phase
 * @returns {Promise<Object>} Full results including detailed check data for web UI
 */
async function runAllChecks(options) {
	options = options || {};
	
	var config = await LeagueConfig.findById('pso');
	var currentSeason = config ? config.season : new Date().getFullYear();
	
	var franchises = await Franchise.find({}).lean();
	var regimes = await Regime.find({}).lean();
	var regimeMap = buildRegimeMap(regimes, currentSeason);
	var franchiseIds = new Set(franchises.map(function(f) { return f._id.toString(); }));
	
	var franchiseMap = {};
	franchises.forEach(function(f) {
		var fIdStr = f._id.toString();
		franchiseMap[fIdStr] = {
			_id: f._id,
			rosterId: f.rosterId,
			displayName: regimeMap[fIdStr] || 'Unknown'
		};
	});
	
	var expectedFranchiseCount = franchises.length;
	
	// ========== Roster Check ==========
	var allContracts = await Contract.find({}).lean();
	var activeContracts = allContracts.filter(function(c) { return !isRfaRights(c); });
	
	var rosterCounts = {};
	activeContracts.forEach(function(c) {
		var fIdStr = c.franchiseId.toString();
		if (!rosterCounts[fIdStr]) {
			rosterCounts[fIdStr] = 0;
		}
		rosterCounts[fIdStr]++;
	});
	
	var rosterProblems = [];
	var rosterChecks = [];
	Object.keys(franchiseMap).forEach(function(fIdStr) {
		var count = rosterCounts[fIdStr] || 0;
		var franchise = franchiseMap[fIdStr];
		var check = {
			regimeName: franchise.displayName,
			count: count,
			limit: LeagueConfig.ROSTER_LIMIT,
			isOver: count > LeagueConfig.ROSTER_LIMIT
		};
		rosterChecks.push(check);
		if (check.isOver) {
			rosterProblems.push(check);
		}
	});
	rosterChecks.sort(function(a, b) {
		return b.count - a.count;
	});
	
	// ========== Budget Check ==========
	var budgets = await Budget.find({
		season: { $gte: currentSeason }
	}).lean();
	
	var budgetsBySeason = {};
	budgets.forEach(function(b) {
		if (!budgetsBySeason[b.season]) {
			budgetsBySeason[b.season] = [];
		}
		budgetsBySeason[b.season].push(b);
	});
	
	var expectedTotalBase = expectedFranchiseCount * 1000;
	
	var budgetProblems = [];
	var budgetChecks = [];
	
	Object.keys(budgetsBySeason).sort().forEach(function(seasonStr) {
		var season = parseInt(seasonStr, 10);
		var seasonBudgets = budgetsBySeason[season];
		
		var check = {
			season: season,
			franchiseCount: seasonBudgets.length,
			expectedFranchiseCount: expectedFranchiseCount,
			totalBase: 0,
			totalPayroll: 0,
			totalBuyOuts: 0,
			totalCashIn: 0,
			totalCashOut: 0,
			totalAvailable: 0,
			formulaErrors: [],
			problems: []
		};
		
		seasonBudgets.forEach(function(b) {
			check.totalBase += b.baseAmount || 0;
			check.totalPayroll += b.payroll || 0;
			check.totalBuyOuts += b.buyOuts || 0;
			check.totalCashIn += b.cashIn || 0;
			check.totalCashOut += b.cashOut || 0;
			check.totalAvailable += b.available || 0;
			
			var expectedAvailable = (b.baseAmount || 0) - (b.payroll || 0) - (b.buyOuts || 0) + (b.cashIn || 0) - (b.cashOut || 0);
			if (b.available !== expectedAvailable) {
				var franchise = franchiseMap[b.franchiseId.toString()];
				check.formulaErrors.push({
					regimeName: franchise ? franchise.displayName : 'Unknown',
					actual: b.available,
					expected: expectedAvailable,
					diff: b.available - expectedAvailable
				});
			}
		});
		
		if (check.franchiseCount !== expectedFranchiseCount) {
			check.problems.push('Missing budgets: ' + check.franchiseCount + '/' + expectedFranchiseCount + ' franchises');
		}
		if (check.totalBase !== expectedTotalBase) {
			check.problems.push('Base amount drift: $' + check.totalBase + ' (expected $' + expectedTotalBase + ')');
		}
		if (check.totalCashIn !== check.totalCashOut) {
			check.problems.push('Cash imbalance: $' + check.totalCashIn + ' in vs $' + check.totalCashOut + ' out');
		}
		
		var totalCommitted = check.totalAvailable + check.totalPayroll + check.totalBuyOuts;
		var expectedCommitted = check.totalBase + check.totalCashIn - check.totalCashOut;
		if (totalCommitted !== expectedCommitted) {
			check.problems.push('Money drift: $' + totalCommitted + ' accounted vs $' + expectedCommitted + ' expected');
		}
		
		if (check.formulaErrors.length > 0) {
			check.problems.push(check.formulaErrors.length + ' franchise(s) with formula errors');
		}
		
		check.isHealthy = check.problems.length === 0;
		check.totalCommitted = totalCommitted;
		check.expectedCommitted = expectedCommitted;
		
		budgetChecks.push(check);
		if (!check.isHealthy) {
			budgetProblems.push(check);
		}
	});
	
	// ========== Pick Integrity Check ==========
	var picks = await Pick.find({ season: { $gte: currentSeason } }).lean();
	var expectedPicksPerSeason = expectedFranchiseCount * 10;
	
	var picksBySeason = {};
	picks.forEach(function(p) {
		if (!picksBySeason[p.season]) {
			picksBySeason[p.season] = [];
		}
		picksBySeason[p.season].push(p);
	});
	
	var pickProblems = [];
	var pickChecks = [];
	
	Object.keys(picksBySeason).sort().forEach(function(seasonStr) {
		var season = parseInt(seasonStr, 10);
		var seasonPicks = picksBySeason[season];
		
		var check = {
			season: season,
			pickCount: seasonPicks.length,
			expectedPickCount: expectedPicksPerSeason,
			problems: []
		};
		
		if (check.pickCount !== expectedPicksPerSeason) {
			check.problems.push('Wrong pick count: ' + check.pickCount + ' (expected ' + expectedPicksPerSeason + ')');
		}
		
		var picksByRound = {};
		seasonPicks.forEach(function(p) {
			if (!picksByRound[p.round]) {
				picksByRound[p.round] = [];
			}
			picksByRound[p.round].push(p);
		});
		
		for (var round = 1; round <= 10; round++) {
			var roundPicks = picksByRound[round] || [];
			if (roundPicks.length !== expectedFranchiseCount) {
				check.problems.push('Round ' + round + ': ' + roundPicks.length + ' picks (expected ' + expectedFranchiseCount + ')');
			}
		}
		
		var invalidOwners = seasonPicks.filter(function(p) {
			return !franchiseIds.has(p.currentFranchiseId.toString());
		});
		if (invalidOwners.length > 0) {
			check.problems.push(invalidOwners.length + ' pick(s) owned by invalid franchise');
		}
		
		check.isHealthy = check.problems.length === 0;
		pickChecks.push(check);
		if (!check.isHealthy) {
			pickProblems.push(check);
		}
	});
	
	// ========== Payroll Accuracy Check ==========
	var payrollProblems = [];
	
	budgets.forEach(function(b) {
		var season = b.season;
		var fIdStr = b.franchiseId.toString();
		var franchise = franchiseMap[fIdStr];
		
		var calculatedPayroll = 0;
		allContracts.forEach(function(c) {
			if (c.franchiseId.toString() !== fIdStr) return;
			if (!affectsBudget(c, season, currentSeason)) return;
			calculatedPayroll += c.salary;
		});
		
		if (b.payroll !== calculatedPayroll) {
			payrollProblems.push({
				regimeName: franchise ? franchise.displayName : 'Unknown',
				season: season,
				stored: b.payroll,
				calculated: calculatedPayroll,
				diff: b.payroll - calculatedPayroll
			});
		}
	});
	
	var payrollChecks = {
		totalChecked: budgets.length,
		problemCount: payrollProblems.length,
		isHealthy: payrollProblems.length === 0
	};
	
	// ========== Contract Validity Check ==========
	var players = await Player.find({}).lean();
	var playerIds = new Set(players.map(function(p) { return p._id.toString(); }));
	
	var contractProblems = [];
	
	allContracts.forEach(function(c) {
		var problems = [];
		
		if (!playerIds.has(c.playerId.toString())) {
			problems.push('references non-existent player');
		}
		
		if (!franchiseIds.has(c.franchiseId.toString())) {
			problems.push('references non-existent franchise');
		}
		
		if (!isRfaRights(c)) {
			if (c.startYear && c.endYear && c.startYear > c.endYear) {
				problems.push('startYear > endYear');
			}
			if (c.endYear && c.endYear < currentSeason) {
				problems.push('expired contract (endYear ' + c.endYear + ' < current ' + currentSeason + ')');
			}
		}
		
		if (problems.length > 0) {
			var player = players.find(function(p) { return p._id.toString() === c.playerId.toString(); });
			contractProblems.push({
				playerId: c.playerId.toString(),
				playerName: player ? player.name : 'Unknown',
				regimeName: franchiseMap[c.franchiseId.toString()]?.displayName || 'Unknown',
				problems: problems
			});
		}
	});
	
	var contractChecks = {
		totalContracts: allContracts.length,
		problemCount: contractProblems.length,
		isHealthy: contractProblems.length === 0
	};
	
	// ========== RFA Shape Check ==========
	var rfaContracts = allContracts.filter(function(c) { return isRfaRights(c); });
	var rfaProblems = [];
	
	rfaContracts.forEach(function(c) {
		var problems = [];
		
		if (c.startYear !== null && c.startYear !== undefined) {
			problems.push('has startYear set');
		}
		if (c.endYear !== null && c.endYear !== undefined) {
			problems.push('has endYear set');
		}
		
		if (problems.length > 0) {
			var player = players.find(function(p) { return p._id.toString() === c.playerId.toString(); });
			rfaProblems.push({
				playerName: player ? player.name : 'Unknown',
				regimeName: franchiseMap[c.franchiseId.toString()]?.displayName || 'Unknown',
				problems: problems
			});
		}
	});
	
	var rfaChecks = {
		totalRfaRights: rfaContracts.length,
		problemCount: rfaProblems.length,
		isHealthy: rfaProblems.length === 0
	};
	
	// ========== Regime Coverage Check ==========
	var regimeProblems = [];
	
	franchises.forEach(function(f) {
		var fIdStr = f._id.toString();
		var activeTenures = [];
		regimes.forEach(function(r) {
			r.tenures.forEach(function(t) {
				if (t.franchiseId.toString() === fIdStr && t.endSeason === null) {
					activeTenures.push({ regimeName: r.displayName });
				}
			});
		});
		
		if (activeTenures.length === 0) {
			regimeProblems.push({
				franchiseId: fIdStr,
				regimeName: franchiseMap[fIdStr]?.displayName || 'Unknown (ID: ' + fIdStr + ')',
				problem: 'No active regime'
			});
		} else if (activeTenures.length > 1) {
			regimeProblems.push({
				franchiseId: fIdStr,
				regimeName: franchiseMap[fIdStr]?.displayName || 'Unknown',
				problem: 'Multiple active regimes: ' + activeTenures.map(function(t) { return t.regimeName; }).join(', ')
			});
		}
	});
	
	var regimeChecks = {
		totalFranchises: franchises.length,
		problemCount: regimeProblems.length,
		isHealthy: regimeProblems.length === 0
	};
	
	// ========== Pick Status Check ==========
	var usedPicks = picks.filter(function(p) { return p.status === 'used'; });
	var pickStatusProblems = [];
	
	usedPicks.forEach(function(p) {
		if (!p.transactionId) {
			pickStatusProblems.push({
				season: p.season,
				round: p.round,
				problem: 'Used pick without transactionId'
			});
		}
	});
	
	var pickStatusChecks = {
		usedPickCount: usedPicks.length,
		problemCount: pickStatusProblems.length,
		isHealthy: pickStatusProblems.length === 0
	};
	
	// ========== Trade Balance Check ==========
	var trades = await Transaction.find({ type: 'trade' }).lean();
	var tradeProblems = [];
	
	trades.forEach(function(t) {
		if (!t.parties || t.parties.length < 2) {
			tradeProblems.push({
				tradeId: t.tradeId,
				timestamp: t.timestamp,
				problem: 'Trade has fewer than 2 parties'
			});
			return;
		}
		
		var playersReceived = [];
		var picksReceived = [];
		var cashReceived = [];
		var rfaReceived = [];
		
		t.parties.forEach(function(party) {
			if (party.receives) {
				if (party.receives.players) {
					party.receives.players.forEach(function(p) {
						playersReceived.push(p.playerId.toString());
					});
				}
				if (party.receives.picks) {
					party.receives.picks.forEach(function(p) {
						picksReceived.push(p.season + '-' + p.round + '-' + p.originalFranchiseId.toString());
					});
				}
				if (party.receives.cash) {
					party.receives.cash.forEach(function(c) {
						cashReceived.push({ amount: c.amount, season: c.season });
					});
				}
				if (party.receives.rfaRights) {
					party.receives.rfaRights.forEach(function(r) {
						rfaReceived.push(r.playerId.toString());
					});
				}
			}
		});
		
		var totalAssets = playersReceived.length + picksReceived.length + cashReceived.length + rfaReceived.length;
		if (totalAssets === 0) {
			tradeProblems.push({
				tradeId: t.tradeId,
				timestamp: t.timestamp,
				problem: 'Trade has no assets exchanged'
			});
		}
	});
	
	var tradeChecks = {
		totalTrades: trades.length,
		problemCount: tradeProblems.length,
		isHealthy: tradeProblems.length === 0
	};
	
	// ========== Future Budget Existence Check ==========
	var requiredSeasons = [currentSeason, currentSeason + 1, currentSeason + 2];
	var missingBudgetSeasons = [];
	
	requiredSeasons.forEach(function(season) {
		var seasonBudgets = budgetsBySeason[season] || [];
		if (seasonBudgets.length < expectedFranchiseCount) {
			missingBudgetSeasons.push({
				season: season,
				count: seasonBudgets.length,
				expected: expectedFranchiseCount
			});
		}
	});
	
	var futureBudgetChecks = {
		requiredSeasons: requiredSeasons,
		missingSeasons: missingBudgetSeasons,
		isHealthy: missingBudgetSeasons.length === 0
	};
	
	// ========== Sleeper Roster Comparison ==========
	var sleeperProblems = [];
	var sleeperChecks = { skipped: false };
	var shouldCheckSleeper = options.includeSleeperCheck || (config && config.shouldSyncToSleeper());
	
	if (!shouldCheckSleeper) {
		sleeperChecks.skipped = true;
	} else {
		try {
			var sleeperRosters = await sleeper.fetchSleeperRosters();
			
			var dbRostersByRosterId = {};
			franchises.forEach(function(f) {
				dbRostersByRosterId[f.rosterId] = new Set();
			});
			
			// Need to populate players for sleeperId
			var contractsWithPlayers = await Contract.find({}).populate('playerId').lean();
			var activeContractsWithPlayers = contractsWithPlayers.filter(function(c) { return !isRfaRights(c); });
			
			activeContractsWithPlayers.forEach(function(c) {
				var franchise = franchiseMap[c.franchiseId.toString()];
				if (franchise && franchise.rosterId && c.playerId && c.playerId.sleeperId) {
					dbRostersByRosterId[franchise.rosterId].add(c.playerId.sleeperId);
				}
			});
			
			Object.keys(sleeperRosters).forEach(function(rosterIdStr) {
				var rosterId = parseInt(rosterIdStr, 10);
				var sleeperPlayers = new Set(sleeperRosters[rosterId].players || []);
				var dbPlayers = dbRostersByRosterId[rosterId] || new Set();
				
				var franchiseName = 'Roster ' + rosterId;
				Object.keys(franchiseMap).forEach(function(fIdStr) {
					if (franchiseMap[fIdStr].rosterId === rosterId) {
						franchiseName = franchiseMap[fIdStr].displayName;
					}
				});
				
				sleeperPlayers.forEach(function(sleeperId) {
					if (!dbPlayers.has(sleeperId)) {
						sleeperProblems.push({
							regimeName: franchiseName,
							sleeperId: sleeperId,
							problem: 'On Sleeper but not in DB'
						});
					}
				});
				
				dbPlayers.forEach(function(sleeperId) {
					if (!sleeperPlayers.has(sleeperId)) {
						sleeperProblems.push({
							regimeName: franchiseName,
							sleeperId: sleeperId,
							problem: 'In DB but not on Sleeper'
						});
					}
				});
			});
			
			sleeperChecks.problemCount = sleeperProblems.length;
			sleeperChecks.isHealthy = sleeperProblems.length === 0;
		} catch (err) {
			sleeperProblems.push({
				regimeName: 'API',
				problem: 'Failed to fetch Sleeper rosters: ' + err.message
			});
			sleeperChecks.problemCount = 1;
			sleeperChecks.isHealthy = false;
			sleeperChecks.error = err.message;
		}
	}
	
	// ========== Overall Health ==========
	var allHealthy = rosterProblems.length === 0 &&
		budgetProblems.length === 0 &&
		pickProblems.length === 0 &&
		payrollChecks.isHealthy &&
		contractChecks.isHealthy &&
		rfaChecks.isHealthy &&
		regimeChecks.isHealthy &&
		pickStatusChecks.isHealthy &&
		tradeChecks.isHealthy &&
		futureBudgetChecks.isHealthy &&
		(sleeperChecks.skipped || sleeperChecks.isHealthy);
	
	var problemCount = rosterProblems.length +
		budgetProblems.length +
		pickProblems.length +
		payrollProblems.length +
		contractProblems.length +
		rfaProblems.length +
		regimeProblems.length +
		pickStatusProblems.length +
		tradeProblems.length +
		missingBudgetSeasons.length +
		sleeperProblems.length;
	
	// Build summary for cron job display
	var checks = {
		roster: { name: 'Roster Limits', problems: rosterProblems.length },
		budget: { name: 'Budget Integrity', problems: budgetProblems.length },
		picks: { name: 'Pick Integrity', problems: pickProblems.length },
		payroll: { name: 'Payroll Accuracy', problems: payrollProblems.length },
		contract: { name: 'Contract Validity', problems: contractProblems.length },
		rfa: { name: 'RFA Shape', problems: rfaProblems.length },
		regime: { name: 'Regime Coverage', problems: regimeProblems.length },
		pickStatus: { name: 'Pick Status', problems: pickStatusProblems.length },
		trade: { name: 'Trade Balance', problems: tradeProblems.length },
		futureBudget: { name: 'Future Budgets', problems: missingBudgetSeasons.length },
		sleeper: { name: 'Sleeper Sync', problems: sleeperProblems.length, skipped: sleeperChecks.skipped }
	};
	
	// Build flat problems array for cron job notifications
	var problems = [];
	rosterProblems.forEach(function(p) {
		problems.push({ category: 'roster', message: p.regimeName + ': ' + p.count + '/' + LeagueConfig.ROSTER_LIMIT + ' roster spots' });
	});
	budgetProblems.forEach(function(b) {
		b.problems.forEach(function(msg) {
			problems.push({ category: 'budget', message: b.season + ': ' + msg });
		});
	});
	pickProblems.forEach(function(p) {
		p.problems.forEach(function(msg) {
			problems.push({ category: 'picks', message: p.season + ': ' + msg });
		});
	});
	payrollProblems.forEach(function(p) {
		problems.push({ category: 'payroll', message: p.regimeName + ' ' + p.season + ': stored $' + p.stored + ' ≠ calculated $' + p.calculated });
	});
	contractProblems.forEach(function(c) {
		problems.push({ category: 'contract', message: c.playerName + ' (' + c.regimeName + '): ' + c.problems.join(', ') });
	});
	rfaProblems.forEach(function(r) {
		problems.push({ category: 'rfa', message: r.playerName + ' (' + r.regimeName + '): ' + r.problems.join(', ') });
	});
	regimeProblems.forEach(function(r) {
		problems.push({ category: 'regime', message: r.regimeName + ': ' + r.problem });
	});
	pickStatusProblems.forEach(function(p) {
		problems.push({ category: 'pickStatus', message: p.season + ' Round ' + p.round + ': ' + p.problem });
	});
	tradeProblems.forEach(function(t) {
		problems.push({ category: 'trade', message: 'Trade #' + t.tradeId + ': ' + t.problem });
	});
	missingBudgetSeasons.forEach(function(s) {
		problems.push({ category: 'futureBudget', message: s.season + ': ' + s.count + '/' + s.expected + ' budgets' });
	});
	sleeperProblems.forEach(function(s) {
		problems.push({ category: 'sleeper', message: s.regimeName + ': ' + s.problem + (s.sleeperId ? ' (sleeperId: ' + s.sleeperId + ')' : '') });
	});
	
	return {
		problems: problems,
		currentSeason: currentSeason,
		allHealthy: allHealthy,
		problemCount: problemCount,
		checks: checks,
		
		// Detailed data for web UI
		rosterChecks: rosterChecks,
		rosterProblems: rosterProblems,
		rosterLimit: LeagueConfig.ROSTER_LIMIT,
		
		budgetChecks: budgetChecks,
		budgetProblems: budgetProblems,
		expectedTotalBase: expectedTotalBase,
		
		pickChecks: pickChecks,
		pickProblems: pickProblems,
		expectedPicksPerSeason: expectedPicksPerSeason,
		
		payrollChecks: payrollChecks,
		payrollProblems: payrollProblems,
		
		contractChecks: contractChecks,
		contractProblems: contractProblems,
		
		rfaChecks: rfaChecks,
		rfaProblems: rfaProblems,
		
		regimeChecks: regimeChecks,
		regimeProblems: regimeProblems,
		
		pickStatusChecks: pickStatusChecks,
		pickStatusProblems: pickStatusProblems,
		
		tradeChecks: tradeChecks,
		tradeProblems: tradeProblems,
		
		futureBudgetChecks: futureBudgetChecks,
		
		sleeperChecks: sleeperChecks,
		sleeperProblems: sleeperProblems
	};
}

module.exports = {
	runAllChecks: runAllChecks
};
