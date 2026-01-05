/**
 * Test harness for trade processing.
 * 
 * Uses mock data for full control - no dependency on live database state.
 * 
 * Usage: 
 *   docker compose run --rm web node transaction/test-trade.js
 */

var dotenv = require('dotenv').config({ path: __dirname + '/../.env' });
var mongoose = require('mongoose');

var Transaction = require('../models/Transaction');
var Contract = require('../models/Contract');
var Roster = require('../models/Roster');
var Franchise = require('../models/Franchise');
var Regime = require('../models/Regime');
var Player = require('../models/Player');
var Budget = require('../models/Budget');
var LeagueConfig = require('../models/LeagueConfig');

var transactionService = require('./service');

// Use a separate test database to avoid polluting dev/prod data
function getTestDbUri() {
	var uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/pso';
	// Replace the database name with 'test'
	// Handles both mongodb://host/dbname and mongodb://host/dbname?options
	return uri.replace(/\/([^/?]+)(\?|$)/, '/test$2');
}

var testUri = getTestDbUri();
console.log('Connecting to test database:', testUri);
mongoose.connect(testUri, { useNewUrlParser: true, useUnifiedTopology: true });

var TEST_SEASON = 2099; // Use a far-future season to avoid conflicts
var TEST_PREFIX = 'TEST_';

// Mock data storage for cleanup
var mockData = {
	franchises: [],
	players: [],
	contracts: [],
	budgets: [],
	regimes: [],
	config: null,
	transactions: [],
	rosters: []
};

// ============ Setup / Teardown ============

async function createMockFranchise(name, sleeperRosterId) {
	var franchise = await Franchise.create({
		foundedYear: TEST_SEASON - 10,
		sleeperRosterId: sleeperRosterId
	});
	
	var regime = await Regime.create({
		franchiseId: franchise._id,
		displayName: TEST_PREFIX + name,
		startSeason: TEST_SEASON - 5,
		endSeason: null
	});
	
	mockData.franchises.push(franchise);
	mockData.regimes.push(regime);
	
	return franchise;
}

async function createMockPlayer(name, position) {
	var player = await Player.create({
		name: TEST_PREFIX + name,
		sleeperId: 'test_' + name.toLowerCase().replace(/\s/g, '_'),
		position: position
	});
	
	mockData.players.push(player);
	return player;
}

async function createMockContract(franchiseId, playerId, salary, startYear, endYear) {
	var contract = await Contract.create({
		franchiseId: franchiseId,
		playerId: playerId,
		salary: salary,
		startYear: startYear,
		endYear: endYear
	});
	
	mockData.contracts.push(contract);
	return contract;
}

async function createMockBudget(franchiseId, season, options) {
	options = options || {};
	var budget = await Budget.create({
		franchiseId: franchiseId,
		season: season,
		baseAmount: options.baseAmount || 1000,
		payroll: options.payroll || 0,
		deadMoney: options.deadMoney || 0,
		cashIn: options.cashIn || 0,
		cashOut: options.cashOut || 0,
		available: options.available !== undefined ? options.available : 1000
	});
	
	mockData.budgets.push(budget);
	return budget;
}

async function createMockConfig(options) {
	options = options || {};
	
	// Delete any existing config in test database
	await LeagueConfig.deleteOne({ _id: 'pso' });
	
	var config = await LeagueConfig.create({
		_id: 'pso',
		season: options.season || TEST_SEASON
	});
	
	// Override methods directly - much cleaner than date manipulation
	config.areTradesEnabled = function() {
		return options.tradesEnabled !== undefined ? options.tradesEnabled : true;
	};
	config.isHardCapActive = function() {
		return options.hardCapActive !== undefined ? options.hardCapActive : false;
	};
	config.getPhase = function() {
		return options.phase || 'early-offseason';
	};
	
	mockData.config = config;
	return config;
}

