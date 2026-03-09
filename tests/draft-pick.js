/**
 * Test harness for draft pick processing.
 * 
 * Verifies that processDraftPick:
 * - Creates a Transaction record
 * - Creates a Contract record
 * - Updates Budget correctly
 * - Marks the Pick as used
 * 
 * Usage: 
 *   docker compose run --rm web node tests/draft-pick.js
 */

var dotenv = require('dotenv').config({ path: __dirname + '/../.env' });
var mongoose = require('mongoose');

var Transaction = require('../models/Transaction');
var Contract = require('../models/Contract');
var Franchise = require('../models/Franchise');
var Regime = require('../models/Regime');
var Player = require('../models/Player');
var Budget = require('../models/Budget');
var Pick = require('../models/Pick');
var LeagueConfig = require('../models/LeagueConfig');

var transactionService = require('../services/transaction');

// Use a separate test database to avoid polluting dev/prod data
function getTestDbUri() {
	var uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/pso';
	// Replace the database name with 'test'
	return uri.replace(/\/([^/?]+)(\?|$)/, '/test$2');
}

var testUri = getTestDbUri();
console.log('Connecting to test database:', testUri);
mongoose.connect(testUri);

var TEST_SEASON = 2099; // Use a far-future season to avoid conflicts
var TEST_PREFIX = 'TEST_DRAFT_';

// Mock data storage for cleanup
var mockData = {
	franchises: [],
	players: [],
	contracts: [],
	budgets: [],
	regimes: [],
	picks: [],
	config: null,
	transactions: []
};

// ============ Setup / Teardown ============

async function createMockFranchise(name, rosterId) {
	var franchise = await Franchise.create({
		foundedYear: TEST_SEASON - 10,
		rosterId: rosterId
	});
	
	var regime = await Regime.create({
		displayName: TEST_PREFIX + name,
		ownerIds: [],
		tenures: [{
			franchiseId: franchise._id,
			startSeason: TEST_SEASON - 5,
			endSeason: null
		}]
	});
	
	mockData.franchises.push(franchise);
	mockData.regimes.push(regime);
	
	return franchise;
}

async function createMockPlayer(name, positions) {
	var player = await Player.create({
		name: TEST_PREFIX + name,
		sleeperId: 'test_draft_' + name.toLowerCase().replace(/\s/g, '_'),
		positions: positions || ['WR']
	});
	
	mockData.players.push(player);
	return player;
}

async function createMockPick(franchiseId, season, round, pickNumber) {
	var pick = await Pick.create({
		season: season,
		round: round,
		pickNumber: pickNumber,
		originalFranchiseId: franchiseId,
		currentFranchiseId: franchiseId,
		status: 'available'
	});
	
	mockData.picks.push(pick);
	return pick;
}

async function createMockBudget(franchiseId, season, options) {
	options = options || {};
	var budget = await Budget.create({
		franchiseId: franchiseId,
		season: season,
		baseAmount: options.baseAmount || 1000,
		payroll: options.payroll || 0,
		buyOuts: options.buyOuts || 0,
		cashIn: options.cashIn || 0,
		cashOut: options.cashOut || 0,
		available: options.available || 1000,
		recoverable: options.recoverable || 0
	});
	
	mockData.budgets.push(budget);
	return budget;
}

async function createMockConfig(options) {
	options = options || {};
	var config = await LeagueConfig.create({
		_id: 'pso',
		season: options.season || TEST_SEASON,
		tradeWindow: new Date(options.season || TEST_SEASON, 0, 25),
		cutDay: new Date(options.season || TEST_SEASON, 7, 20),
		draftDay: new Date(options.season || TEST_SEASON, 7, 27),
		contractsDue: new Date(options.season || TEST_SEASON, 8, 1),
		faab: new Date(options.season || TEST_SEASON, 8, 4),
		tradeDeadline: new Date(options.season || TEST_SEASON, 10, 5),
		playoffs: new Date(options.season || TEST_SEASON, 11, 10),
		deadPeriod: new Date(options.season || TEST_SEASON, 11, 24)
	});
	
	mockData.config = config;
	return config;
}

async function setupMockWorld() {
	var franchiseA = await createMockFranchise('Franchise A', 101);
	
	// Create a draft-eligible player (no existing contract)
	var rookiePlayer = await createMockPlayer('Rookie Player', ['WR']);
	
	// Create a pick for franchise A in the current test season
	var pick = await createMockPick(franchiseA._id, TEST_SEASON, 1, 1);
	
	// Create budgets for the franchise for multiple seasons
	var budget1 = await createMockBudget(franchiseA._id, TEST_SEASON, { available: 900, payroll: 100 });
	var budget2 = await createMockBudget(franchiseA._id, TEST_SEASON + 1, { available: 950, payroll: 50 });
	var budget3 = await createMockBudget(franchiseA._id, TEST_SEASON + 2, { available: 1000, payroll: 0 });
	
	return {
		franchiseA: franchiseA,
		rookiePlayer: rookiePlayer,
		pick: pick,
		budgets: [budget1, budget2, budget3]
	};
}

