var LeagueConfig = require('../models/LeagueConfig');
var Franchise = require('../models/Franchise');
var Player = require('../models/Player');
var Regime = require('../models/Regime');
var Transaction = require('../models/Transaction');

var positionOrder = ['QB', 'RB', 'WR', 'TE', 'DL', 'LB', 'DB', 'K'];

function sortPositions(positions) {
	if (!positions || positions.length === 0) return [];
	return positions.slice().sort(function(a, b) {
		var idxA = positionOrder.indexOf(a);
		var idxB = positionOrder.indexOf(b);
		if (idxA === -1) idxA = 99;
		if (idxB === -1) idxB = 99;
		return idxA - idxB;
	});
}

function getDisplayName(regimes, franchiseId, season) {
	if (!franchiseId) return null;
	var fIdStr = franchiseId.toString();
	var regime = regimes.find(function(r) {
		return r.tenures.some(function(t) {
			return t.franchiseId.toString() === fIdStr &&
				t.startSeason <= season &&
				(t.endSeason === null || t.endSeason >= season);
		});
	});
	return regime ? regime.displayName : null;
}

function formatAuctionType(type) {
	if (type === 'auction-ufa') {
		return 'UFA';
	} else if (type === 'auction-rfa-matched') {
		return 'RFA matched';
	}
	return type;
}

async function resultsPage(request, response) {
	var config = await LeagueConfig.findById('pso');
	var season = config ? config.season : new Date().getFullYear();

	var regimes = await Regime.find({}).lean();
	var franchises = await Franchise.find({}).lean();

	var franchiseById = {};
	franchises.forEach(function(f) {
		franchiseById[f._id.toString()] = f;
	});

	var auctionTransactions = await Transaction.find({
		type: { $in: ['auction-ufa', 'auction-rfa-matched', 'auction-rfa-unmatched'] }
	}).sort({ timestamp: -1 }).lean();

	var playerIds = auctionTransactions
		.filter(function(t) { return t.playerId; })
		.map(function(t) { return t.playerId; });

	var players = await Player.find({ _id: { $in: playerIds } }).lean();
	var playerMap = {};
	players.forEach(function(p) {
		playerMap[p._id.toString()] = p;
	});

	var results = auctionTransactions.map(function(t) {
		var player = t.playerId ? playerMap[t.playerId.toString()] : null;
		var winner = getDisplayName(regimes, t.franchiseId, season);
		var rfaHolder = t.rfaHolderId ? getDisplayName(regimes, t.rfaHolderId, season) : null;
		var originalBidder = t.originalBidderId ? getDisplayName(regimes, t.originalBidderId, season) : null;
		var franchise = t.franchiseId ? franchiseById[t.franchiseId.toString()] : null;

		return {
			_id: t._id,
			timestamp: t.timestamp,
		playerName: player ? player.name : 'Unknown',
		playerSlug: player && player.slugs && player.slugs.length > 0 ? player.slugs[0] : null,
			positions: player ? sortPositions(player.positions) : [],
			team: player ? player.team : null,
			winner: winner,
			winnerRosterId: franchise ? franchise.rosterId : null,
			winningBid: t.winningBid,
			type: t.type,
			typeDisplay: formatAuctionType(t.type),
			rfaHolder: rfaHolder,
			originalBidder: originalBidder
		};
	});

	var currentSeasonResults = results.filter(function(r) {
		return r.timestamp && r.timestamp.getFullYear() === season;
	});

	response.render('auction-results', {
		season: season,
		results: currentSeasonResults,
		allResults: results,
		activePage: 'auction'
	});
}

module.exports = {
	resultsPage: resultsPage
};