async function setupMockWorld() {
	console.log('Setting up mock data...');
	
	// Create 3 franchises
	var franchiseA = await createMockFranchise('Franchise A', 101);
	var franchiseB = await createMockFranchise('Franchise B', 102);
	var franchiseC = await createMockFranchise('Franchise C', 103);
	
	// Create players
	var playerA1 = await createMockPlayer('Player A1', 'WR');
	var playerA2 = await createMockPlayer('Player A2', 'RB');
	var playerB1 = await createMockPlayer('Player B1', 'QB');
	var playerB2 = await createMockPlayer('Player B2', 'TE');
	var playerC1 = await createMockPlayer('Player C1', 'WR');
	
	// Create contracts
	await createMockContract(franchiseA._id, playerA1._id, 100, TEST_SEASON, TEST_SEASON + 2);
	await createMockContract(franchiseA._id, playerA2._id, 50, TEST_SEASON, TEST_SEASON + 1);
	await createMockContract(franchiseB._id, playerB1._id, 150, TEST_SEASON, TEST_SEASON + 2);
	await createMockContract(franchiseB._id, playerB2._id, 75, TEST_SEASON, TEST_SEASON);
	await createMockContract(franchiseC._id, playerC1._id, 80, TEST_SEASON, TEST_SEASON + 1);
	
	// Create budgets - each starts with 1000, subtract payroll
	// Need budgets for current season and next 2 years (validation checks all)
	await createMockBudget(franchiseA._id, TEST_SEASON, { payroll: 150, available: 850 });
	await createMockBudget(franchiseB._id, TEST_SEASON, { payroll: 225, available: 775 });
	await createMockBudget(franchiseC._id, TEST_SEASON, { payroll: 80, available: 920 });
	
	await createMockBudget(franchiseA._id, TEST_SEASON + 1, { payroll: 150, available: 850 });
	await createMockBudget(franchiseB._id, TEST_SEASON + 1, { payroll: 150, available: 850 });
	await createMockBudget(franchiseC._id, TEST_SEASON + 1, { payroll: 80, available: 920 });
	
	await createMockBudget(franchiseA._id, TEST_SEASON + 2, { payroll: 100, available: 900 });
	await createMockBudget(franchiseB._id, TEST_SEASON + 2, { payroll: 150, available: 850 });
	await createMockBudget(franchiseC._id, TEST_SEASON + 2, { payroll: 0, available: 1000 });
	
	console.log('Mock data ready.\n');
	
	return {
		franchiseA, franchiseB, franchiseC,
		playerA1, playerA2, playerB1, playerB2, playerC1
	};
}

async function teardownMockWorld() {
	console.log('\nCleaning up mock data...');
	
	// Delete in reverse order of dependencies
	for (var t of mockData.transactions) {
		await Transaction.deleteOne({ _id: t._id });
	}
	for (var r of mockData.rosters) {
		await Roster.deleteOne({ _id: r._id });
	}
	for (var c of mockData.contracts) {
		await Contract.deleteOne({ _id: c._id });
	}
	for (var b of mockData.budgets) {
		await Budget.deleteOne({ _id: b._id });
	}
	for (var reg of mockData.regimes) {
		await Regime.deleteOne({ _id: reg._id });
	}
	for (var p of mockData.players) {
		await Player.deleteOne({ _id: p._id });
	}
	for (var f of mockData.franchises) {
		await Franchise.deleteOne({ _id: f._id });
	}
	if (mockData.config) {
		await LeagueConfig.deleteOne({ _id: mockData.config._id });
	}
	
	// Reset
	mockData = { franchises: [], players: [], contracts: [], budgets: [], regimes: [], config: null, transactions: [], rosters: [] };
	
	console.log('Cleanup complete.');
}

// Helper to track created transactions/rosters during tests
function trackTransaction(tx) {
	mockData.transactions.push(tx);
}


