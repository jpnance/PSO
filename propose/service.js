var mongoose = require('mongoose');
var LeagueConfig = require('../models/LeagueConfig');
var Franchise = require('../models/Franchise');
var Regime = require('../models/Regime');
var Contract = require('../models/Contract');
var Budget = require('../models/Budget');
var Pick = require('../models/Pick');
var Transaction = require('../models/Transaction');
var transactionService = require('../transaction/service');
var budgetHelper = require('../helpers/budget');

var computeBuyOutIfCut = budgetHelper.computeBuyOutIfCut;

// Position sort order for roster display
var positionOrder = ['QB', 'RB', 'WR', 'TE', 'DL', 'LB', 'DB', 'K'];

function getPositionIndex(positions) {
	if (!positions || positions.length === 0) return 999;
	return Math.min.apply(null, positions.map(function(p) {
		var idx = positionOrder.indexOf(p);
		return idx === -1 ? 999 : idx;
	}));
}

// Get all data needed for the trade machine
async function getTradeData(currentSeason) {
	// Get all franchises and their current regimes
	var franchises = await Franchise.find({}).lean();
	var regimes = await Regime.find({
		$or: [
			{ endSeason: null },
			{ endSeason: { $gte: currentSeason } }
		]
	}).lean();
	
	// Get all contracts with player data
	var contracts = await Contract.find({})
		.populate('playerId')
		.lean();
	
	// Get all available picks for upcoming seasons
	var picks = await Pick.find({
		status: 'available',
		season: { $gte: currentSeason }
	})
		.populate('originalFranchiseId')
		.populate('currentFranchiseId')
		.sort({ season: 1, round: 1 })
		.lean();
	
	// Get budgets for current season
	var budgets = await Budget.find({ season: currentSeason }).lean();
	var budgetByFranchise = {};
	budgets.forEach(function(b) {
		budgetByFranchise[b.franchiseId.toString()] = b;
	});
	
	// Build franchise list with display names and budget info
	var franchiseList = franchises.map(function(f) {
		var regime = regimes.find(function(r) {
			return r.franchiseId.equals(f._id) &&
				r.startSeason <= currentSeason &&
				(r.endSeason === null || r.endSeason >= currentSeason);
		});
		
		// Get active contracts (with salary, for current season)
		var activeContracts = contracts.filter(function(c) {
			return c.franchiseId.equals(f._id) && 
				c.salary !== null &&
				c.endYear && c.endYear >= currentSeason;
		});
		
		// Get available and recoverable from Budget document
		var budget = budgetByFranchise[f._id.toString()];
		var available = budget ? budget.available : 1000;
		var recoverable = budget ? budget.recoverable : 0;
		
		return {
			_id: f._id,
			displayName: regime ? regime.displayName : 'Unknown',
			rosterCount: activeContracts.length,
			available: available,
			recoverable: recoverable
		};
	}).sort(function(a, b) {
		return a.displayName.localeCompare(b.displayName);
	});
	
	// Helper to get franchise name by ID
	function getFranchiseName(franchiseId, season) {
		var regime = regimes.find(function(r) {
			return r.franchiseId.equals(franchiseId) &&
				r.startSeason <= (season || currentSeason) &&
				(r.endSeason === null || r.endSeason >= (season || currentSeason));
		});
		return regime ? regime.displayName : 'Unknown';
	}
	
	// Build teams object: { franchiseId: [players] }
	var teams = {};
	franchiseList.forEach(function(f) {
		teams[f._id.toString()] = [];
	});
	
	contracts.forEach(function(c) {
		if (!c.playerId) return;
		
		var franchiseId = c.franchiseId.toString();
		if (!teams[franchiseId]) return;
		
		var terms, contract;
		
		if (c.salary === null) {
			// RFA rights
			terms = 'rfa-rights';
			contract = null;
		} else if (!c.endYear) {
			// Unsigned (shouldn't really happen in normal flow)
			terms = 'unsigned';
			contract = null;
		} else {
			terms = 'signed';
			var startStr = c.startYear ? String(c.startYear % 100).padStart(2, '0') : 'FA';
			var endStr = String(c.endYear % 100).padStart(2, '0');
			contract = startStr + '/' + endStr;
		}
		
		// Calculate this player's recoverable (salary - buyout)
		var playerRecoverable = 0;
		if (c.salary !== null && c.endYear && c.endYear >= currentSeason) {
			var buyOut = computeBuyOutIfCut(c.salary, c.startYear, c.endYear, currentSeason);
			playerRecoverable = c.salary - buyOut;
		}
		
		teams[franchiseId].push({
			id: c.playerId._id.toString(),
			name: c.playerId.name,
			positions: c.playerId.positions || [],
			salary: c.salary,
			terms: terms,
			contract: contract,
			recoverable: playerRecoverable
		});
	});
	
	// Sort each team's roster
	Object.keys(teams).forEach(function(franchiseId) {
		teams[franchiseId].sort(function(a, b) {
			return a.name.localeCompare(b.name);
		});
	});
	
	// Build picks list with origin info
	var pickList = picks.map(function(p) {
		var owner = getFranchiseName(p.currentFranchiseId._id || p.currentFranchiseId, p.season);
		var origin = getFranchiseName(p.originalFranchiseId._id || p.originalFranchiseId, p.season);
		
		return {
			id: p._id.toString(),
			season: p.season,
			round: p.round,
			pickNumber: p.pickNumber || null,
			owner: owner,
			ownerId: (p.currentFranchiseId._id || p.currentFranchiseId).toString(),
			origin: origin
		};
	});
	
	// Sort picks by season, then by pick number (or round + origin if no pick number)
	pickList.sort(function(a, b) {
		// First by season
		if (a.season !== b.season) return a.season - b.season;
		// Then by pick number if both have one
		if (a.pickNumber && b.pickNumber) return a.pickNumber - b.pickNumber;
		// If only one has a pick number, numbered picks first
		if (a.pickNumber && !b.pickNumber) return -1;
		if (!a.pickNumber && b.pickNumber) return 1;
		// Neither has pick number: sort by round, then origin
		if (a.round !== b.round) return a.round - b.round;
		return a.origin.localeCompare(b.origin);
	});
	
	return {
		franchises: franchiseList,
		teams: teams,
		picks: pickList,
		currentSeason: currentSeason
	};
}

