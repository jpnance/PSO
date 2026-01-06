var mongoose = require('mongoose');

// Use test database (mongo is the Docker hostname)
var TEST_DB_URI = process.env.MONGO_URI ? process.env.MONGO_URI.replace('/pso', '/test') : 'mongodb://mongo:27017/test';

// Models
var LeagueConfig = require('../models/LeagueConfig');
var Franchise = require('../models/Franchise');
var Regime = require('../models/Regime');
var Contract = require('../models/Contract');
var Budget = require('../models/Budget');
var Pick = require('../models/Pick');
var Player = require('../models/Player');

var TEST_SEASON = 2025;

// Mock franchise IDs
var FRANCHISE_IDS = [];
for (var i = 1; i <= 12; i++) {
	FRANCHISE_IDS.push(new mongoose.Types.ObjectId());
}

// Mock player IDs
var PLAYER_IDS = [];
for (var i = 1; i <= 20; i++) {
	PLAYER_IDS.push(new mongoose.Types.ObjectId());
}

async function setupMockWorld() {
	console.log('Setting up mock data...');
	
	// Create LeagueConfig
	await LeagueConfig.create({
		_id: 'pso',
		season: TEST_SEASON,
		tradeWindow: new Date(TEST_SEASON, 0, 25),
		cutDay: new Date(TEST_SEASON, 7, 20),
		draftDay: new Date(TEST_SEASON, 7, 27),
		contractsDue: new Date(TEST_SEASON, 8, 1),
		faab: new Date(TEST_SEASON, 8, 4),
		tradeDeadline: new Date(TEST_SEASON, 10, 5),
		playoffs: new Date(TEST_SEASON, 11, 10),
		deadPeriod: new Date(TEST_SEASON, 11, 24)
	});
	
	// Create franchises
	for (var i = 0; i < 12; i++) {
		await Franchise.create({
			_id: FRANCHISE_IDS[i],
			foundedYear: 2008
		});
		
		await Regime.create({
			franchiseId: FRANCHISE_IDS[i],
			displayName: 'Franchise ' + (i + 1),
			ownerIds: [],
			startSeason: 2008
		});
		
		// Create budgets for current and next season
		await Budget.create({
			franchiseId: FRANCHISE_IDS[i],
			season: TEST_SEASON,
			baseAmount: 1000,
			payroll: 200,
			available: 800
		});
		
		await Budget.create({
			franchiseId: FRANCHISE_IDS[i],
			season: TEST_SEASON + 1,
			baseAmount: 1000,
			payroll: 100,
			available: 900
		});
	}
	
	// Create players
	for (var i = 0; i < 20; i++) {
		await Player.create({
			_id: PLAYER_IDS[i],
			name: 'Test Player ' + (i + 1),
			sleeperId: null
		});
	}
	
	// Create contracts with various lengths
	// 1-year contract (expires this season -> UFA)
	await Contract.create({
		playerId: PLAYER_IDS[0],
		franchiseId: FRANCHISE_IDS[0],
		salary: 50,
		startYear: TEST_SEASON,
		endYear: TEST_SEASON
	});
	
	// 2-year contract (expires this season -> RFA)
	await Contract.create({
		playerId: PLAYER_IDS[1],
		franchiseId: FRANCHISE_IDS[1],
		salary: 75,
		startYear: TEST_SEASON - 1,
		endYear: TEST_SEASON
	});
	
	// 3-year contract (expires this season -> RFA)
	await Contract.create({
		playerId: PLAYER_IDS[2],
		franchiseId: FRANCHISE_IDS[2],
		salary: 100,
		startYear: TEST_SEASON - 2,
		endYear: TEST_SEASON
	});
	
	// 4-year contract (expires this season -> UFA)
	await Contract.create({
		playerId: PLAYER_IDS[3],
		franchiseId: FRANCHISE_IDS[3],
		salary: 150,
		startYear: TEST_SEASON - 3,
		endYear: TEST_SEASON
	});
	
	// FA contract (no startYear -> UFA)
	await Contract.create({
		playerId: PLAYER_IDS[4],
		franchiseId: FRANCHISE_IDS[4],
		salary: 25,
		startYear: null,
		endYear: TEST_SEASON
	});
	
	// Multi-year contract NOT expiring (should remain)
	await Contract.create({
		playerId: PLAYER_IDS[5],
		franchiseId: FRANCHISE_IDS[5],
		salary: 80,
		startYear: TEST_SEASON,
		endYear: TEST_SEASON + 2
	});
	
	// Create existing picks for next season (should get pickNumbers set)
	for (var round = 1; round <= 10; round++) {
		for (var i = 0; i < 12; i++) {
			await Pick.create({
				season: TEST_SEASON + 1,
				round: round,
				originalFranchiseId: FRANCHISE_IDS[i],
				currentFranchiseId: FRANCHISE_IDS[i],
				status: 'available'
			});
		}
	}
	
	console.log('Mock data ready.\n');
}