async function teardownMockWorld() {
	// Clean up all mock data
	if (mockData.config) {
		await LeagueConfig.deleteOne({ _id: 'pso' });
	}
	
	var transactionIds = mockData.transactions.map(function(t) { return t._id; });
	await Transaction.deleteMany({ _id: { $in: transactionIds } });
	
	var contractIds = mockData.contracts.map(function(c) { return c._id; });
	await Contract.deleteMany({ _id: { $in: contractIds } });
	
	var franchiseIds = mockData.franchises.map(function(f) { return f._id; });
	await Franchise.deleteMany({ _id: { $in: franchiseIds } });
	
	var regimeIds = mockData.regimes.map(function(r) { return r._id; });
	await Regime.deleteMany({ _id: { $in: regimeIds } });
	
	var playerIds = mockData.players.map(function(p) { return p._id; });
	await Player.deleteMany({ _id: { $in: playerIds } });
	
	var budgetIds = mockData.budgets.map(function(b) { return b._id; });
	await Budget.deleteMany({ _id: { $in: budgetIds } });
	
	var pickIds = mockData.picks.map(function(p) { return p._id; });
	await Pick.deleteMany({ _id: { $in: pickIds } });
	
	// Also clean up any contracts created during tests
	await Contract.deleteMany({ playerId: { $in: playerIds } });
	
	// Also clean up any transactions created during tests
	await Transaction.deleteMany({ playerId: { $in: playerIds } });
	
	// Reset mock data
	mockData = {
		franchises: [],
		players: [],
		contracts: [],
		budgets: [],
		regimes: [],
		picks: [],
		config: null,
		transactions: []
	};
}

// ============ Tests ============

async function test1_BasicDraftPickCreatesContract(world) {
	console.log('\n--- TEST 1: Basic Draft Pick Creates Contract ---');
	
	var result = await transactionService.processDraftPick({
		pickId: world.pick._id,
		playerId: world.rookiePlayer._id,
		franchiseId: world.franchiseA._id
	});
	
	if (!result.success) {
		console.log('FAIL: processDraftPick failed with errors:', result.errors);
		return false;
	}
	
	// Track the created transaction and contract for cleanup
	mockData.transactions.push(result.transaction);
	mockData.contracts.push(result.contract);
	
	// Verify transaction was created
	var transaction = await Transaction.findById(result.transaction._id);
	if (!transaction) {
		console.log('FAIL: Transaction not found in database');
		return false;
	}
	console.log('Transaction created:', transaction.type);
	
	// Verify contract was created
	var contract = await Contract.findById(result.contract._id);
	if (!contract) {
		console.log('FAIL: Contract not found in database');
		return false;
	}
	console.log('Contract created: salary $' + contract.salary + ', ' + contract.startYear + '-' + contract.endYear);
	
	// Verify contract has correct values
	if (contract.salary === null || contract.salary === undefined) {
		console.log('FAIL: Contract salary is null/undefined');
		return false;
	}
	
	if (contract.startYear !== TEST_SEASON) {
		console.log('FAIL: Contract startYear is wrong. Expected:', TEST_SEASON, 'Got:', contract.startYear);
		return false;
	}
	
	if (contract.endYear !== TEST_SEASON + 2) {
		console.log('FAIL: Contract endYear is wrong. Expected:', TEST_SEASON + 2, 'Got:', contract.endYear);
		return false;
	}
	
	// Verify pick is marked as used
	var updatedPick = await Pick.findById(world.pick._id);
	if (updatedPick.status !== 'used') {
		console.log('FAIL: Pick status should be "used", got:', updatedPick.status);
		return false;
	}
	console.log('Pick marked as used: ✓');
	
	console.log('TEST 1 PASSED ✓');
	return true;
}

async function test2_DraftPickUpdatesBudget(world) {
	console.log('\n--- TEST 2: Draft Pick Updates Budget ---');
	
	// Get initial budget values
	var initialBudgets = {};
	for (var i = 0; i < world.budgets.length; i++) {
		var b = world.budgets[i];
		initialBudgets[b.season] = { payroll: b.payroll, available: b.available };
	}
	
	var result = await transactionService.processDraftPick({
		pickId: world.pick._id,
		playerId: world.rookiePlayer._id,
		franchiseId: world.franchiseA._id
	});
	
	if (!result.success) {
		console.log('FAIL: processDraftPick failed with errors:', result.errors);
		return false;
	}
	
	// Track the created transaction and contract for cleanup
	mockData.transactions.push(result.transaction);
	mockData.contracts.push(result.contract);
	
	var salary = result.contract.salary;
	console.log('Contract salary: $' + salary);
	
	// Verify budgets were updated for all contract years
	for (var season = TEST_SEASON; season <= TEST_SEASON + 2; season++) {
		var updatedBudget = await Budget.findOne({ franchiseId: world.franchiseA._id, season: season });
		
		if (!updatedBudget) {
			console.log('FAIL: Budget not found for season', season);
			return false;
		}
		
		var initial = initialBudgets[season];
		var expectedPayroll = initial.payroll + salary;
		var expectedAvailable = initial.available - salary;
		
		if (updatedBudget.payroll !== expectedPayroll) {
			console.log('FAIL: Budget payroll for season', season, 'expected:', expectedPayroll, 'got:', updatedBudget.payroll);
			return false;
		}
		
		if (updatedBudget.available !== expectedAvailable) {
			console.log('FAIL: Budget available for season', season, 'expected:', expectedAvailable, 'got:', updatedBudget.available);
			return false;
		}
		
		console.log('Season', season, 'budget updated: payroll $' + updatedBudget.payroll + ', available $' + updatedBudget.available + ' ✓');
	}
	
	console.log('TEST 2 PASSED ✓');
	return true;
}

