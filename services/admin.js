var PSO = require('../config/pso');
var LeagueConfig = require('../models/LeagueConfig');
var Franchise = require('../models/Franchise');
var Regime = require('../models/Regime');
var Person = require('../models/Person');
var Contract = require('../models/Contract');
var Budget = require('../models/Budget');
var Pick = require('../models/Pick');
var Player = require('../models/Player');
var Transaction = require('../models/Transaction');
var transactionService = require('./transaction');
var { formatContractYears, getPositionIndex } = require('../helpers/view');

var currentSeason = PSO.season;

// GET /admin - show config management page
async function configPage(request, response) {
	var config = await LeagueConfig.findById('pso');
	if (!config) {
		config = new LeagueConfig({ _id: 'pso', season: currentSeason });
		await config.save();
	}
	
	response.render('admin', { 
		config: config,
		phase: config.getPhase(),
		hardCapActive: config.isHardCapActive(),
		tradesEnabled: config.areTradesEnabled(),
		faEnabled: config.isFAEnabled(),
		faPlayoffOnly: config.isFAPlayoffOnly(),
		activePage: 'admin'
	});
}

// POST /admin/config - update config
async function updateConfig(request, response) {
	var config = await LeagueConfig.findById('pso');
	if (!config) {
		config = new LeagueConfig({ _id: 'pso', season: currentSeason });
	}
	
	var body = request.body;
	
	// Update dates (convert empty strings to null)
	var dateFields = [
		'tradeWindow', 'nflDraft', 'cutDay', 'draftDay', 'contractsDue',
		'nflSeason', 'faab', 'tradeDeadline', 'playoffs', 'deadPeriod'
	];
	
	dateFields.forEach(function(field) {
		if (body[field] !== undefined) {
			config[field] = body[field] ? new Date(body[field]) : null;
		}
	});
	
	// Update tentative flags
	config.cutDayTentative = body.cutDayTentative === 'true' || body.cutDayTentative === true;
	config.draftDayTentative = body.draftDayTentative === 'true' || body.draftDayTentative === true;
	config.contractsDueTentative = body.contractsDueTentative === 'true' || body.contractsDueTentative === true;
	
	// Update banner (if provided in request)
	if (body.clearBanner) {
		config.banner = '';
	} else if (body.banner !== undefined) {
		config.banner = body.banner || '';
	}
	if (body.bannerStyle !== undefined) {
		config.bannerStyle = body.bannerStyle;
	}
	
	await config.save();
	
	response.redirect('/admin');
}

// GET /admin/advance-season - show rollover form
async function advanceSeasonForm(request, response) {
	var config = await LeagueConfig.findById('pso');
	if (!config) {
		return response.status(404).send('Config not found');
	}
	
	var newSeason = config.season + 1;
	var defaults = LeagueConfig.computeDefaultDates(newSeason);
	
	// Get all franchises with their display names
	var franchises = await Franchise.find({}).lean();
	var regimes = await Regime.find({}).lean();
	
	var franchiseList = franchises.map(function(f) {
		var fIdStr = f._id.toString();
		var regime = regimes.find(function(r) {
			return r.tenures.some(function(t) {
				return t.franchiseId.toString() === fIdStr &&
					t.startSeason <= newSeason &&
					(t.endSeason === null || t.endSeason >= newSeason);
			});
		});
		return {
			id: f._id.toString(),
			name: regime ? regime.displayName : 'Unknown'
		};
	}).sort(function(a, b) {
		return a.name.localeCompare(b.name);
	});
	
	// Count expiring contracts
	var expiringContracts = await Contract.find({ endYear: config.season }).populate('playerId').lean();
	var rfaCount = 0;
	var ufaCount = 0;
	
	expiringContracts.forEach(function(c) {
		if (!c.startYear || !c.endYear) {
			ufaCount++; // FA contract
		} else {
			var contractLength = c.endYear - c.startYear + 1;
			if (contractLength >= 2 && contractLength <= 3) {
				rfaCount++;
			} else {
				ufaCount++;
			}
		}
	});
	
	response.render('advance-season', {
		config: config,
		newSeason: newSeason,
		defaults: defaults,
		franchises: franchiseList,
		pickCount: franchiseList.length * 10, // 10 rounds
		rfaCount: rfaCount,
		ufaCount: ufaCount,
		activePage: 'admin'
	});
}