// Determine if a franchise name is plural (for grammar)
function isPlural(name) {
	return name === 'Schexes' || name.includes('/');
}

// Route handler for the propose page (trade machine)
async function proposePage(request, response) {
	try {
		var config = await LeagueConfig.findById('pso');
		var currentSeason = config ? config.season : new Date().getFullYear();
		
		var data = await getTradeData(currentSeason);
		
		// Determine if we're before cut day
		var today = new Date();
		var cutDay = config && config.cutDay ? new Date(config.cutDay) : null;
		var isBeforeCutDay = !cutDay || today < cutDay;
		
		// Check if current user is admin
		var isAdmin = request.session && request.session.user && request.session.user.admin;
		
		response.render('trade', {
			franchises: data.franchises,
			teams: data.teams,
			picks: data.picks,
			season: currentSeason,
			isPlural: isPlural,
			isBeforeCutDay: isBeforeCutDay,
			rosterLimit: LeagueConfig.ROSTER_LIMIT,
			isAdmin: isAdmin,
			pageTitle: 'Trade Machine - PSO',
			activePage: 'propose'
		});
	} catch (err) {
		console.error(err);
		response.status(500).send('Error loading trade data');
	}
}

// Submit a trade (admin only)
async function submitTrade(request, response) {
	try {
		var deal = request.body.deal;
		
		if (!deal || typeof deal !== 'object') {
			return response.status(400).json({ success: false, errors: ['Invalid trade data'] });
		}
		
		var franchiseIds = Object.keys(deal);
		
		if (franchiseIds.length < 2) {
			return response.status(400).json({ success: false, errors: ['Trade must have at least 2 parties'] });
		}
		
		// Check for duplicate players across parties (server-side validation)
		var allPlayerIds = [];
		var duplicatePlayers = [];
		
		for (var i = 0; i < franchiseIds.length; i++) {
			var bucket = deal[franchiseIds[i]];
			var players = bucket.players || [];
			
			for (var j = 0; j < players.length; j++) {
				var playerId = players[j].id;
				if (allPlayerIds.includes(playerId)) {
					duplicatePlayers.push(players[j].name || playerId);
				} else {
					allPlayerIds.push(playerId);
				}
			}
		}
		
		if (duplicatePlayers.length > 0) {
			return response.status(400).json({ 
				success: false, 
				errors: ['Duplicate player(s) in trade: ' + duplicatePlayers.join(', ')] 
			});
		}
		
		// Transform client deal format to processTrade format
		var parties = [];
		
		for (var i = 0; i < franchiseIds.length; i++) {
			var franchiseId = franchiseIds[i];
			var bucket = deal[franchiseId];
			
			var receives = {
				players: [],
				picks: [],
				cash: []
			};
			
			// Transform players
			for (var j = 0; j < (bucket.players || []).length; j++) {
				var player = bucket.players[j];
				
				// Look up the contract to get salary/terms
				var contract = await Contract.findOne({ playerId: player.id });
				if (!contract) {
					return response.status(400).json({ 
						success: false, 
						errors: ['Contract not found for player: ' + (player.name || player.id)] 
					});
				}
				
				receives.players.push({
					playerId: contract.playerId,
					salary: contract.salary,
					startYear: contract.startYear,
					endYear: contract.endYear
				});
			}
			
			// Transform picks
			for (var j = 0; j < (bucket.picks || []).length; j++) {
				var pick = bucket.picks[j];
				receives.picks.push({
					pickId: pick.id
				});
			}
			
			// Transform cash
			for (var j = 0; j < (bucket.cash || []).length; j++) {
				var cash = bucket.cash[j];
				receives.cash.push({
					amount: cash.amount,
					season: cash.season,
					fromFranchiseId: cash.from
				});
			}
			
			// franchiseId needs to be ObjectId because processTrade() uses .equals() on it
			parties.push({
				franchiseId: new mongoose.Types.ObjectId(franchiseId),
				receives: receives
			});
		}
		
		// Call processTrade (with validateOnly flag if set)
		var validateOnly = request.body.validateOnly === true;
		
		var result = await transactionService.processTrade({
			timestamp: new Date(),
			source: 'manual',
			notes: request.body.notes || null,
			parties: parties,
			validateOnly: validateOnly
		});
		
		if (result.success) {
			if (result.validated) {
				// Validation only - no transaction created yet
				response.json({
					success: true,
					validated: true,
					warnings: result.warnings || []
				});
			} else {
				// Trade executed
				response.json({
					success: true,
					tradeId: result.transaction.tradeId,
					warnings: result.warnings || []
				});
			}
		} else {
			response.status(400).json({
				success: false,
				errors: result.errors || ['Unknown error processing trade']
			});
		}
	} catch (err) {
		console.error('submitTrade error:', err);
		response.status(500).json({ success: false, errors: ['Server error: ' + err.message] });
	}
}

module.exports = {
	getTradeData: getTradeData,
	proposePage: proposePage,
	submitTrade: submitTrade
};