async function test3_DraftPickBlockedForPlayerWithContract(world) {
	console.log('\n--- TEST 3: Draft Pick Blocked for Player with Existing Contract ---');
	
	// First, create a contract for the player
	var existingContract = await Contract.create({
		playerId: world.rookiePlayer._id,
		franchiseId: world.franchiseA._id,
		salary: 10,
		startYear: TEST_SEASON,
		endYear: TEST_SEASON + 1
	});
	mockData.contracts.push(existingContract);
	
	// Now try to draft the same player
	var result = await transactionService.processDraftPick({
		pickId: world.pick._id,
		playerId: world.rookiePlayer._id,
		franchiseId: world.franchiseA._id
	});
	
	if (result.success) {
		console.log('FAIL: processDraftPick should have failed for player with existing contract');
		mockData.transactions.push(result.transaction);
		mockData.contracts.push(result.contract);
		return false;
	}
	
	var hasCorrectError = result.errors && result.errors.some(function(e) {
		return e.includes('already has a contract');
	});
	
	if (!hasCorrectError) {
		console.log('FAIL: Expected "already has a contract" error, got:', result.errors);
		return false;
	}
	
	console.log('Draft blocked with correct error: ✓');
	console.log('TEST 3 PASSED ✓');
	return true;
}

async function test4_DraftPickCustomEndYear(world) {
	console.log('\n--- TEST 4: Draft Pick with Custom End Year ---');
	
	// Use a 1-year contract (endYear = startYear)
	var customEndYear = TEST_SEASON;
	
	var result = await transactionService.processDraftPick({
		pickId: world.pick._id,
		playerId: world.rookiePlayer._id,
		franchiseId: world.franchiseA._id,
		endYear: customEndYear
	});
	
	if (!result.success) {
		console.log('FAIL: processDraftPick failed with errors:', result.errors);
		return false;
	}
	
	// Track the created transaction and contract for cleanup
	mockData.transactions.push(result.transaction);
	mockData.contracts.push(result.contract);
	
	// Verify contract has the custom end year
	var contract = await Contract.findById(result.contract._id);
	if (contract.endYear !== customEndYear) {
		console.log('FAIL: Contract endYear should be', customEndYear, 'got:', contract.endYear);
		return false;
	}
	
	console.log('Contract created with custom endYear:', contract.endYear, '✓');
	console.log('TEST 4 PASSED ✓');
	return true;
}

// ============ Test Registry ============
var tests = [
	{ name: 'Basic Draft Pick Creates Contract', fn: test1_BasicDraftPickCreatesContract },
	{ name: 'Draft Pick Updates Budget', fn: test2_DraftPickUpdatesBudget },
	{ name: 'Draft Pick Blocked for Player with Contract', fn: test3_DraftPickBlockedForPlayerWithContract },
	{ name: 'Draft Pick with Custom End Year', fn: test4_DraftPickCustomEndYear },
];

// ============ Main Runner ============
async function runTests() {
	console.log('=== Draft Pick Test Suite ===\n');
	
	var results = [];
	
	for (var i = 0; i < tests.length; i++) {
		var test = tests[i];
		
		try {
			await createMockConfig({ season: TEST_SEASON });
			var world = await setupMockWorld();
			
			var pass = await test.fn(world);
			results.push({ name: test.name, pass: pass });
			
		} catch (err) {
			console.error('\nTest error:', err);
			results.push({ name: test.name, pass: false });
		} finally {
			await teardownMockWorld();
		}
	}
	
	// Summary
	console.log('\n=== Summary ===');
	var passed = 0;
	var failed = 0;
	
	results.forEach(function(r) {
		console.log('  ' + (r.pass ? '✓' : '✗') + ' ' + r.name);
		if (r.pass) passed++; else failed++;
	});
	
	console.log('\n' + passed + ' passed, ' + failed + ' failed');
	process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(function(err) {
	console.error('Fatal error:', err);
	process.exit(1);
});
