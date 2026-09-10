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
var rollbackService = require('./rollback');
var tz = require('../helpers/timezone');
var { formatContractYears, getPositionIndex } = require('../helpers/view');
var { isRfaRights, isSigned, affectsBudget } = require('../helpers/contract');
var { getRegime, getRegimeName, buildRegimeMap } = require('../helpers/regime');
var sleeper = require('../helpers/sleeper');

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

// GET /admin/schedule - show league schedule configuration
async function schedulePage(request, response) {
	var config = await LeagueConfig.findById('pso');
	if (!config) {
		config = new LeagueConfig({ _id: 'pso', season: currentSeason });
		await config.save();
	}
	
	response.render('admin-schedule', {
		config: config,
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
	
	// Update dates - store as actual deadline timestamps in UTC
	// Different dates have different conventional times:
	//   - cutDay: 11:59pm ET (cuts due by end of day)
	//   - tradeDeadline: 9pm ET
	//   - Other dates: midnight ET (phase changes at start of day)
	var dateConverters = {
		cutDay: tz.toEndOfDayET,
		tradeDeadline: tz.to9pmET
	};
	var defaultConverter = tz.toMidnightET;
	
	var dateFields = [
		'tradeWindow', 'nflDraft', 'cutDay', 'draftDay', 'contractsDue',
		'nflSeason', 'faab', 'tradeDeadline', 'playoffs', 'deadPeriod'
	];
	
	dateFields.forEach(function(field) {
		if (body[field] !== undefined) {
			var converter = dateConverters[field] || defaultConverter;
			config[field] = body[field] ? converter(body[field]) : null;
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
	
	var franchises = await Franchise.find({}).lean();
	var regimes = await Regime.find({}).lean();
	var regimeMap = buildRegimeMap(regimes, newSeason);
	
	var franchiseList = franchises.map(function(f) {
		var fIdStr = f._id.toString();
		return {
			id: fIdStr,
			name: regimeMap[fIdStr] || 'Unknown'
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
	// Defaults already have correct timestamps; form inputs need conversion
	var defaults = LeagueConfig.computeDefaultDates(newSeason);
	
	config.season = newSeason;
	config.tradeWindow = body.tradeWindow ? tz.toMidnightET(body.tradeWindow) : defaults.tradeWindow;
	config.nflDraft = body.nflDraft ? tz.toMidnightET(body.nflDraft) : defaults.nflDraft;
	config.cutDay = body.cutDay ? tz.toEndOfDayET(body.cutDay) : defaults.cutDay;
	config.cutDayTentative = true;
	config.draftDay = body.draftDay ? tz.toMidnightET(body.draftDay) : defaults.draftDay;
	config.draftDayTentative = true;
	config.contractsDue = body.contractsDue ? tz.toMidnightET(body.contractsDue) : defaults.contractsDue;
	config.contractsDueTentative = true;
	config.nflSeason = body.nflSeason ? tz.toMidnightET(body.nflSeason) : defaults.nflSeason;
	config.faab = body.faab ? tz.toMidnightET(body.faab) : defaults.faab;
	config.tradeDeadline = body.tradeDeadline ? tz.to9pmET(body.tradeDeadline) : defaults.tradeDeadline;
	config.playoffs = body.playoffs ? tz.toMidnightET(body.playoffs) : defaults.playoffs;
	config.deadPeriod = body.deadPeriod ? tz.toMidnightET(body.deadPeriod) : defaults.deadPeriod;
	
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
		var regime = getRegime(regimes, fIdStr, currentSeason);
		var ownerNames = regime && regime.ownerIds 
			? Regime.sortOwnerNames(regime.ownerIds)
			: [];
		return {
			id: fIdStr,
			displayName: regime ? regime.displayName : 'Unknown',
			ownerList: ownerNames,
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
	var newDisplayName = (body.newDisplayName || '').trim();
	var effectiveSeason = parseInt(body.effectiveSeason, 10);

	// Normalize ownerNames to an array
	var rawOwnerNames = body.ownerNames || [];
	if (typeof rawOwnerNames === 'string') {
		rawOwnerNames = [rawOwnerNames];
	}
	var ownerNames = rawOwnerNames
		.map(function(n) { return (n || '').trim(); })
		.filter(function(n) { return n.length > 0; });
	
	// Validation
	if (!franchiseId) {
		return response.status(400).json({ error: 'Franchise is required' });
	}
	if (ownerNames.length === 0) {
		return response.status(400).json({ error: 'At least one owner is required' });
	}
	if (!newDisplayName) {
		return response.status(400).json({ error: 'New display name is required' });
	}
	if (isNaN(effectiveSeason)) {
		return response.status(400).json({ error: 'Effective season is required' });
	}
	
	// Find or create Person records for each owner
	var ownerIds = [];
	for (var i = 0; i < ownerNames.length; i++) {
		var name = ownerNames[i];
		var person = await Person.findOne({ name: name });
		if (!person) {
			var username = Person.generateUsername(name);
			person = await Person.create({ name: name, username: username });
		}
		ownerIds.push(person._id);
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
		newRegime.tenures.push({
			franchiseId: franchiseId,
			startSeason: effectiveSeason,
			endSeason: null
		});
		ownerIds.forEach(function(ownerId) {
			if (!newRegime.ownerIds.some(function(id) { return id.equals(ownerId); })) {
				newRegime.ownerIds.push(ownerId);
			}
		});
		await newRegime.save();
	} else {
		await Regime.create({
			displayName: newDisplayName,
			ownerIds: ownerIds,
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
	
	var franchises = await Franchise.find({}).lean();
	var regimes = await Regime.find({}).lean();
	var regimeMap = buildRegimeMap(regimes, season);
	
	var contracts = await Contract.find({
		endYear: { $gte: season }
	}).populate('playerId').lean();
	
	var markedContracts = contracts.filter(function(c) {
		return c.markedForCut && !isRfaRights(c);
	});
	var markedCount = markedContracts.length;
	
	var franchiseList = franchises.map(function(f) {
		var fIdStr = f._id.toString();
		
		// Get this franchise's players
		var roster = contracts
			.filter(function(c) { return c.franchiseId.equals(f._id); })
			.map(function(c) {
				var contract = null;
				if (isSigned(c)) {
					contract = formatContractYears(c.startYear, c.endYear);
				}
				
				return {
					playerId: c.playerId ? c.playerId._id.toString() : null,
					name: c.playerId ? c.playerId.name : 'Unknown',
					positions: c.playerId ? c.playerId.positions : [],
					salary: c.salary,
					contract: contract,
					markedForCut: c.markedForCut || false
				};
			})
			.sort(function(a, b) {
				return a.name.localeCompare(b.name);
			});
		
		return {
			_id: fIdStr,
			displayName: regimeMap[fIdStr] || 'Unknown',
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
		markedCount: markedCount,
		activePage: 'admin'
	});
}

// GET /admin/sanity - sanity check dashboard
async function sanityPage(request, response) {
	var sanityService = require('./sanity');
	var results = await sanityService.runAllChecks();
	
	response.render('admin-sanity', Object.assign({}, results, {
		activePage: 'admin'
	}));
}

// POST /admin/rosters/mark-for-cut - admin toggle mark-for-cut on any player
async function markForCut(request, response) {
	var playerId = request.body.playerId;

	try {
		if (!playerId) {
			return response.status(400).json({ error: 'Missing player ID' });
		}

		var contract = await Contract.findOne({
			playerId: playerId,
			salary: { $ne: null }
		});

		if (!contract) {
			return response.status(404).json({ error: 'Contract not found' });
		}

		contract.markedForCut = !contract.markedForCut;
		contract.markedForCutAt = contract.markedForCut ? new Date() : null;
		await contract.save();

		response.json({
			playerId: playerId,
			markedForCut: contract.markedForCut
		});
	} catch (err) {
		console.error('Admin mark-for-cut error:', err);
		response.status(500).json({ error: 'Server error' });
	}
}

// POST /admin/rosters/process-cut-day - execute all marked cuts at once
async function processCutDay(request, response) {
	var config = await LeagueConfig.findById('pso');
	var season = config ? config.season : new Date().getFullYear();
	
	var markedContracts = await Contract.find({
		markedForCut: true,
		salary: { $ne: null },
		endYear: { $gte: season }
	}).populate('playerId').lean();
	
	if (markedContracts.length === 0) {
		var emptyResult = encodeURIComponent(JSON.stringify({
			success: false,
			error: 'No players are marked for cut'
		}));
		return response.redirect('/admin/rosters?cutResult=' + emptyResult);
	}
	
	var results = [];
	var successCount = 0;
	var failCount = 0;
	
	for (var i = 0; i < markedContracts.length; i++) {
		var contract = markedContracts[i];
		var playerName = contract.playerId ? contract.playerId.name : 'Unknown';
		
		var result = await transactionService.processCut({
			franchiseId: contract.franchiseId,
			playerId: contract.playerId._id,
			source: 'cuts',
			notes: 'Cut day batch processing'
		});
		
		if (result.success) {
			successCount++;
			results.push({ name: playerName, success: true });
		} else {
			failCount++;
			results.push({ name: playerName, success: false, error: result.errors ? result.errors.join(', ') : 'Unknown error' });
		}
	}
	
	var batchResult = encodeURIComponent(JSON.stringify({
		success: failCount === 0,
		batch: true,
		successCount: successCount,
		failCount: failCount,
		results: results
	}));
	response.redirect('/admin/rosters?cutResult=' + batchResult);
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

	var regimes = await Regime.find({}).lean();
	var config = await LeagueConfig.findById('pso');
	var season = config ? config.season : new Date().getFullYear();

	var regimeNameMap = buildRegimeMap(regimes, season);

	// Build display data for each transaction
	var displayTransactions = transactions.map(function(t) {
		var regimeName = null;
		if (t.franchiseId && t.franchiseId._id) {
			regimeName = regimeNameMap[t.franchiseId._id.toString()];
		}

		var playerName = null;
		if (t.playerId && t.playerId.name) {
			playerName = t.playerId.name;
		}

		// Build a summary string
		var summary = buildTransactionSummary(t, regimeNameMap);

		return {
			_id: t._id.toString(),
			type: t.type,
			timestamp: t.timestamp,
			source: t.source,
			notes: t.notes,
			regimeName: regimeName,
			playerName: playerName,
			tradeId: t.tradeId,
			summary: summary,
			canRollback: rollbackService.ROLLBACK_ELIGIBLE_TYPES.includes(t.type)
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
		activePage: 'admin',
		rollbackResult: request.query.rollback || null,
		rollbackMessage: request.query.message || null
	});
}

function buildTransactionSummary(t, regimeNameMap) {
	switch (t.type) {
		case 'trade':
			if (t.parties && t.parties.length >= 2) {
				var names = t.parties.map(function(p) {
					var fId = p.franchiseId && p.franchiseId._id ? p.franchiseId._id.toString() : (p.franchiseId ? p.franchiseId.toString() : null);
					return p.regimeName || (fId ? regimeNameMap[fId] : null) || 'Unknown';
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
			var faFranchise = t.franchiseId && t.franchiseId._id ? regimeNameMap[t.franchiseId._id.toString()] : null;
			if (faFranchise) {
				parts.push('(' + faFranchise + ')');
			}
			return parts.join(' · ') || 'FA transaction';

		case 'draft-select':
			return (t.playerId && t.playerId.name ? t.playerId.name : '?') + ' drafted by ' +
				(t.franchiseId && t.franchiseId._id ? regimeNameMap[t.franchiseId._id.toString()] : '?');

		case 'draft-pass':
			return (t.franchiseId && t.franchiseId._id ? regimeNameMap[t.franchiseId._id.toString()] : '?') + ' passed';

		case 'auction-ufa':
		case 'auction-rfa-matched':
		case 'auction-rfa-unmatched':
			return (t.playerId && t.playerId.name ? t.playerId.name : '?') +
				(t.winningBid ? ' for $' + t.winningBid : '') +
				' to ' + (t.franchiseId && t.franchiseId._id ? regimeNameMap[t.franchiseId._id.toString()] : '?');

		case 'rfa-rights-conversion':
			return (t.playerId && t.playerId.name ? t.playerId.name : '?') + ' → RFA rights' +
				(t.franchiseId && t.franchiseId._id ? ' (' + regimeNameMap[t.franchiseId._id.toString()] + ')' : '');

		case 'rfa-rights-lapsed':
			return (t.playerId && t.playerId.name ? t.playerId.name : '?') + ' RFA rights lapsed';

		case 'contract-expiry':
			return (t.playerId && t.playerId.name ? t.playerId.name : '?') + ' contract expired → UFA';

		case 'contract':
			return (t.playerId && t.playerId.name ? t.playerId.name : '?') +
				(t.salary ? ' $' + t.salary : '') +
				(t.franchiseId && t.franchiseId._id ? ' (' + regimeNameMap[t.franchiseId._id.toString()] + ')' : '');

		case 'expansion-draft-select':
			return (t.playerId && t.playerId.name ? t.playerId.name : '?') + ' selected' +
				(t.franchiseId && t.franchiseId._id ? ' by ' + regimeNameMap[t.franchiseId._id.toString()] : '');

		case 'expansion-draft-protect':
			return (t.playerId && t.playerId.name ? t.playerId.name : '?') + ' protected' +
				(t.franchiseId && t.franchiseId._id ? ' by ' + regimeNameMap[t.franchiseId._id.toString()] : '');

		default:
			if (t.playerId && t.playerId.name) {
				return t.playerId.name;
			}
			return '';
	}
}

async function rollbackTransaction(request, response) {
	var transactionId = request.params.id;
	
	var result = await rollbackService.rollbackTransaction(transactionId);
	
	if (result.success) {
		response.redirect('/admin/transactions?rollback=success');
	} else {
		response.redirect('/admin/transactions?rollback=error&message=' + encodeURIComponent(result.error));
	}
}

// GET /admin/sleeper-transactions - view Sleeper transactions by week
async function sleeperTransactionsPage(request, response) {
	var config = await LeagueConfig.findById('pso');
	var currentSeason = config ? config.season : PSO.season;
	
	// Get available seasons (those with Sleeper league IDs), ascending for nav
	var availableSeasons = Object.keys(PSO.sleeperLeagueIds)
		.map(function(s) { return parseInt(s, 10); })
		.sort(function(a, b) { return a - b; }); // Ascending (left = past)
	
	var season = parseInt(request.query.season, 10) || currentSeason;
	// Validate season is one we have
	if (availableSeasons.indexOf(season) === -1) {
		season = currentSeason;
	}
	
	var currentWeek = PSO.getWeek({ season: currentSeason });
	var week = parseInt(request.query.week, 10) || (season === currentSeason ? currentWeek : 1);

	// Clamp to valid range
	week = Math.max(1, Math.min(17, week));

	var leagueId = sleeper.getLeagueId(season);
	var transactions = [];
	var error = null;

	if (leagueId) {
		try {
			transactions = await sleeper.fetchTransactions(week, season);
			// Sort by created timestamp descending (most recent first)
			transactions.sort(function(a, b) {
				return (b.created || 0) - (a.created || 0);
			});
		} catch (err) {
			error = err.message;
		}
	} else {
		error = 'No Sleeper league ID configured for season ' + season;
	}

	// Build player lookup for displaying names
	var playerIds = new Set();
	transactions.forEach(function(t) {
		if (t.adds) Object.keys(t.adds).forEach(function(id) { playerIds.add(id); });
		if (t.drops) Object.keys(t.drops).forEach(function(id) { playerIds.add(id); });
	});

	var players = await Player.find({ sleeperId: { $in: Array.from(playerIds) } }).lean();
	var playerBySleeperId = {};
	players.forEach(function(p) {
		playerBySleeperId[p.sleeperId] = p;
	});

	// Build franchise lookup by Sleeper roster ID
	var franchises = await Franchise.find({}).lean();
	var regimes = await Regime.find({}).lean();
	var regimeMap = buildRegimeMap(regimes, season);

	var franchiseByRosterId = {};
	franchises.forEach(function(f) {
		if (f.rosterId) {
			franchiseByRosterId[f.rosterId] = {
				_id: f._id,
				displayName: regimeMap[f._id.toString()] || 'Franchise ' + f.rosterId
			};
		}
	});

	// Check which transactions we've already processed (by sleeperTransactionId)
	var sleeperTxnIds = transactions.map(function(t) { return t.transaction_id; }).filter(Boolean);
	var processedTxns = await Transaction.find({ sleeperTransactionId: { $in: sleeperTxnIds } }).lean();
	var processedMap = {};
	processedTxns.forEach(function(t) {
		processedMap[t.sleeperTransactionId] = t._id;
	});

	// Build week array 1-17
	var weeks = [];
	for (var w = 1; w <= 17; w++) {
		weeks.push(w);
	}

	response.render('admin-sleeper-transactions', {
		week: week,
		weeks: weeks,
		currentWeek: currentWeek,
		season: season,
		currentSeason: currentSeason,
		availableSeasons: availableSeasons,
		transactions: transactions,
		playerBySleeperId: playerBySleeperId,
		franchiseByRosterId: franchiseByRosterId,
		processedMap: processedMap,
		error: error,
		activePage: 'admin'
	});
}

// GET /admin/contracts - show pending players with contract choices for all franchises
async function contractsPage(request, response) {
	var config = await LeagueConfig.findById('pso');
	var season = config ? config.season : new Date().getFullYear();

	var franchises = await Franchise.find({}).lean();
	var regimes = await Regime.find({}).lean();

	var pendingContracts = await Contract.find({
		salary: { $ne: null },
		endYear: null
	}).populate('playerId').lean();

	var regimeMap = buildRegimeMap(regimes, season);

	var franchiseList = franchises.map(function(f) {
		var fIdStr = f._id.toString();

		var players = pendingContracts
			.filter(function(c) { return c.franchiseId.toString() === fIdStr; })
			.map(function(c) {
				return {
					playerId: c.playerId ? c.playerId._id.toString() : null,
					name: c.playerId ? c.playerId.name : 'Unknown',
					positions: c.playerId ? c.playerId.positions : [],
					salary: c.salary,
					pendingEndYear: c.pendingEndYear || null,
					pendingYears: c.pendingEndYear ? (c.pendingEndYear - season + 1) : null
				};
			})
			.sort(function(a, b) { return a.name.localeCompare(b.name); });

		return {
			_id: fIdStr,
			displayName: regimeMap[fIdStr] || 'Unknown',
			players: players
		};
	})
	.filter(function(f) { return f.players.length > 0; })
	.sort(function(a, b) { return a.displayName.localeCompare(b.displayName); });

	var totalPending = pendingContracts.length;
	var totalAssigned = pendingContracts.filter(function(c) { return c.pendingEndYear; }).length;

	var processResult = request.query.processResult
		? JSON.parse(decodeURIComponent(request.query.processResult))
		: null;

	response.render('admin-contracts', {
		franchises: franchiseList,
		currentSeason: season,
		totalPending: totalPending,
		totalAssigned: totalAssigned,
		processResult: processResult,
		activePage: 'admin'
	});
}

// POST /admin/contracts/override - admin override of a player's pending contract
async function overrideContract(request, response) {
	var playerId = request.body.playerId;
	var years = parseInt(request.body.years, 10);

	try {
		var config = await LeagueConfig.findById('pso');
		var season = config ? config.season : new Date().getFullYear();

		var contract = await Contract.findOne({
			playerId: playerId,
			salary: { $ne: null },
			endYear: null
		});

		if (!contract) {
			return response.status(404).json({ error: 'Pending contract not found' });
		}

		if (years !== 0 && ![1, 2, 3].includes(years)) {
			return response.status(400).json({ error: 'Contract must be 1, 2, or 3 years (or 0 to clear)' });
		}

		contract.pendingEndYear = years > 0 ? season + years - 1 : null;
		await contract.save();

		response.json({ success: true, pendingEndYear: contract.pendingEndYear });
	} catch (err) {
		console.error('Override contract error:', err);
		response.status(500).json({ error: 'Server error' });
	}
}

// POST /admin/contracts/process - finalize all pending contracts
async function processContracts(request, response) {
	try {
		var config = await LeagueConfig.findById('pso');
		var season = config ? config.season : new Date().getFullYear();
		var budgetHelper = require('../helpers/budget');

		var pendingContracts = await Contract.find({
			salary: { $ne: null },
			endYear: null,
			pendingEndYear: { $ne: null }
		}).populate('playerId').lean();

		var unassignedCount = await Contract.countDocuments({
			salary: { $ne: null },
			endYear: null,
			pendingEndYear: null
		});

		if (unassignedCount > 0) {
			var errorResult = encodeURIComponent(JSON.stringify({
				success: false,
				error: unassignedCount + ' unsigned player' + (unassignedCount !== 1 ? 's' : '') + ' still need contracts'
			}));
			return response.redirect('/admin/contracts?processResult=' + errorResult);
		}

		// Create contract transactions
		var contractTimestamp = config.contractsDue || new Date();
		for (var i = 0; i < pendingContracts.length; i++) {
			var c = pendingContracts[i];
			await Transaction.create({
				type: 'contract',
				timestamp: new Date(contractTimestamp.getTime() + (i * 1000)),
				source: 'manual',
				franchiseId: c.franchiseId,
				playerId: c.playerId._id || c.playerId,
				salary: c.salary,
				startYear: season,
				endYear: c.pendingEndYear
			});
		}

		// Move pendingEndYear → endYear for all pending contracts
		await Contract.updateMany(
			{ salary: { $ne: null }, endYear: null, pendingEndYear: { $ne: null } },
			[{ $set: { startYear: season, endYear: '$pendingEndYear', pendingEndYear: null } }]
		);

		// Rebuild all budgets from scratch
		await budgetHelper.rebuildAllBudgets();

		var processResult = encodeURIComponent(JSON.stringify({
			success: true,
			successCount: pendingContracts.length
		}));
		response.redirect('/admin/contracts?processResult=' + processResult);
	} catch (err) {
		console.error('Process contracts error:', err);
		var errorResult = encodeURIComponent(JSON.stringify({
			success: false,
			error: 'Server error: ' + err.message
		}));
		response.redirect('/admin/contracts?processResult=' + errorResult);
	}
}

module.exports = {
	configPage: configPage,
	schedulePage: schedulePage,
	updateConfig: updateConfig,
	advanceSeasonForm: advanceSeasonForm,
	advanceSeason: advanceSeason,
	transferFranchiseForm: transferFranchiseForm,
	transferFranchise: transferFranchise,
	rostersPage: rostersPage,
	cutPlayer: cutPlayer,
	markForCut: markForCut,
	processCutDay: processCutDay,
	contractsPage: contractsPage,
	overrideContract: overrideContract,
	processContracts: processContracts,
	sanityPage: sanityPage,
	transactionsPage: transactionsPage,
	rollbackTransaction: rollbackTransaction,
	sleeperTransactionsPage: sleeperTransactionsPage
};