// ============ TEST 1: Basic 2-Party Player Swap ============
async function test1_BasicPlayerSwap(world) {
	console.log('=== TEST 1: Basic 2-Party Player Swap ===\n');
	
	var contractA = await Contract.findOne({ playerId: world.playerA1._id });
	var contractB = await Contract.findOne({ playerId: world.playerB1._id });
	
	console.log('Franchise A sends:', world.playerA1.name, '($' + contractA.salary + ')');
	console.log('Franchise B sends:', world.playerB1.name, '($' + contractB.salary + ')');
	
	var result = await transactionService.processTrade({
		timestamp: new Date(),
		source: 'manual',
		notes: 'Test 1: Basic swap',
		parties: [
			{
				franchiseId: world.franchiseA._id,
				receives: {
					players: [{ playerId: world.playerB1._id, salary: contractB.salary, startYear: contractB.startYear, endYear: contractB.endYear }],
					picks: [],
					cash: []
				}
			},
			{
				franchiseId: world.franchiseB._id,
				receives: {
					players: [{ playerId: world.playerA1._id, salary: contractA.salary, startYear: contractA.startYear, endYear: contractA.endYear }],
					picks: [],
					cash: []
				}
			}
		]
	});
	
	if (!result.success) {
		console.log('FAIL: Trade rejected -', result.errors.join(', '));
		return false;
	}
	
	trackTransaction(result.transaction);
	
	// Verify player movements
	var newA = await Contract.findOne({ playerId: world.playerA1._id });
	var newB = await Contract.findOne({ playerId: world.playerB1._id });
	
	var pass = newA.franchiseId.equals(world.franchiseB._id) && newB.franchiseId.equals(world.franchiseA._id);
	console.log('Player movements:', pass ? 'PASS ✓' : 'FAIL ✗');
	
	// Verify budget updates
	var budgetA = await Budget.findOne({ franchiseId: world.franchiseA._id, season: TEST_SEASON });
	var budgetB = await Budget.findOne({ franchiseId: world.franchiseB._id, season: TEST_SEASON });
	
	// A: lost $100 player, gained $150 player → +50 payroll
	// B: lost $150 player, gained $100 player → -50 payroll
	console.log('Budget A payroll:', budgetA.payroll, '(expected 200)');
	console.log('Budget B payroll:', budgetB.payroll, '(expected 175)');
	
	var budgetsCorrect = budgetA.payroll === 200 && budgetB.payroll === 175;
	console.log('Budget updates:', budgetsCorrect ? 'PASS ✓' : 'FAIL ✗');
	
	return pass && budgetsCorrect;
}