// POST /admin/advance-season - execute rollover
async function advanceSeason(request, response) {
	var config = await LeagueConfig.findById('pso');
	if (!config) {
		return response.status(404).json({ error: 'Config not found' });
	}
	
	var body = request.body;
	var newSeason = config.season + 1;
	var pickSeason = newSeason + 2; // Create picks for season+2
	
	// Get franchises
	var franchises = await Franchise.find({}).lean();
	
	// Validate draft order: each slot 1-12 must appear exactly once
	var slots = [];
	for (var i = 0; i < franchises.length; i++) {
		var franchise = franchises[i];
		var slot = parseInt(body['draftOrder_' + franchise._id.toString()], 10);
		if (isNaN(slot) || slot < 1 || slot > 12) {
			return response.status(400).json({ error: 'Invalid draft slot for franchise ' + franchise._id });
		}
		if (slots.includes(slot)) {
			return response.status(400).json({ error: 'Draft slot ' + slot + ' is assigned to multiple franchises' });
		}
		slots.push(slot);
	}
	if (slots.length !== 12) {
		return response.status(400).json({ error: 'Expected 12 draft slots, got ' + slots.length });
	}
	
	// 1. Create 120 picks for season+2 (10 rounds × 12 franchises)
	var picksCreated = 0;
	for (var round = 1; round <= 10; round++) {
		for (var i = 0; i < franchises.length; i++) {
			var franchise = franchises[i];
			
			// Check if pick already exists
			var existing = await Pick.findOne({
				season: pickSeason,
				round: round,
				originalFranchiseId: franchise._id
			});
			
			if (!existing) {
				await Pick.create({
					season: pickSeason,
					round: round,
					originalFranchiseId: franchise._id,
					currentFranchiseId: franchise._id,
					status: 'available'
				});
				picksCreated++;
			}
		}
	}
	
	// 2. Create Budget for season+2
	var budgetsCreated = 0;
	for (var i = 0; i < franchises.length; i++) {
		var franchise = franchises[i];
		
		var existing = await Budget.findOne({
			franchiseId: franchise._id,
			season: pickSeason
		});
		
		if (!existing) {
			await Budget.create({
				franchiseId: franchise._id,
				season: pickSeason,
				baseAmount: 1000,
				payroll: 0,
				buyOuts: 0,
				cashIn: 0,
				cashOut: 0,
				available: 1000
			});
			budgetsCreated++;
		}
	}
	
	// 3. Process expiring contracts
	var expiringContracts = await Contract.find({ endYear: config.season });
	var rfaConverted = 0;
	var ufaDeleted = 0;
	
	// RFA/contract-expiry timestamp: January 15 at 12:00:00 ET
	var expiryTimestamp = new Date(Date.UTC(newSeason, 0, 15, 17, 0, 0));
	
	for (var i = 0; i < expiringContracts.length; i++) {
		var contract = expiringContracts[i];
		
		var contractLength = (contract.startYear && contract.endYear) 
			? (contract.endYear - contract.startYear + 1) 
			: 1;
		
		if (contractLength >= 2 && contractLength <= 3) {
			// Convert to RFA rights - create transaction record if one doesn't already exist
			var existingConversion = await Transaction.findOne({
				type: 'rfa-rights-conversion',
				playerId: contract.playerId,
				timestamp: { $gte: new Date(newSeason, 0, 1), $lt: new Date(newSeason, 1, 1) }
			});
			
			if (!existingConversion) {
				await Transaction.create({
					type: 'rfa-rights-conversion',
					timestamp: expiryTimestamp,
					source: 'manual',
					franchiseId: contract.franchiseId,
					playerId: contract.playerId,
					salary: contract.salary,
					startYear: contract.startYear,
					endYear: contract.endYear
				});
			}
			
			// Update contract to RFA-only state
			contract.salary = null;
			contract.startYear = null;
			contract.endYear = null;
			await contract.save();
			rfaConverted++;
		} else {
			// Contract expires without RFA - create transaction record if one doesn't already exist
			var existingExpiry = await Transaction.findOne({
				type: 'contract-expiry',
				playerId: contract.playerId,
				timestamp: { $gte: new Date(newSeason, 0, 1), $lt: new Date(newSeason, 1, 1) }
			});
			
			if (!existingExpiry) {
				await Transaction.create({
					type: 'contract-expiry',
					timestamp: new Date(expiryTimestamp.getTime() + 1000), // 1 second later for ordering
					source: 'manual',
					franchiseId: contract.franchiseId,
					playerId: contract.playerId,
					salary: contract.salary,
					startYear: contract.startYear,
					endYear: contract.endYear
				});
			}
			
			// Delete contract (player becomes UFA)
			await Contract.deleteOne({ _id: contract._id });
			ufaDeleted++;
		}
	}
	
	// 4. Set draft order for newSeason picks
	var draftOrderPicks = await Pick.find({ season: newSeason });
	for (var i = 0; i < draftOrderPicks.length; i++) {
		var pick = draftOrderPicks[i];
		var franchiseId = pick.originalFranchiseId.toString();
		var slot = parseInt(body['draftOrder_' + franchiseId], 10);
		
		if (slot >= 1 && slot <= 12) {
			// pickNumber = (round - 1) * 12 + slot
			pick.pickNumber = (pick.round - 1) * 12 + slot;
			await pick.save();
		}
	}
	
	// 5. Update LeagueConfig
	var defaults = LeagueConfig.computeDefaultDates(newSeason);
	
	config.season = newSeason;
	config.tradeWindow = body.tradeWindow ? new Date(body.tradeWindow) : defaults.tradeWindow;
	config.nflDraft = body.nflDraft ? new Date(body.nflDraft) : defaults.nflDraft;
	config.cutDay = body.cutDay ? new Date(body.cutDay) : defaults.cutDay;
	config.cutDayTentative = true;
	config.draftDay = body.draftDay ? new Date(body.draftDay) : defaults.draftDay;
	config.draftDayTentative = true;
	config.contractsDue = body.contractsDue ? new Date(body.contractsDue) : defaults.contractsDue;
	config.contractsDueTentative = true;
	config.nflSeason = body.nflSeason ? new Date(body.nflSeason) : defaults.nflSeason;
	config.faab = body.faab ? new Date(body.faab) : defaults.faab;
	config.tradeDeadline = body.tradeDeadline ? new Date(body.tradeDeadline) : defaults.tradeDeadline;
	config.playoffs = body.playoffs ? new Date(body.playoffs) : defaults.playoffs;
	config.deadPeriod = body.deadPeriod ? new Date(body.deadPeriod) : defaults.deadPeriod;
	
	await config.save();
	
	// 6. Reset cut marks for new offseason (everyone starts fresh)
	await Contract.updateMany(
		{},
		{ $set: { markedForCut: false, markedForCutAt: null } }
	);
	
	response.redirect('/admin');
}

