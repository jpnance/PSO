var fs = require('fs');
var path = require('path');

var Player = require('../models/Player');
var Contract = require('../models/Contract');
var Franchise = require('../models/Franchise');
var Regime = require('../models/Regime');
var LeagueConfig = require('../models/LeagueConfig');
var Budget = require('../models/Budget');

var PSO = require('../config/pso');
var { isRfaRights } = require('../helpers/contract');

var POSITIONS = ['QB', 'RB', 'WR', 'TE', 'DL', 'LB', 'DB', 'K'];

var FRANCHISE_COLORS = {
	1: '#e74c3c',   // red
	2: '#3498db',   // blue
	3: '#2ecc71',   // green
	4: '#9b59b6',   // purple
	5: '#f39c12',   // orange
	6: '#1abc9c',   // teal
	7: '#e91e63',   // pink
	8: '#00bcd4',   // cyan
	9: '#ff5722',   // deep orange
	10: '#8bc34a',  // light green
	11: '#ffc107',  // amber
	12: '#607d8b'   // blue grey
};

var RATING_THRESHOLDS = {
	QB: [8, 13, 16, 18],   // 1: <8, 2: 8-13, 3: 13-16, 4: 16-18, 5: 18+
	RB: [5, 8, 10, 13],    // 1: <5, 2: 5-8, 3: 8-10, 4: 10-13, 5: 13+
	WR: [4, 6, 8, 10],     // 1: <4, 2: 4-6, 3: 6-8, 4: 8-10, 5: 10+
	TE: [4, 5, 6, 8],      // 1: <4, 2: 4-5, 3: 5-6, 4: 6-8, 5: 8+
	DL: [3.5, 4.5, 5, 6],  // 1: <3.5, 2: 3.5-4.5, 3: 4.5-5, 4: 5-6, 5: 6+
	LB: [4, 5, 6, 7],      // 1: <4, 2: 4-5, 3: 5-6, 4: 6-7, 5: 7+
	DB: [3.5, 4.5, 5.5, 6],// 1: <3.5, 2: 3.5-4.5, 3: 4.5-5.5, 4: 5.5-6, 5: 6+
	K: [5, 6, 7, 8]        // 1: <5, 2: 5-6, 3: 6-7, 4: 7-8, 5: 8+
};

var SCORING_SYSTEM = {
	pass_yd: 0.04,
	pass_td: 4.0,
	pass_int: -2.0,
	pass_2pt: 2.0,
	rush_yd: 0.1,
	rush_td: 6.0,
	rec_yd: 0.1,
	rec_td: 6.0,
	fum_lost: -1.0,
	idp_tkl_solo: 1.0,
	idp_tkl_ast: 0.5,
	idp_sack: 3.5,
	idp_int: 3.0,
	idp_ff: 3.0,
	idp_fum_rec: 1.0,
	def_td: 6.0
};

var POSITION_MAP = {
	CB: 'DB',
	DE: 'DL',
	DT: 'DL',
	FB: 'RB',
	FS: 'DB',
	ILB: 'LB',
	OLB: 'LB',
	NT: 'DL',
	S: 'DB',
	SS: 'DB'
};

function calculatePsoPoints(stats) {
	var points = 0;
	Object.keys(SCORING_SYSTEM).forEach(function(category) {
		if (stats[category]) {
			points += SCORING_SYSTEM[category] * stats[category];
		}
	});
	return points;
}

function calculateRating(perGamePoints, position) {
	var thresholds = RATING_THRESHOLDS[position];
	if (!thresholds) return 3;
	
	var rating = 1;
	thresholds.forEach(function(threshold) {
		if (perGamePoints >= threshold) {
			rating += 1;
		}
	});
	return Math.min(5, rating);
}

function normalizePosition(pos) {
	return POSITION_MAP[pos] || pos;
}

function loadProjections() {
	try {
		var projectionsPath = path.join(__dirname, '../public/data/sleeper-projections.json');
		var data = fs.readFileSync(projectionsPath, 'utf8');
		return JSON.parse(data);
	} catch (e) {
		console.warn('Could not load Sleeper projections:', e.message);
		return [];
	}
}

function loadByeWeeks() {
	try {
		var byeWeeksPath = path.join(__dirname, '../public/data/nfl-bye-weeks.json');
		var data = fs.readFileSync(byeWeeksPath, 'utf8');
		var parsed = JSON.parse(data);
		return parsed.teams || {};
	} catch (e) {
		console.warn('Could not load bye weeks:', e.message);
		return {};
	}
}