// ============ TEST 2: 3-Party Trade ============
async function test2_ThreePartyTrade(world) {
	console.log('\n=== TEST 2: 3-Party Trade (A→B→C→A) ===\n');
	
	var contractA = await Contract.findOne({ playerId: world.playerA1._id });
	var contractB = await Contract.findOne({ playerId: world.playerB1._id });
	var contractC = await Contract.findOne({ playerId: world.playerC1._id });
	
	console.log('A sends', world.playerA1.name, '($' + contractA.salary + ') → gets', world.playerB1.name);
	console.log('B sends', world.playerB1.name, '($' + contractB.salary + ') → gets', world.playerC1.name);
	console.log('C sends', world.playerC1.name, '($' + contractC.salary + ') → gets', world.playerA1.name);
	
	// Record starting payrolls
	var budgetABefore = await Budget.findOne({ franchiseId: world.franchiseA._id, season: TEST_SEASON });
	var budgetBBefore = await Budget.findOne({ franchiseId: world.franchiseB._id, season: TEST_SEASON });
	var budgetCBefore = await Budget.findOne({ franchiseId: world.franchiseC._id, season: TEST_SEASON });
	
	var result = await transactionService.processTrade({
		timestamp: new Date(),
		source: 'manual',
		notes: 'Test 2: 3-party trade',
		parties: [
			{
				franchiseId: world.franchiseA._id,
				receives: {
					players: [{ playerId: world.playerB1._id, salary: contractB.salary, startYear: contractB.startYear, endYear: contractB.endYear }],
					picks: [],
					cash: []
				}
			},
			{
				franchiseId: world.franchiseB._id,
				receives: {
					players: [{ playerId: world.playerC1._id, salary: contractC.salary, startYear: contractC.startYear, endYear: contractC.endYear }],
					picks: [],
					cash: []
				}
			},
			{
				franchiseId: world.franchiseC._id,
				receives: {
					players: [{ playerId: world.playerA1._id, salary: contractA.salary, startYear: contractA.startYear, endYear: contractA.endYear }],
					picks: [],
					cash: []
				}
			}
		]
	});
	
	if (!result.success) {
		console.log('FAIL: Trade rejected -', result.errors.join(', '));
		return false;
	}
	
	trackTransaction(result.transaction);
	
	// Verify player movements
	var newA = await Contract.findOne({ playerId: world.playerA1._id });
	var newB = await Contract.findOne({ playerId: world.playerB1._id });
	var newC = await Contract.findOne({ playerId: world.playerC1._id });
	
	var playersCorrect = newA.franchiseId.equals(world.franchiseC._id) && 
	                     newB.franchiseId.equals(world.franchiseA._id) && 
	                     newC.franchiseId.equals(world.franchiseB._id);
	console.log('Player movements:', playersCorrect ? 'PASS ✓' : 'FAIL ✗');
	
	// Verify budget updates
	var budgetAAfter = await Budget.findOne({ franchiseId: world.franchiseA._id, season: TEST_SEASON });
	var budgetBAfter = await Budget.findOne({ franchiseId: world.franchiseB._id, season: TEST_SEASON });
	var budgetCAfter = await Budget.findOne({ franchiseId: world.franchiseC._id, season: TEST_SEASON });
	
	// Expected deltas:
	// A: +150 (B1) - 100 (A1) = +50
	// B: +80 (C1) - 150 (B1) = -70
	// C: +100 (A1) - 80 (C1) = +20
	var deltaA = budgetAAfter.payroll - budgetABefore.payroll;
	var deltaB = budgetBAfter.payroll - budgetBBefore.payroll;
	var deltaC = budgetCAfter.payroll - budgetCBefore.payroll;
	
	console.log('Delta A:', deltaA, '(expected +50)');
	console.log('Delta B:', deltaB, '(expected -70)');
	console.log('Delta C:', deltaC, '(expected +20)');
	
	var budgetsCorrect = deltaA === 50 && deltaB === -70 && deltaC === 20;
	console.log('Budget updates:', budgetsCorrect ? 'PASS ✓' : 'FAIL ✗');
	
	return playersCorrect && budgetsCorrect;
}

// ============ TEST 3: Trade with Cash ============
async function test3_CashTransfer(world) {
	console.log('\n=== TEST 3: Trade with Cash Transfer ===\n');
	
	var contractB = await Contract.findOne({ playerId: world.playerB2._id });
	var cashAmount = 50;
	
	console.log('Franchise A sends: $' + cashAmount + ' cash');
	console.log('Franchise B sends:', world.playerB2.name, '($' + contractB.salary + ')');
	
	var budgetABefore = await Budget.findOne({ franchiseId: world.franchiseA._id, season: TEST_SEASON });
	var budgetBBefore = await Budget.findOne({ franchiseId: world.franchiseB._id, season: TEST_SEASON });
	
	var result = await transactionService.processTrade({
		timestamp: new Date(),
		source: 'manual',
		notes: 'Test 3: Cash transfer',
		parties: [
			{
				franchiseId: world.franchiseA._id,
				receives: {
					players: [{ playerId: world.playerB2._id, salary: contractB.salary, startYear: contractB.startYear, endYear: contractB.endYear }],
					picks: [],
					cash: []
				}
			},
			{
				franchiseId: world.franchiseB._id,
				receives: {
					players: [],
					picks: [],
					cash: [{ amount: cashAmount, season: TEST_SEASON, fromFranchiseId: world.franchiseA._id }]
				}
			}
		]
	});
	
	if (!result.success) {
		console.log('FAIL: Trade rejected -', result.errors.join(', '));
		return false;
	}
	
	trackTransaction(result.transaction);
	
	var budgetAAfter = await Budget.findOne({ franchiseId: world.franchiseA._id, season: TEST_SEASON });
	var budgetBAfter = await Budget.findOne({ franchiseId: world.franchiseB._id, season: TEST_SEASON });
	
	var cashOutCorrect = budgetAAfter.cashOut - budgetABefore.cashOut === cashAmount;
	var cashInCorrect = budgetBAfter.cashIn - budgetBBefore.cashIn === cashAmount;
	
	console.log('Cash out from A:', cashOutCorrect ? 'PASS ✓' : 'FAIL ✗', '(+' + (budgetAAfter.cashOut - budgetABefore.cashOut) + ')');
	console.log('Cash in to B:', cashInCorrect ? 'PASS ✓' : 'FAIL ✗', '(+' + (budgetBAfter.cashIn - budgetBBefore.cashIn) + ')');
	
	return cashOutCorrect && cashInCorrect;
}