// GET /admin/transfer-franchise - show transfer form
async function transferFranchiseForm(request, response) {
	var config = await LeagueConfig.findById('pso');
	var currentSeason = config ? config.season : new Date().getFullYear();
	
	// Get all franchises with their current regimes
	var franchises = await Franchise.find({}).lean();
	var regimes = await Regime.find({
		'tenures.endSeason': null
	}).populate('ownerIds').lean();
	
	var franchiseList = franchises.map(function(f) {
		var fIdStr = f._id.toString();
		var regime = regimes.find(function(r) {
			return r.tenures.some(function(t) {
				return t.franchiseId.toString() === fIdStr && t.endSeason === null;
			});
		});
		var ownerNames = regime && regime.ownerIds 
			? Regime.sortOwnerNames(regime.ownerIds).join(', ')
			: 'Unknown';
		return {
			id: f._id.toString(),
			displayName: regime ? regime.displayName : 'Unknown',
			owners: ownerNames,
			rosterId: f.rosterId
		};
	}).sort(function(a, b) {
		return a.displayName.localeCompare(b.displayName);
	});
	
	// Get all people for autocomplete
	var people = await Person.find({}).sort({ name: 1 }).lean();
	
	response.render('transfer-franchise', {
		franchises: franchiseList,
		people: people,
		currentSeason: currentSeason,
		activePage: 'admin'
	});
}

