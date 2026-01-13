var LeagueConfig = require('../models/LeagueConfig');
var Franchise = require('../models/Franchise');
var Regime = require('../models/Regime');
var Person = require('../models/Person');
var Contract = require('../models/Contract');
var Budget = require('../models/Budget');
var Pick = require('../models/Pick');
var Player = require('../models/Player');
var transactionService = require('../transaction/service');
var { formatContractYears, getPositionIndex } = require('../helpers/view');

var currentSeason = parseInt(process.env.SEASON, 10);

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
		pageTitle: 'Admin - PSO',
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
	var regimes = await Regime.find({
		startSeason: { $lte: newSeason },
		$or: [{ endSeason: null }, { endSeason: { $gte: newSeason } }]
	}).lean();
	
	var franchiseList = franchises.map(function(f) {
		var regime = regimes.find(function(r) {
			return r.franchiseId.equals(f._id);
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
		pageTitle: 'Advance to ' + newSeason + ' - PSO',
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
	
	for (var i = 0; i < expiringContracts.length; i++) {
		var contract = expiringContracts[i];
		
		var contractLength = (contract.startYear && contract.endYear) 
			? (contract.endYear - contract.startYear + 1) 
			: 1;
		
		if (contractLength >= 2 && contractLength <= 3) {
			// Convert to RFA rights
			contract.salary = null;
			contract.startYear = null;
			contract.endYear = null;
			await contract.save();
			rfaConverted++;
		} else {
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
	
	response.redirect('/admin');
}

// GET /admin/transfer-franchise - show transfer form
async function transferFranchiseForm(request, response) {
	var config = await LeagueConfig.findById('pso');
	var currentSeason = config ? config.season : new Date().getFullYear();
	
	// Get all franchises with their current regimes
	var franchises = await Franchise.find({}).lean();
	var regimes = await Regime.find({
		endSeason: null
	}).populate('ownerIds').lean();
	
	var franchiseList = franchises.map(function(f) {
		var regime = regimes.find(function(r) {
			return r.franchiseId.equals(f._id);
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
		pageTitle: 'Transfer Franchise - PSO',
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
	
	// End the current regime
	var currentRegime = await Regime.findOne({ 
		franchiseId: franchiseId, 
		endSeason: null 
	});
	
	if (currentRegime) {
		currentRegime.endSeason = effectiveSeason - 1;
		await currentRegime.save();
	}
	
	// Create the new regime
	await Regime.create({
		franchiseId: franchiseId,
		displayName: newDisplayName,
		ownerIds: [person._id],
		startSeason: effectiveSeason,
		endSeason: null
	});
	
	response.redirect('/admin');
}

// GET /admin/rosters - show all rosters with cut buttons
async function rostersPage(request, response) {
	var config = await LeagueConfig.findById('pso');
	var season = config ? config.season : new Date().getFullYear();
	var phase = config ? config.getPhase() : 'unknown';
	
	// Get all franchises with current regimes
	var franchises = await Franchise.find({}).lean();
	var regimes = await Regime.find({
		startSeason: { $lte: season },
		$or: [{ endSeason: null }, { endSeason: { $gte: season } }]
	}).lean();
	
	// Get all active contracts with player data
	var contracts = await Contract.find({
		endYear: { $gte: season }
	}).populate('playerId').lean();
	
	// Build franchise list with rosters
	var franchiseList = franchises.map(function(f) {
		var regime = regimes.find(function(r) {
			return r.franchiseId.equals(f._id);
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
		pageTitle: 'Roster Management - PSO',
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

module.exports = {
	configPage: configPage,
	updateConfig: updateConfig,
	advanceSeasonForm: advanceSeasonForm,
	advanceSeason: advanceSeason,
	transferFranchiseForm: transferFranchiseForm,
	transferFranchise: transferFranchise,
	rostersPage: rostersPage,
	cutPlayer: cutPlayer
};