// ============ TEST 4: Hard Cap Violation ============
async function test4_HardCapViolation(world) {
	console.log('\n=== TEST 4: Hard Cap Violation (should reject) ===\n');
	
	// Set up a scenario: Franchise A has very little cap, hard cap is active
	// Update A's budget to be near limit
	await Budget.updateOne(
		{ franchiseId: world.franchiseA._id, season: TEST_SEASON },
		{ available: 10, payroll: 990 }
	);
	
	// Override config to have hard cap active
	mockData.config.isHardCapActive = function() { return true; };
	
	var contractB = await Contract.findOne({ playerId: world.playerB1._id });
	
	console.log('Franchise A has $10 available (hard cap active)');
	console.log('Trying to acquire', world.playerB1.name, '($' + contractB.salary + ')');
	
	var result = await transactionService.processTrade({
		timestamp: new Date(),
		source: 'manual',
		notes: 'Test 4: Hard cap violation',
		parties: [
			{
				franchiseId: world.franchiseA._id,
				receives: {
					players: [{ playerId: world.playerB1._id, salary: contractB.salary, startYear: contractB.startYear, endYear: contractB.endYear }],
					picks: [],
					cash: []
				}
			},
			{
				franchiseId: world.franchiseB._id,
				receives: {
					players: [],
					picks: [],
					cash: [{ amount: 1, season: TEST_SEASON, fromFranchiseId: world.franchiseA._id }]
				}
			}
		]
	});
	
	var pass = !result.success;
	console.log('Trade rejected:', !result.success ? 'YES ✓' : 'NO ✗');
	if (result.errors) {
		console.log('Errors:', result.errors);
	}
	
	return pass;
}

// ============ TEST 5: Soft Cap Warning ============
async function test5_SoftCapWarning(world) {
	console.log('\n=== TEST 5: Soft Cap Warning (should allow) ===\n');
	
	// Set up: Franchise A has some room but not enough, soft cap
	await Budget.updateOne(
		{ franchiseId: world.franchiseA._id, season: TEST_SEASON },
		{ available: 50, payroll: 950 }
	);
	
	// Config defaults to soft cap (isHardCapActive = false)
	
	var contractB = await Contract.findOne({ playerId: world.playerB2._id });
	
	console.log('Franchise A has $50 available (soft cap - before cut day)');
	console.log('Trying to acquire', world.playerB2.name, '($' + contractB.salary + ')');
	console.log('Would go $' + (contractB.salary - 50) + ' over budget');
	
	var result = await transactionService.processTrade({
		timestamp: new Date(),
		source: 'manual',
		notes: 'Test 5: Soft cap warning',
		parties: [
			{
				franchiseId: world.franchiseA._id,
				receives: {
					players: [{ playerId: world.playerB2._id, salary: contractB.salary, startYear: contractB.startYear, endYear: contractB.endYear }],
					picks: [],
					cash: []
				}
			},
			{
				franchiseId: world.franchiseB._id,
				receives: {
					players: [],
					picks: [],
					cash: [{ amount: 1, season: TEST_SEASON, fromFranchiseId: world.franchiseA._id }]
				}
			}
		]
	});
	
	if (result.success) {
		trackTransaction(result.transaction);
	}
	
	var pass = result.success && result.warnings && result.warnings.length > 0;
	console.log('Trade allowed:', result.success ? 'YES' : 'NO');
	console.log('Has warnings:', (result.warnings && result.warnings.length > 0) ? 'YES ✓' : 'NO ✗');
	if (result.warnings) {
		console.log('Warnings:', result.warnings);
	}
	if (result.errors) {
		console.log('Errors:', result.errors);
	}
	
	return pass;
}