// POST /admin/transfer-franchise - execute transfer
async function transferFranchise(request, response) {
	var body = request.body;
	var franchiseId = body.franchiseId;
	var newOwnerName = (body.newOwnerName || '').trim();
	var newDisplayName = (body.newDisplayName || '').trim();
	var effectiveSeason = parseInt(body.effectiveSeason, 10);
	
	// Validation
	if (!franchiseId) {
		return response.status(400).json({ error: 'Franchise is required' });
	}
	if (!newOwnerName) {
		return response.status(400).json({ error: 'New owner name is required' });
	}
	if (!newDisplayName) {
		return response.status(400).json({ error: 'New display name is required' });
	}
	if (isNaN(effectiveSeason)) {
		return response.status(400).json({ error: 'Effective season is required' });
	}
	
	// Find or create the person
	var person = await Person.findOne({ name: newOwnerName });
	if (!person) {
		var username = Person.generateUsername(newOwnerName);
		person = await Person.create({ name: newOwnerName, username: username });
	}
	
	// End the current tenure for this franchise
	var currentRegime = await Regime.findOne({
		'tenures': {
			$elemMatch: {
				franchiseId: franchiseId,
				endSeason: null
			}
		}
	});
	
	if (currentRegime) {
		// Find and update the specific tenure
		currentRegime.tenures.forEach(function(t) {
			if (t.franchiseId.toString() === franchiseId && t.endSeason === null) {
				t.endSeason = effectiveSeason - 1;
			}
		});
		await currentRegime.save();
	}
	
	// Find or create the new regime (by displayName)
	var newRegime = await Regime.findOne({ displayName: newDisplayName });
	
	if (newRegime) {
		// Add new tenure to existing regime
		newRegime.tenures.push({
			franchiseId: franchiseId,
			startSeason: effectiveSeason,
			endSeason: null
		});
		// Update ownerIds if needed
		if (!newRegime.ownerIds.some(function(id) { return id.equals(person._id); })) {
			newRegime.ownerIds.push(person._id);
		}
		await newRegime.save();
	} else {
		// Create new regime
		await Regime.create({
			displayName: newDisplayName,
			ownerIds: [person._id],
			tenures: [{
				franchiseId: franchiseId,
				startSeason: effectiveSeason,
				endSeason: null
			}]
		});
	}
	
	response.redirect('/admin');
}

// GET /admin/rosters - show all rosters with cut buttons
async function rostersPage(request, response) {
	var config = await LeagueConfig.findById('pso');
	var season = config ? config.season : new Date().getFullYear();
	var phase = config ? config.getPhase() : 'unknown';
	
	// Get all franchises with current regimes
	var franchises = await Franchise.find({}).lean();
	var regimes = await Regime.find({}).lean();
	
	// Get all active contracts with player data
	var contracts = await Contract.find({
		endYear: { $gte: season }
	}).populate('playerId').lean();
	
	// Build franchise list with rosters
	var franchiseList = franchises.map(function(f) {
		var fIdStr = f._id.toString();
		var regime = regimes.find(function(r) {
			return r.tenures.some(function(t) {
				return t.franchiseId.toString() === fIdStr &&
					t.startSeason <= season &&
					(t.endSeason === null || t.endSeason >= season);
			});
		});
		
		// Get this franchise's players
		var roster = contracts
			.filter(function(c) { return c.franchiseId.equals(f._id); })
			.map(function(c) {
				var contract = null;
				if (c.salary !== null && c.endYear) {
					contract = formatContractYears(c.startYear, c.endYear);
				}
				
				return {
					playerId: c.playerId ? c.playerId._id.toString() : null,
					name: c.playerId ? c.playerId.name : 'Unknown',
					positions: c.playerId ? c.playerId.positions : [],
					salary: c.salary,
					contract: contract
				};
			})
			.sort(function(a, b) {
				return a.name.localeCompare(b.name);
			});
		
		return {
			_id: f._id.toString(),
			displayName: regime ? regime.displayName : 'Unknown',
			roster: roster
		};
	}).sort(function(a, b) {
		return a.displayName.localeCompare(b.displayName);
	});
	
	// Check for flash message from cut operation
	var cutResult = request.query.cutResult ? JSON.parse(decodeURIComponent(request.query.cutResult)) : null;
	
	response.render('admin-rosters', {
		franchises: franchiseList,
		currentSeason: season,
		phase: phase,
		cutResult: cutResult,
		activePage: 'admin'
	});
}