function buildProjectionsMap(projections) {
	var map = {};
	projections.forEach(function(p) {
		if (!p.player_id || !p.stats) return;
		
		var psoPoints = calculatePsoPoints(p.stats);
		var perGame = psoPoints / 17;
		
		var positions = [];
		if (p.player && p.player.fantasy_positions) {
			positions = p.player.fantasy_positions.map(normalizePosition);
			positions = positions.filter(function(pos) {
				return POSITIONS.includes(pos);
			});
		}
		
		var primaryPos = positions[0] || 'RB';
		var rating = calculateRating(perGame, primaryPos);
		
		map[p.player_id] = {
			fpts: psoPoints,
			fptsPerGame: perGame,
			rating: rating,
			team: p.player ? p.player.team : null,
			positions: positions
		};
	});
	return map;
}

// GET /admin/prep - main prep dashboard
exports.prepPage = async function(request, response) {
	try {
		var config = await LeagueConfig.findById('pso').lean();
		
		response.render('admin-prep', {
			navState: 'admin-prep',
			config: config
		});
	} catch (error) {
		console.error('Error loading prep page:', error);
		response.status(500).send('Error loading prep page');
	}
};

// GET /admin/prep/data - API endpoint for player data
exports.prepData = async function(request, response) {
	try {
		var config = await LeagueConfig.findById('pso').lean();
		var season = config ? config.season : new Date().getFullYear();
		
		var projections = loadProjections();
		var projectionsMap = buildProjectionsMap(projections);
		var byeWeeks = loadByeWeeks();
		
		var [players, contracts, franchises, regimes, budgets] = await Promise.all([
			Player.find({ active: true }).lean(),
			Contract.find({}).populate('franchiseId').lean(),
			Franchise.find({}).lean(),
			Regime.find({ 'tenures.endSeason': null }).populate('ownerIds').lean(),
			Budget.find({ season: season }).lean()
		]);
		
		var contractsByPlayerId = {};
		contracts.forEach(function(c) {
			contractsByPlayerId[c.playerId.toString()] = c;
		});
		
		var regimesByFranchiseId = {};
		regimes.forEach(function(r) {
			r.tenures.forEach(function(t) {
				if (t.endSeason === null) {
					regimesByFranchiseId[t.franchiseId.toString()] = r;
				}
			});
		});
		
		var budgetsByFranchiseId = {};
		budgets.forEach(function(b) {
			budgetsByFranchiseId[b.franchiseId.toString()] = b;
		});
		
		var franchiseData = franchises.map(function(f) {
			var regime = regimesByFranchiseId[f._id.toString()];
			var budget = budgetsByFranchiseId[f._id.toString()];
			return {
				id: f._id.toString(),
				name: regime ? regime.displayName : 'Unknown',
				rosterId: f.rosterId,
				color: FRANCHISE_COLORS[f.rosterId] || '#666',
				capAvailable: budget ? budget.available : 1000
			};
		});
		
		var playerData = [];
		
		players.forEach(function(player) {
			var proj = projectionsMap[player.sleeperId];
			if (!proj) return;
			
			var contract = contractsByPlayerId[player._id.toString()];
			var franchise = null;
			var contractInfo = null;
			
			if (contract) {
				var franchiseId = contract.franchiseId._id ? contract.franchiseId._id.toString() : contract.franchiseId.toString();
				franchise = franchiseData.find(function(f) { return f.id === franchiseId; });
				
				if (isRfaRights(contract)) {
					contractInfo = { type: 'rfa', display: 'RFA' };
				} else {
					var startStr = contract.startYear ? String(contract.startYear).slice(-2) : '??';
					var endStr = contract.endYear ? String(contract.endYear).slice(-2) : '??';
					contractInfo = {
						type: 'signed',
						display: startStr + '/' + endStr,
						salary: contract.salary,
						startYear: contract.startYear,
						endYear: contract.endYear
					};
				}
			} else {
				contractInfo = { type: 'ufa', display: 'UFA' };
			}
			
			var positions = proj.positions.length > 0 ? proj.positions : player.positions;
			positions = positions.filter(function(p) { return POSITIONS.includes(p); });
			
			var isRookie = player.rookieYear === season;
			
			var playerTeam = proj.team || player.team;
			playerData.push({
				id: player._id.toString(),
				sleeperId: player.sleeperId,
				name: player.name,
				team: playerTeam,
				bye: byeWeeks[playerTeam] || null,
				positions: positions,
				franchise: franchise ? franchise.id : null,
				franchiseName: franchise ? franchise.name : null,
				contract: contractInfo,
				salary: contractInfo.salary || 0,
				fpts: Math.round(proj.fpts * 10) / 10,
				fptsPerGame: Math.round(proj.fptsPerGame * 100) / 100,
				rating: proj.rating,
				rookie: isRookie,
				searchRank: player.searchRank
			});
		});
		
		playerData.sort(function(a, b) {
			return b.fpts - a.fpts;
		});
		
		response.json({
			season: season,
			franchises: franchiseData,
			players: playerData
		});
	} catch (error) {
		console.error('Error loading prep data:', error);
		response.status(500).json({ error: 'Failed to load data' });
	}
};