// ============ TEST 6: Basic Cut ============
async function test6_BasicCut(world) {
	console.log('\n=== TEST 6: Basic Cut ===\n');
	
	var contractA2 = await Contract.findOne({ playerId: world.playerA2._id });
	
	console.log('Cutting', world.playerA2.name, '($' + contractA2.salary + ')');
	console.log('Contract:', contractA2.startYear, '-', contractA2.endYear);
	
	var budgetBefore = await Budget.findOne({ franchiseId: world.franchiseA._id, season: TEST_SEASON });
	console.log('Budget before: payroll=' + budgetBefore.payroll + ', available=' + budgetBefore.available);
	
	var result = await transactionService.processCut({
		franchiseId: world.franchiseA._id,
		playerId: world.playerA2._id,
		source: 'manual',
		notes: 'Test 6: Basic cut'
	});
	
	if (!result.success) {
		console.log('FAIL: Cut rejected -', result.errors.join(', '));
		return false;
	}
	
	// Verify contract deleted
	var contractAfter = await Contract.findOne({ playerId: world.playerA2._id });
	var contractDeleted = !contractAfter;
	console.log('Contract deleted:', contractDeleted ? 'PASS ✓' : 'FAIL ✗');
	
	// Verify transaction created
	var txExists = !!result.transaction;
	console.log('Transaction created:', txExists ? 'PASS ✓' : 'FAIL ✗');
	console.log('Dead money:', JSON.stringify(result.deadMoney));
	
	// Verify budget updated
	var budgetAfter = await Budget.findOne({ franchiseId: world.franchiseA._id, season: TEST_SEASON });
	console.log('Budget after: payroll=' + budgetAfter.payroll + ', deadMoney=' + budgetAfter.deadMoney + ', available=' + budgetAfter.available);
	
	// Player A2 was $50, contract 2099-2100
	// Cut in 2099 = year 1, so 60% dead money = $30
	// Payroll should drop by $50, dead money should increase by $30
	// Available should increase by $50 - $30 = $20
	var payrollCorrect = budgetAfter.payroll === budgetBefore.payroll - 50;
	var availableIncreased = budgetAfter.available > budgetBefore.available;
	
	console.log('Payroll decreased:', payrollCorrect ? 'PASS ✓' : 'FAIL ✗');
	console.log('Available increased:', availableIncreased ? 'PASS ✓' : 'FAIL ✗');
	
	return contractDeleted && txExists && payrollCorrect && availableIncreased;
}