async function teardownMockWorld() {
	console.log('Cleaning up mock data...');
	
	await LeagueConfig.deleteMany({});
	await Franchise.deleteMany({});
	await Regime.deleteMany({});
	await Contract.deleteMany({});
	await Budget.deleteMany({});
	await Pick.deleteMany({});
	await Player.deleteMany({});
	
	console.log('Cleanup complete.\n');
}

// Rollover logic (extracted from admin/service.js)
async function executeRollover(draftOrder) {
	var config = await LeagueConfig.findById('pso');
	var newSeason = config.season + 1;
	var pickSeason = newSeason + 2;
	
	var franchises = await Franchise.find({}).lean();
	var results = {
		picksCreated: 0,
		budgetsCreated: 0,
		rfaConverted: 0,
		ufaDeleted: 0,
		draftOrderSet: 0
	};
	
	// 1. Create picks for season+2
	for (var round = 1; round <= 10; round++) {
		for (var i = 0; i < franchises.length; i++) {
			var franchise = franchises[i];
			
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
				results.picksCreated++;
			}
		}
	}
	
	// 2. Create budgets for season+2
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
				deadMoney: 0,
				cashIn: 0,
				cashOut: 0,
				available: 1000
			});
			results.budgetsCreated++;
		}
	}
	
	// 3. Process expiring contracts
	var expiringContracts = await Contract.find({ endYear: config.season });
	
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
			results.rfaConverted++;
		} else {
			// Delete contract (UFA)
			await Contract.deleteOne({ _id: contract._id });
			results.ufaDeleted++;
		}
	}
	
	// 4. Set draft order
	if (draftOrder) {
		var draftPicks = await Pick.find({ season: newSeason });
		for (var i = 0; i < draftPicks.length; i++) {
			var pick = draftPicks[i];
			var franchiseId = pick.originalFranchiseId.toString();
			var slot = draftOrder[franchiseId];
			
			if (slot >= 1 && slot <= 12) {
				pick.pickNumber = (pick.round - 1) * 12 + slot;
				await pick.save();
				results.draftOrderSet++;
			}
		}
	}
	
	// 5. Update config
	config.season = newSeason;
	await config.save();
	
	return results;
}

// Test functions
async function test1_BasicRollover() {
	console.log('=== TEST 1: Basic Rollover ===\n');
	
	// Build draft order (slot 1-12 for each franchise)
	var draftOrder = {};
	for (var i = 0; i < 12; i++) {
		draftOrder[FRANCHISE_IDS[i].toString()] = i + 1;
	}
	
	var results = await executeRollover(draftOrder);
	
	console.log('Results:');
	console.log('  Picks created:', results.picksCreated);
	console.log('  Budgets created:', results.budgetsCreated);
	console.log('  RFA converted:', results.rfaConverted);
	console.log('  UFA deleted:', results.ufaDeleted);
	console.log('  Draft order set:', results.draftOrderSet);
	
	// Verify picks created for season+2
	var newPicks = await Pick.find({ season: TEST_SEASON + 3 });
	if (newPicks.length !== 120) {
		console.log('FAIL: Expected 120 picks for season+2, got', newPicks.length);
		return false;
	}
	console.log('  ✓ 120 picks created for', TEST_SEASON + 3);
	
	// Verify budgets created for season+2
	var newBudgets = await Budget.find({ season: TEST_SEASON + 3 });
	if (newBudgets.length !== 12) {
		console.log('FAIL: Expected 12 budgets for season+2, got', newBudgets.length);
		return false;
	}
	console.log('  ✓ 12 budgets created for', TEST_SEASON + 3);
	
	// Verify RFA conversions (2 contracts: 2-year and 3-year)
	if (results.rfaConverted !== 2) {
		console.log('FAIL: Expected 2 RFA conversions, got', results.rfaConverted);
		return false;
	}
	console.log('  ✓ 2 contracts converted to RFA rights');
	
	// Verify UFA deletions (3 contracts: 1-year, 4-year, FA)
	if (results.ufaDeleted !== 3) {
		console.log('FAIL: Expected 3 UFA deletions, got', results.ufaDeleted);
		return false;
	}
	console.log('  ✓ 3 contracts deleted (players became UFAs)');
	
	// Verify RFA contracts have null fields
	var rfaContracts = await Contract.find({ salary: null });
	if (rfaContracts.length !== 2) {
		console.log('FAIL: Expected 2 RFA contracts, got', rfaContracts.length);
		return false;
	}
	for (var i = 0; i < rfaContracts.length; i++) {
		var rfa = rfaContracts[i];
		if (rfa.startYear !== null || rfa.endYear !== null) {
			console.log('FAIL: RFA contract should have null startYear/endYear');
			return false;
		}
	}
	console.log('  ✓ RFA contracts have null salary/startYear/endYear');
	
	// Verify non-expiring contract remains
	var remainingContract = await Contract.findOne({ playerId: PLAYER_IDS[5] });
	if (!remainingContract || remainingContract.salary !== 80) {
		console.log('FAIL: Non-expiring contract should remain unchanged');
		return false;
	}
	console.log('  ✓ Non-expiring contract remains unchanged');
	
	// Verify draft order set
	var pick1 = await Pick.findOne({
		season: TEST_SEASON + 1,
		round: 1,
		originalFranchiseId: FRANCHISE_IDS[0]
	});
	if (!pick1 || pick1.pickNumber !== 1) {
		console.log('FAIL: First franchise should have pick #1, got', pick1 ? pick1.pickNumber : 'null');
		return false;
	}
	
	var pick12 = await Pick.findOne({
		season: TEST_SEASON + 1,
		round: 1,
		originalFranchiseId: FRANCHISE_IDS[11]
	});
	if (!pick12 || pick12.pickNumber !== 12) {
		console.log('FAIL: Last franchise should have pick #12, got', pick12 ? pick12.pickNumber : 'null');
		return false;
	}
	console.log('  ✓ Draft order set correctly');
	
	// Verify season incremented
	var config = await LeagueConfig.findById('pso');
	if (config.season !== TEST_SEASON + 1) {
		console.log('FAIL: Season should be', TEST_SEASON + 1, 'got', config.season);
		return false;
	}
	console.log('  ✓ Season incremented to', config.season);
	
	console.log('\nPASS\n');
	return true;
}