// GET /admin/sanity - sanity check dashboard
async function sanityPage(request, response) {
	var config = await LeagueConfig.findById('pso');
	var currentSeason = config ? config.season : new Date().getFullYear();
	
	// Get all franchises with their display names
	var franchises = await Franchise.find({}).lean();
	var regimes = await Regime.find({}).lean();
	var franchiseIds = new Set(franchises.map(function(f) { return f._id.toString(); }));
	
	var franchiseMap = {};
	franchises.forEach(function(f) {
		var fIdStr = f._id.toString();
		var regime = regimes.find(function(r) {
			return r.tenures.some(function(t) {
				return t.franchiseId.toString() === fIdStr &&
					t.startSeason <= currentSeason &&
					(t.endSeason === null || t.endSeason >= currentSeason);
			});
		});
		franchiseMap[fIdStr] = {
			_id: f._id,
			displayName: regime ? regime.displayName : 'Unknown'
		};
	});
	
	var expectedFranchiseCount = franchises.length;
	
	// ========== Roster Check ==========
	// Count active contracts per franchise (salary !== null means active)
	var allContracts = await Contract.find({}).lean();
	var activeContracts = allContracts.filter(function(c) { return c.salary !== null; });
	
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
			franchiseName: franchise.displayName,
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
		return b.count - a.count; // Sort by count descending
	});
	
	// ========== Budget Check ==========
	// Get all budgets for current and future seasons
	var budgets = await Budget.find({
		season: { $gte: currentSeason }
	}).lean();
	
	// Group by season
	var budgetsBySeason = {};
	budgets.forEach(function(b) {
		if (!budgetsBySeason[b.season]) {
			budgetsBySeason[b.season] = [];
		}
		budgetsBySeason[b.season].push(b);
	});
	
	var expectedTotalBase = expectedFranchiseCount * 1000; // $12,000
	
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
			
			// Verify formula: available = baseAmount - payroll - buyOuts + cashIn - cashOut
			var expectedAvailable = (b.baseAmount || 0) - (b.payroll || 0) - (b.buyOuts || 0) + (b.cashIn || 0) - (b.cashOut || 0);
			if (b.available !== expectedAvailable) {
				var franchise = franchiseMap[b.franchiseId.toString()];
				check.formulaErrors.push({
					franchiseName: franchise ? franchise.displayName : 'Unknown',
					actual: b.available,
					expected: expectedAvailable,
					diff: b.available - expectedAvailable
				});
			}
		});
		
		// Check: all franchises have budgets
		if (check.franchiseCount !== expectedFranchiseCount) {
			check.problems.push('Missing budgets: ' + check.franchiseCount + '/' + expectedFranchiseCount + ' franchises');
		}
		
		// Check: base amounts total to expected
		if (check.totalBase !== expectedTotalBase) {
			check.problems.push('Base amount drift: $' + check.totalBase + ' (expected $' + expectedTotalBase + ')');
		}
		
		// Check: cash in = cash out (money conservation)
		if (check.totalCashIn !== check.totalCashOut) {
			check.problems.push('Cash imbalance: $' + check.totalCashIn + ' in vs $' + check.totalCashOut + ' out');
		}
		
		// Check: total money accounted for
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
	var expectedPicksPerSeason = expectedFranchiseCount * 10; // 12 franchises × 10 rounds = 120
	
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
		
		// Check count
		if (check.pickCount !== expectedPicksPerSeason) {
			check.problems.push('Wrong pick count: ' + check.pickCount + ' (expected ' + expectedPicksPerSeason + ')');
		}
		
		// Check each round has correct number of picks
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
		
		// Check all currentFranchiseIds are valid
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
	// Verify stored payroll matches calculated payroll from contracts
	var payrollProblems = [];
	var payrollChecks = [];
	
	budgets.forEach(function(b) {
		var season = b.season;
		var fIdStr = b.franchiseId.toString();
		var franchise = franchiseMap[fIdStr];
		
		// Calculate payroll from contracts active in this season
		var calculatedPayroll = 0;
		allContracts.forEach(function(c) {
			if (c.franchiseId.toString() !== fIdStr) return;
			if (c.salary === null) return; // RFA rights
			if (c.endYear && c.endYear < season) return; // Contract ended
			if (c.startYear && c.startYear > season) return; // Contract hasn't started
			calculatedPayroll += c.salary;
		});
		
		if (b.payroll !== calculatedPayroll) {
			payrollProblems.push({
				franchiseName: franchise ? franchise.displayName : 'Unknown',
				season: season,
				stored: b.payroll,
				calculated: calculatedPayroll,
				diff: b.payroll - calculatedPayroll
			});
		}
	});
	
	payrollChecks = {
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
		
		// Check player exists
		if (!playerIds.has(c.playerId.toString())) {
			problems.push('references non-existent player');
		}
		
		// Check franchise exists
		if (!franchiseIds.has(c.franchiseId.toString())) {
			problems.push('references non-existent franchise');
		}
		
		// For active contracts (not RFA rights)
		if (c.salary !== null) {
			// Check year range makes sense
			if (c.startYear && c.endYear && c.startYear > c.endYear) {
				problems.push('startYear > endYear');
			}
			
			// Check contract is still valid (endYear >= current season)
			// Note: Expired contracts should have been cleaned up during rollover
			if (c.endYear && c.endYear < currentSeason) {
				problems.push('expired contract (endYear ' + c.endYear + ' < current ' + currentSeason + ')');
			}
		}
		
		if (problems.length > 0) {
			var player = players.find(function(p) { return p._id.toString() === c.playerId.toString(); });
			contractProblems.push({
				playerId: c.playerId.toString(),
				playerName: player ? player.name : 'Unknown',
				franchiseName: franchiseMap[c.franchiseId.toString()]?.displayName || 'Unknown',
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
	var rfaContracts = allContracts.filter(function(c) { return c.salary === null; });
	var rfaProblems = [];
	
	rfaContracts.forEach(function(c) {
		var problems = [];
		
		// RFA rights should have null salary, startYear, endYear
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
				franchiseName: franchiseMap[c.franchiseId.toString()]?.displayName || 'Unknown',
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
		
		// Find all active tenures for this franchise
		var activeTenures = [];
		regimes.forEach(function(r) {
			r.tenures.forEach(function(t) {
				if (t.franchiseId.toString() === fIdStr && t.endSeason === null) {
					activeTenures.push({
						regimeName: r.displayName
					});
				}
			});
		});
		
		if (activeTenures.length === 0) {
			regimeProblems.push({
				franchiseId: fIdStr,
				franchiseName: franchiseMap[fIdStr]?.displayName || 'Unknown (ID: ' + fIdStr + ')',
				problem: 'No active regime'
			});
		} else if (activeTenures.length > 1) {
			regimeProblems.push({
				franchiseId: fIdStr,
				franchiseName: franchiseMap[fIdStr]?.displayName || 'Unknown',
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
	// Used picks should have a transactionId (draft-select transaction)
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
		
		// Count assets sent and received for each type
		var playersSent = [];
		var playersReceived = [];
		var picksSent = [];
		var picksReceived = [];
		var cashSent = [];
		var cashReceived = [];
		var rfaSent = [];
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
						picksReceived.push(p.season + '-' + p.round + '-' + p.fromFranchiseId.toString());
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
		
		// In a valid trade, everything received by one party should equal what's sent by other parties
		// For simplicity, we'll just check that there's at least something exchanged
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
		futureBudgetChecks.isHealthy;
	
	var problemCount = rosterProblems.length +
		budgetProblems.length +
		pickProblems.length +
		payrollProblems.length +
		contractProblems.length +
		rfaProblems.length +
		regimeProblems.length +
		pickStatusProblems.length +
		tradeProblems.length +
		missingBudgetSeasons.length;
	
	response.render('admin-sanity', {
		currentSeason: currentSeason,
		allHealthy: allHealthy,
		problemCount: problemCount,
		
		// Roster
		rosterChecks: rosterChecks,
		rosterProblems: rosterProblems,
		rosterLimit: LeagueConfig.ROSTER_LIMIT,
		
		// Budget
		budgetChecks: budgetChecks,
		budgetProblems: budgetProblems,
		expectedTotalBase: expectedTotalBase,
		
		// Picks
		pickChecks: pickChecks,
		pickProblems: pickProblems,
		expectedPicksPerSeason: expectedPicksPerSeason,
		
		// Payroll accuracy
		payrollChecks: payrollChecks,
		payrollProblems: payrollProblems,
		
		// Contract validity
		contractChecks: contractChecks,
		contractProblems: contractProblems,
		
		// RFA shape
		rfaChecks: rfaChecks,
		rfaProblems: rfaProblems,
		
		// Regime coverage
		regimeChecks: regimeChecks,
		regimeProblems: regimeProblems,
		
		// Pick status
		pickStatusChecks: pickStatusChecks,
		pickStatusProblems: pickStatusProblems,
		
		// Trade balance
		tradeChecks: tradeChecks,
		tradeProblems: tradeProblems,
		
		// Future budgets
		futureBudgetChecks: futureBudgetChecks,
		
		activePage: 'admin'
	});
}

// POST /admin/rosters/cut - cut a player
async function cutPlayer(request, response) {
	var franchiseId = request.body.franchiseId;
	var playerId = request.body.playerId;
	var playerName = request.body.playerName;
	
	if (!franchiseId || !playerId) {
		var errorResult = encodeURIComponent(JSON.stringify({ success: false, error: 'Missing franchise or player ID' }));
		return response.redirect('/admin/rosters?cutResult=' + errorResult);
	}
	
	var result = await transactionService.processCut({
		franchiseId: franchiseId,
		playerId: playerId,
		source: 'manual',
		notes: null
	});
	
	if (result.success) {
		var successResult = encodeURIComponent(JSON.stringify({
			success: true,
			playerName: playerName,
			buyOuts: result.buyOuts
		}));
		response.redirect('/admin/rosters?cutResult=' + successResult);
	} else {
		var errorResult = encodeURIComponent(JSON.stringify({
			success: false,
			error: result.errors ? result.errors.join(', ') : 'Unknown error'
		}));
		response.redirect('/admin/rosters?cutResult=' + errorResult);
	}
}

// GET /admin/transactions - recent transaction log
async function transactionsPage(request, response) {
	var typeFilter = request.query.type || '';
	var sourceFilter = request.query.source || '';
	var page = Math.max(1, parseInt(request.query.page, 10) || 1);
	var perPage = 50;

	var query = {};
	if (typeFilter) {
		query.type = typeFilter;
	}
	if (sourceFilter) {
		query.source = sourceFilter;
	}

	var totalCount = await Transaction.countDocuments(query);
	var transactions = await Transaction.find(query)
		.sort({ timestamp: -1 })
		.skip((page - 1) * perPage)
		.limit(perPage)
		.populate('playerId')
		.populate('franchiseId')
		.populate('adds.playerId')
		.populate('drops.playerId')
		.populate('parties.franchiseId')
		.lean();

	// Collect all franchise IDs to resolve regime names
	var franchiseIds = new Set();
	transactions.forEach(function(t) {
		if (t.franchiseId) franchiseIds.add(t.franchiseId._id ? t.franchiseId._id.toString() : t.franchiseId.toString());
		if (t.parties) {
			t.parties.forEach(function(p) {
				if (p.franchiseId) franchiseIds.add(p.franchiseId._id ? p.franchiseId._id.toString() : p.franchiseId.toString());
			});
		}
	});

	// Build franchise display name map
	var regimes = await Regime.find({}).lean();
	var config = await LeagueConfig.findById('pso');
	var season = config ? config.season : new Date().getFullYear();

	var franchiseNameMap = {};
	franchiseIds.forEach(function(fIdStr) {
		var regime = regimes.find(function(r) {
			return r.tenures.some(function(t) {
				return t.franchiseId.toString() === fIdStr &&
					t.startSeason <= season &&
					(t.endSeason === null || t.endSeason >= season);
			});
		});
		franchiseNameMap[fIdStr] = regime ? regime.displayName : 'Unknown';
	});

	// Build display data for each transaction
	var displayTransactions = transactions.map(function(t) {
		var franchiseName = null;
		if (t.franchiseId && t.franchiseId._id) {
			franchiseName = franchiseNameMap[t.franchiseId._id.toString()];
		}

		var playerName = null;
		if (t.playerId && t.playerId.name) {
			playerName = t.playerId.name;
		}

		// Build a summary string
		var summary = buildTransactionSummary(t, franchiseNameMap);

		return {
			_id: t._id.toString(),
			type: t.type,
			timestamp: t.timestamp,
			source: t.source,
			notes: t.notes,
			franchiseName: franchiseName,
			playerName: playerName,
			tradeId: t.tradeId,
			summary: summary
		};
	});

	// Get distinct types and sources for filter dropdowns
	var allTypes = [
		'trade', 'fa', 'draft-select', 'draft-pass',
		'expansion-draft-protect', 'expansion-draft-select',
		'auction-ufa', 'auction-rfa-matched', 'auction-rfa-unmatched',
		'rfa-rights-conversion', 'rfa-rights-lapsed', 'rfa-unknown',
		'unknown', 'contract-expiry', 'contract'
	];
	var allSources = ['wordpress', 'sleeper', 'fantrax', 'manual', 'snapshot', 'cuts', 'exception'];

	var totalPages = Math.ceil(totalCount / perPage);

	response.render('admin-transactions', {
		transactions: displayTransactions,
		typeFilter: typeFilter,
		sourceFilter: sourceFilter,
		allTypes: allTypes,
		allSources: allSources,
		page: page,
		totalPages: totalPages,
		totalCount: totalCount,
		perPage: perPage,
		activePage: 'admin'
	});
}

function buildTransactionSummary(t, franchiseNameMap) {
	switch (t.type) {
		case 'trade':
			if (t.parties && t.parties.length >= 2) {
				var names = t.parties.map(function(p) {
					var fId = p.franchiseId && p.franchiseId._id ? p.franchiseId._id.toString() : (p.franchiseId ? p.franchiseId.toString() : null);
					return p.regimeName || (fId ? franchiseNameMap[fId] : null) || 'Unknown';
				});
				return 'Trade #' + (t.tradeId || '?') + ': ' + names.join(' ↔ ');
			}
			return 'Trade #' + (t.tradeId || '?');

		case 'fa':
			var parts = [];
			if (t.adds && t.adds.length > 0) {
				var addNames = t.adds.map(function(a) {
					return a.playerId && a.playerId.name ? a.playerId.name : '?';
				});
				parts.push('Add ' + addNames.join(', '));
			}
			if (t.drops && t.drops.length > 0) {
				var dropNames = t.drops.map(function(d) {
					return d.playerId && d.playerId.name ? d.playerId.name : '?';
				});
				parts.push('Drop ' + dropNames.join(', '));
			}
			var faFranchise = t.franchiseId && t.franchiseId._id ? franchiseNameMap[t.franchiseId._id.toString()] : null;
			if (faFranchise) {
				parts.push('(' + faFranchise + ')');
			}
			return parts.join(' · ') || 'FA transaction';

		case 'draft-select':
			return (t.playerId && t.playerId.name ? t.playerId.name : '?') + ' drafted by ' +
				(t.franchiseId && t.franchiseId._id ? franchiseNameMap[t.franchiseId._id.toString()] : '?');

		case 'draft-pass':
			return (t.franchiseId && t.franchiseId._id ? franchiseNameMap[t.franchiseId._id.toString()] : '?') + ' passed';

		case 'auction-ufa':
		case 'auction-rfa-matched':
		case 'auction-rfa-unmatched':
			return (t.playerId && t.playerId.name ? t.playerId.name : '?') +
				(t.winningBid ? ' for $' + t.winningBid : '') +
				' to ' + (t.franchiseId && t.franchiseId._id ? franchiseNameMap[t.franchiseId._id.toString()] : '?');

		case 'rfa-rights-conversion':
			return (t.playerId && t.playerId.name ? t.playerId.name : '?') + ' → RFA rights' +
				(t.franchiseId && t.franchiseId._id ? ' (' + franchiseNameMap[t.franchiseId._id.toString()] + ')' : '');

		case 'rfa-rights-lapsed':
			return (t.playerId && t.playerId.name ? t.playerId.name : '?') + ' RFA rights lapsed';

		case 'contract-expiry':
			return (t.playerId && t.playerId.name ? t.playerId.name : '?') + ' contract expired → UFA';

		case 'contract':
			return (t.playerId && t.playerId.name ? t.playerId.name : '?') +
				(t.salary ? ' $' + t.salary : '') +
				(t.franchiseId && t.franchiseId._id ? ' (' + franchiseNameMap[t.franchiseId._id.toString()] + ')' : '');

		case 'expansion-draft-select':
			return (t.playerId && t.playerId.name ? t.playerId.name : '?') + ' selected' +
				(t.franchiseId && t.franchiseId._id ? ' by ' + franchiseNameMap[t.franchiseId._id.toString()] : '');

		case 'expansion-draft-protect':
			return (t.playerId && t.playerId.name ? t.playerId.name : '?') + ' protected' +
				(t.franchiseId && t.franchiseId._id ? ' by ' + franchiseNameMap[t.franchiseId._id.toString()] : '');

		default:
			if (t.playerId && t.playerId.name) {
				return t.playerId.name;
			}
			return '';
	}
}

module.exports = {
	configPage: configPage,
	updateConfig: updateConfig,
	advanceSeasonForm: advanceSeasonForm,
	advanceSeason: advanceSeason,
	transferFranchiseForm: transferFranchiseForm,
	transferFranchise: transferFranchise,
	rostersPage: rostersPage,
	cutPlayer: cutPlayer,
	sanityPage: sanityPage,
	transactionsPage: transactionsPage
};