// ============ TEST 7: Cut Dead Money Calculation ============
async function test7_CutDeadMoney(world) {
	console.log('\n=== TEST 7: Cut Dead Money Calculation ===\n');
	
	// Player A1 has contract 2099-2101 (3 years), $100 salary
	var contractA1 = await Contract.findOne({ playerId: world.playerA1._id });
	
	console.log('Cutting', world.playerA1.name, '($' + contractA1.salary + ')');
	console.log('Contract:', contractA1.startYear, '-', contractA1.endYear);
	
	var result = await transactionService.processCut({
		franchiseId: world.franchiseA._id,
		playerId: world.playerA1._id,
		source: 'manual'
	});
	
	if (!result.success) {
		console.log('FAIL: Cut rejected -', result.errors.join(', '));
		return false;
	}
	
	// Expected dead money for $100 contract, 3 years, cut in year 1:
	// Year 1 (2099): 60% = $60
	// Year 2 (2100): 30% = $30
	// Year 3 (2101): 15% = $15
	var dm = result.deadMoney;
	console.log('Dead money entries:', JSON.stringify(dm));
	
	var year1 = dm.find(function(d) { return d.season === TEST_SEASON; });
	var year2 = dm.find(function(d) { return d.season === TEST_SEASON + 1; });
	var year3 = dm.find(function(d) { return d.season === TEST_SEASON + 2; });
	
	var y1Correct = year1 && year1.amount === 60;
	var y2Correct = year2 && year2.amount === 30;
	var y3Correct = year3 && year3.amount === 15;
	
	console.log('Year 1 ($60):', y1Correct ? 'PASS ✓' : 'FAIL ✗', year1 ? '(got $' + year1.amount + ')' : '(missing)');
	console.log('Year 2 ($30):', y2Correct ? 'PASS ✓' : 'FAIL ✗', year2 ? '(got $' + year2.amount + ')' : '(missing)');
	console.log('Year 3 ($15):', y3Correct ? 'PASS ✓' : 'FAIL ✗', year3 ? '(got $' + year3.amount + ')' : '(missing)');
	
	return y1Correct && y2Correct && y3Correct;
}

// ============ TEST 8: Cut Invalid Player ============
async function test8_CutInvalidPlayer(world) {
	console.log('\n=== TEST 8: Cut Invalid Player (should reject) ===\n');
	
	// Try to cut a player from the wrong franchise
	console.log('Trying to cut', world.playerB1.name, 'from Franchise A (wrong franchise)');
	
	var result = await transactionService.processCut({
		franchiseId: world.franchiseA._id,
		playerId: world.playerB1._id,
		source: 'manual'
	});
	
	var pass = !result.success;
	console.log('Cut rejected:', pass ? 'PASS ✓' : 'FAIL ✗');
	if (result.errors) {
		console.log('Errors:', result.errors);
	}
	
	return pass;
}

// ============ Main Runner ============
async function runTests() {
	console.log('=== Trade Processing Test Suite (Mock Data) ===\n');
	
	var world;
	var results = [];
	
	try {
		// Setup
		await createMockConfig({ season: TEST_SEASON });
		world = await setupMockWorld();
		
		// Run tests
		results.push({ name: 'Basic 2-Party Swap', pass: await test1_BasicPlayerSwap(world) });
		
		// Reset for next test
		await teardownMockWorld();
		await createMockConfig({ season: TEST_SEASON });
		world = await setupMockWorld();
		
		results.push({ name: '3-Party Trade', pass: await test2_ThreePartyTrade(world) });
		
		await teardownMockWorld();
		await createMockConfig({ season: TEST_SEASON });
		world = await setupMockWorld();
		
		results.push({ name: 'Cash Transfer', pass: await test3_CashTransfer(world) });
		
		await teardownMockWorld();
		await createMockConfig({ season: TEST_SEASON });
		world = await setupMockWorld();
		
		results.push({ name: 'Hard Cap Violation', pass: await test4_HardCapViolation(world) });
		
		await teardownMockWorld();
		await createMockConfig({ season: TEST_SEASON });
		world = await setupMockWorld();
		
		results.push({ name: 'Soft Cap Warning', pass: await test5_SoftCapWarning(world) });
		
		await teardownMockWorld();
		await createMockConfig({ season: TEST_SEASON });
		world = await setupMockWorld();
		
		results.push({ name: 'Basic Cut', pass: await test6_BasicCut(world) });
		
		await teardownMockWorld();
		await createMockConfig({ season: TEST_SEASON });
		world = await setupMockWorld();
		
		results.push({ name: 'Cut Dead Money Calculation', pass: await test7_CutDeadMoney(world) });
		
		await teardownMockWorld();
		await createMockConfig({ season: TEST_SEASON });
		world = await setupMockWorld();
		
		results.push({ name: 'Cut Invalid Player', pass: await test8_CutInvalidPlayer(world) });
		
	} catch (err) {
		console.error('\nTest error:', err);
	} finally {
		await teardownMockWorld();
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
