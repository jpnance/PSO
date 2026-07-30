var Contract = require('../models/Contract');
var Franchise = require('../models/Franchise');
var LeagueConfig = require('../models/LeagueConfig');
var Player = require('../models/Player');
var Regime = require('../models/Regime');
var PSO = require('../config/pso');

var positionOrder = ['QB', 'RB', 'WR', 'TE', 'DL', 'LB', 'DB', 'K'];

function buildFlexibleNamePattern(query) {
	var escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	var chars = escaped.split('');
	var pattern = chars.map(function(char, i) {
		if (i < chars.length - 1) {
			return char + "[.\\s'-]*";
		}
		return char;
	}).join('');
	return pattern;
}

function getDisplayName(regimes, franchiseId) {
	if (!franchiseId) return null;
	var fIdStr = franchiseId.toString();
	var regime = regimes.find(function(r) {
		return r.tenures.some(function(t) {
			return t.franchiseId.toString() === fIdStr && t.endSeason === null;
		});
	});
	return regime ? regime.displayName : null;
}

function getPositionKey(positions) {
	if (!positions || positions.length === 0) return '';
	var sorted = positions.slice().sort(function(a, b) {
		var idxA = positionOrder.indexOf(a);
		var idxB = positionOrder.indexOf(b);
		if (idxA === -1) idxA = 99;
		if (idxB === -1) idxB = 99;
		return idxA - idxB;
	});
	return sorted.join('/');
}

// Determine auction situation for a contract
function getSituation(contract, regimeDisplayName) {
	if (contract.salary === null) {
		return 'RFA-' + (regimeDisplayName || 'Unknown');
	}
	if (contract.startYear && contract.endYear && contract.endYear - contract.startYear >= 1) {
		return 'RFA-' + (regimeDisplayName || 'Unknown');
	}
	return 'UFA';
}

async function adminPage(request, response) {
	var config = await LeagueConfig.findById('pso');
	var season = config ? config.season : new Date().getFullYear();

	var situations = ['UFA'];

	var regimes = await Regime.find({ 'tenures.endSeason': null }).lean();
	regimes.forEach(function(r) {
		situations.push('RFA-' + r.displayName);
	});
	situations.sort();

	response.render('auction-admin-live', {
		owners: PSO.nominationOrder,
		positions: positionOrder,
		situations: situations,
		referenceSite: 'https://www.pro-football-reference.com/search/search.fcgi?search=',
		webSocketUrl: process.env.WEB_SOCKET_URL,
		season: season
	});
}

async function searchPlayers(request, response) {
	var query = (request.query.q || '').trim();
	if (query.length < 2) {
		return response.render('partials/auction-search-results', { results: [] });
	}

	var config = await LeagueConfig.findById('pso');
	var season = config ? config.season : new Date().getFullYear();

	var namePattern = buildFlexibleNamePattern(query);

	var players = await Player.aggregate([
		{ $match: { name: { $regex: namePattern, $options: 'i' } } },
		{ $addFields: { searchRankSort: { $ifNull: ['$searchRank', 999999999] } } },
		{ $sort: { searchRankSort: 1, name: 1 } },
		{ $limit: 15 }
	]);

	var playerIds = players.map(function(p) { return p._id; });
	var contracts = await Contract.find({ playerId: { $in: playerIds } }).lean();
	var contractByPlayer = {};
	contracts.forEach(function(c) {
		contractByPlayer[c.playerId.toString()] = c;
	});

	var regimes = await Regime.find({ 'tenures.endSeason': null }).lean();

	var results = players.map(function(p) {
		var contract = contractByPlayer[p._id.toString()];
		var franchise = null;
		var situation = 'UFA';
		var detail = null;
		var owned = false;

		if (contract) {
			franchise = getDisplayName(regimes, contract.franchiseId);

			if (contract.salary === null) {
				situation = 'RFA-' + (franchise || 'Unknown');
				detail = 'RFA rights: ' + (franchise || 'Unknown');
			} else if (contract.endYear && contract.endYear < season) {
				situation = 'UFA';
				detail = 'Contract expired';
			} else if (contract.endYear && contract.endYear === season) {
				situation = getSituation(contract, franchise);
				detail = franchise + ' · $' + contract.salary + ' · ' + (contract.startYear % 100) + '/' + (contract.endYear % 100);
			} else if (contract.endYear && contract.endYear > season) {
				owned = true;
				detail = franchise + ' · $' + contract.salary + ' · ' + (contract.startYear % 100) + '/' + (contract.endYear % 100);
			}
		}

		return {
			_id: p._id,
			name: p.name,
			positions: p.positions || [],
			positionKey: getPositionKey(p.positions || []),
			team: p.team || null,
			franchise: franchise,
			situation: situation,
			detail: detail,
			owned: owned
		};
	});

	response.render('partials/auction-search-results', { results: results });
}

module.exports = {
	adminPage: adminPage,
	searchPlayers: searchPlayers
};