async function test2_PickNumberCalculation() {
	console.log('=== TEST 2: Pick Number Calculation ===\n');
	
	// Verify pick numbers are correct across rounds
	// Round 1: picks 1-12, Round 2: picks 13-24, etc.
	
	var round2pick = await Pick.findOne({
		season: TEST_SEASON + 1,
		round: 2,
		originalFranchiseId: FRANCHISE_IDS[0] // Slot 1
	});
	
	// Expected: (2-1) * 12 + 1 = 13
	if (!round2pick || round2pick.pickNumber !== 13) {
		console.log('FAIL: Round 2 slot 1 should be pick #13, got', round2pick ? round2pick.pickNumber : 'null');
		return false;
	}
	console.log('  ✓ Round 2, Slot 1 = Pick #13');
	
	var round10pick = await Pick.findOne({
		season: TEST_SEASON + 1,
		round: 10,
		originalFranchiseId: FRANCHISE_IDS[11] // Slot 12
	});
	
	// Expected: (10-1) * 12 + 12 = 120
	if (!round10pick || round10pick.pickNumber !== 120) {
		console.log('FAIL: Round 10 slot 12 should be pick #120, got', round10pick ? round10pick.pickNumber : 'null');
		return false;
	}
	console.log('  ✓ Round 10, Slot 12 = Pick #120');
	
	console.log('\nPASS\n');
	return true;
}

async function runTests() {
	try {
		await mongoose.connect(TEST_DB_URI, {
			useNewUrlParser: true,
			useUnifiedTopology: true
		});
		console.log('Connected to test database\n');
		
		await teardownMockWorld();
		await setupMockWorld();
		
		var tests = [
			{ name: 'Basic Rollover', fn: test1_BasicRollover },
			{ name: 'Pick Number Calculation', fn: test2_PickNumberCalculation }
		];
		
		var passed = 0;
		var failed = 0;
		
		for (var i = 0; i < tests.length; i++) {
			try {
				var result = await tests[i].fn();
				if (result) {
					passed++;
				} else {
					failed++;
				}
			} catch (err) {
				console.log('ERROR in', tests[i].name + ':', err.message);
				console.log(err.stack);
				failed++;
			}
		}
		
		await teardownMockWorld();
		
		console.log('=== SUMMARY ===');
		console.log('Passed:', passed);
		console.log('Failed:', failed);
		
		await mongoose.disconnect();
		process.exit(failed > 0 ? 1 : 0);
		
	} catch (err) {
		console.error('Test error:', err);
		await mongoose.disconnect();
		process.exit(1);
	}
}

runTests();
