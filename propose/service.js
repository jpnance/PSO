var LeagueConfig = require('../models/LeagueConfig');
var Franchise = require('../models/Franchise');
var Regime = require('../models/Regime');
var Contract = require('../models/Contract');
var Pick = require('../models/Pick');

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
	
	// Build franchise list with display names
	var franchiseList = franchises.map(function(f) {
		var regime = regimes.find(function(r) {
			return r.franchiseId.equals(f._id) &&
				r.startSeason <= currentSeason &&
				(r.endSeason === null || r.endSeason >= currentSeason);
		});
		
		return {
			_id: f._id,
			displayName: regime ? regime.displayName : 'Unknown'
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
		
		teams[franchiseId].push({
			id: c.playerId._id.toString(),
			name: c.playerId.name,
			positions: c.playerId.positions || [],
			salary: c.salary,
			terms: terms,
			contract: contract
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
			owner: owner,
			ownerId: (p.currentFranchiseId._id || p.currentFranchiseId).toString(),
			origin: origin
		};
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
		
		response.render('trade', {
			franchises: data.franchises,
			teams: data.teams,
			picks: data.picks,
			season: currentSeason,
			isPlural: isPlural,
			pageTitle: 'Trade Machine - PSO',
			activePage: 'propose'
		});
	} catch (err) {
		console.error(err);
		response.status(500).send('Error loading trade data');
	}
}

module.exports = {
	getTradeData: getTradeData,
	proposePage: proposePage
};
