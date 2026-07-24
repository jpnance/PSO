var LeagueConfig = require('../models/LeagueConfig');
var Franchise = require('../models/Franchise');
var Regime = require('../models/Regime');
var Pick = require('../models/Pick');
var Player = require('../models/Player');
var Contract = require('../models/Contract');
var Transaction = require('../models/Transaction');
var { processDraftPick, processDraftPass, getRookieSalary } = require('./transaction');
var { sortedPositions } = require('../helpers/view');

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

function getDisplayName(regimes, franchiseId, season) {
	if (!franchiseId) return 'Unknown';
	var fIdStr = franchiseId.toString();
	var regime = regimes.find(function(r) {
		return r.tenures.some(function(t) {
			return t.franchiseId.toString() === fIdStr &&
				t.startSeason <= season &&
				(t.endSeason === null || t.endSeason >= season);
		});
	});
	return regime ? regime.displayName : 'Unknown';
}

function formatPickSlot(pickNumber, round, picksPerRound) {
	if (!pickNumber) return null;
	var slot = pickNumber - (round - 1) * picksPerRound;
	return round + '.' + String(slot).padStart(2, '0');
}

async function getDraftState(season) {
	var picks = await Pick.find({ season: season }).sort({ pickNumber: 1 }).lean();
	var regimes = await Regime.find({}).lean();
	var franchises = await Franchise.find({}).lean();
	var picksPerRound = (season <= 2011) ? 10 : 12;

	var franchiseById = {};
	franchises.forEach(function(f) {
		franchiseById[f._id.toString()] = f;
	});

	var selections = await Transaction.find({
		type: { $in: ['draft-select', 'draft-pass'] },
		pickId: { $in: picks.map(function(p) { return p._id; }) }
	}).lean();

	var selectionMap = {};
	selections.forEach(function(s) {
		selectionMap[s.pickId.toString()] = s;
	});

	var playerIds = selections
		.filter(function(s) { return s.playerId; })
		.map(function(s) { return s.playerId; });
	var players = await Player.find({ _id: { $in: playerIds } }).lean();
	var playerMap = {};
	players.forEach(function(p) {
		playerMap[p._id.toString()] = p;
	});

	var currentPick = null;
	var upcomingPicks = [];
	var completedPicks = [];

	picks.forEach(function(pick) {
		var selection = selectionMap[pick._id.toString()];
		var player = selection && selection.playerId ? playerMap[selection.playerId.toString()] : null;

		var originalOwner = getDisplayName(regimes, pick.originalFranchiseId, season);
		var currentOwner = getDisplayName(regimes, pick.currentFranchiseId, season);
		var fromOwner = null;
		if (!pick.originalFranchiseId.equals(pick.currentFranchiseId)) {
			fromOwner = originalOwner;
		}

		var pickData = {
			_id: pick._id,
			pickNumber: pick.pickNumber,
			pickDisplay: formatPickSlot(pick.pickNumber, pick.round, picksPerRound),
			round: pick.round,
			status: pick.status,
			currentOwner: currentOwner,
			currentFranchiseId: pick.currentFranchiseId,
			franchiseRosterId: franchiseById[pick.currentFranchiseId.toString()] ? franchiseById[pick.currentFranchiseId.toString()].rosterId : null,
			fromOwner: fromOwner,
			playerName: player ? player.name : null,
			positions: player ? sortedPositions(player.positions) : null,
			salary: selection ? selection.salary : null
		};

		if (pick.status === 'available' && !currentPick) {
			currentPick = pickData;
		} else if (pick.status === 'available' && currentPick) {
			upcomingPicks.push(pickData);
		} else if (pick.status !== 'available') {
			completedPicks.push(pickData);
		}
	});

	// Only show completed picks up to the current pick
	// (hides pre-passed picks that haven't been "reached" yet)
	if (currentPick) {
		completedPicks = completedPicks.filter(function(p) {
			return p.pickNumber < currentPick.pickNumber;
		});
	}

	// Build the current round's picks for the round tracker
	var currentRoundPicks = [];
	if (currentPick) {
		picks.forEach(function(pick) {
			if (pick.round !== currentPick.round) return;
			var selection = selectionMap[pick._id.toString()];
			var player = selection && selection.playerId ? playerMap[selection.playerId.toString()] : null;
			currentRoundPicks.push({
				pickNumber: pick.pickNumber,
				currentOwner: getDisplayName(regimes, pick.currentFranchiseId, season),
				status: pick.status,
				isCurrent: pick._id.toString() === currentPick._id.toString(),
				playerName: player ? player.name : null
			});
		});
	}

	// Next picks for the tracker (next 11 after current)
	var nextPicks = [];
	if (currentPick) {
		var foundCurrent = false;
		var lastRound = currentPick.round;
		picks.forEach(function(pick) {
			if (foundCurrent && nextPicks.length < 11 && pick.status === 'available') {
				nextPicks.push({
					pickNumber: pick.pickNumber,
					currentOwner: getDisplayName(regimes, pick.currentFranchiseId, season),
					newRound: pick.round !== lastRound
				});
				lastRound = pick.round;
			}
			if (pick._id.toString() === currentPick._id.toString()) {
				foundCurrent = true;
			}
		});
	}

	return {
		picks: picks,
		currentPick: currentPick,
		upcomingPicks: upcomingPicks,
		currentRoundPicks: currentRoundPicks,
		nextPicks: nextPicks,
		completedPicks: completedPicks,
		totalPicks: picks.length,
		picksPerRound: picksPerRound
	};
}

async function livePage(request, response) {
	var config = await LeagueConfig.findById('pso');
	var season = config ? config.season : new Date().getFullYear();
	var draftState = await getDraftState(season);

	// Build salary reference table for the current season
	var positionOrder = ['QB', 'RB', 'WR', 'TE', 'DL', 'LB', 'DB', 'K'];
	var rounds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
	var salaryTable = rounds.map(function(round) {
		var row = { round: round };
		positionOrder.forEach(function(pos) {
			row[pos] = getRookieSalary(season, round, [pos]);
		});
		return row;
	});

	response.render('draft-live', {
		season: season,
		currentPick: draftState.currentPick,
		nextPicks: draftState.nextPicks,
		completedPicks: draftState.completedPicks,
		totalPicks: draftState.totalPicks,
		salaryTable: salaryTable,
		positionOrder: positionOrder,
		activePage: 'admin'
	});
}

async function searchRookies(request, response) {
	var query = (request.query.q || '').trim();
	if (query.length < 2) {
		return response.render('partials/draft-live-results', { results: [] });
	}

	var config = await LeagueConfig.findById('pso');
	var season = config ? config.season : new Date().getFullYear();

	var namePattern = buildFlexibleNamePattern(query);

	var players = await Player.aggregate([
		{ $match: {
			name: { $regex: namePattern, $options: 'i' },
			rookieYear: season,
			active: true
		}},
		{ $addFields: { searchRankSort: { $ifNull: ['$searchRank', 999999999] } } },
		{ $sort: { searchRankSort: 1, name: 1 } },
		{ $limit: 10 }
	]);

	var playerIds = players.map(function(p) { return p._id; });
	var contracts = await Contract.find({ playerId: { $in: playerIds } }).lean();
	var contractByPlayer = {};
	contracts.forEach(function(c) {
		contractByPlayer[c.playerId.toString()] = c;
	});

	var regimes = await Regime.find({ 'tenures.endSeason': null }).lean();
	var franchises = await Franchise.find({}).lean();
	var franchiseById = {};
	franchises.forEach(function(f) {
		franchiseById[f._id.toString()] = f;
	});

	var results = players.map(function(p) {
		var contract = contractByPlayer[p._id.toString()];
		var psoTeam = null;
		if (contract) {
			psoTeam = getDisplayName(regimes, contract.franchiseId, season);
		}

		return {
			_id: p._id,
			name: p.name,
			positions: sortedPositions(p.positions || []),
			team: p.team || null,
			psoTeam: psoTeam
		};
	});

	response.render('partials/draft-live-results', { results: results });
}

async function selectPlayer(request, response) {
	try {
		var pickId = request.body.pickId;
		var playerId = request.body.playerId;

		var pick = await Pick.findById(pickId);
		if (!pick) {
			return response.status(400).json({ success: false, errors: ['Pick not found'] });
		}

		var result = await processDraftPick({
			pickId: pickId,
			playerId: playerId,
			franchiseId: pick.currentFranchiseId
		});

		if (!result.success) {
			return response.status(400).json(result);
		}

		var player = await Player.findById(playerId).lean();
		var regimes = await Regime.find({}).lean();
		var config = await LeagueConfig.findById('pso');
		var season = config ? config.season : new Date().getFullYear();

		response.json({
			success: true,
			pick: {
				pickNumber: pick.pickNumber,
				currentOwner: getDisplayName(regimes, pick.currentFranchiseId, season),
				playerName: player ? player.name : null,
				positions: player ? sortedPositions(player.positions) : null,
				salary: result.transaction.salary
			}
		});
	} catch (err) {
		console.error('Draft select error:', err);
		response.status(500).json({ success: false, errors: ['Server error'] });
	}
}

async function passOnPick(request, response) {
	try {
		var pickId = request.body.pickId;

		var result = await processDraftPass({ pickId: pickId });

		if (!result.success) {
			return response.status(400).json(result);
		}

		var pick = await Pick.findById(pickId).lean();
		var regimes = await Regime.find({}).lean();
		var config = await LeagueConfig.findById('pso');
		var season = config ? config.season : new Date().getFullYear();

		response.json({
			success: true,
			pick: {
				pickNumber: pick.pickNumber,
				currentOwner: getDisplayName(regimes, pick.currentFranchiseId, season)
			}
		});
	} catch (err) {
		console.error('Draft pass error:', err);
		response.status(500).json({ success: false, errors: ['Server error'] });
	}
}

// Returns the current pick and salary preview for a given player
async function previewSalary(request, response) {
	var config = await LeagueConfig.findById('pso');
	var season = config ? config.season : new Date().getFullYear();

	var playerId = request.query.playerId;
	var pickId = request.query.pickId;

	var player = await Player.findById(playerId).lean();
	var pick = await Pick.findById(pickId).lean();

	if (!player || !pick) {
		return response.status(400).send('Player or pick not found');
	}

	var salary = getRookieSalary(season, pick.round, player.positions || []);
	response.render('partials/draft-live-confirm', {
		player: {
			name: player.name,
			positions: sortedPositions(player.positions || []),
			team: player.team || null
		},
		salary: salary
	});
}

async function passAllForFranchise(request, response) {
	try {
		var config = await LeagueConfig.findById('pso');
		var season = config ? config.season : new Date().getFullYear();
		var franchiseId = request.body.franchiseId;

		var picks = await Pick.find({
			season: season,
			currentFranchiseId: franchiseId,
			status: 'available'
		}).sort({ pickNumber: 1 }).lean();

		if (picks.length === 0) {
			return response.status(400).json({ success: false, errors: ['No available picks for this franchise'] });
		}

		for (var i = 0; i < picks.length; i++) {
			var result = await processDraftPass({ pickId: picks[i]._id });
			if (!result.success) {
				return response.status(400).json({ success: false, errors: ['Failed on pick #' + picks[i].pickNumber + ': ' + result.errors.join(', ')] });
			}
		}

		response.json({ success: true, passedCount: picks.length });
	} catch (err) {
		console.error('Draft pass-all error:', err);
		response.status(500).json({ success: false, errors: ['Server error'] });
	}
}

function confirmPass(request, response) {
	response.render('partials/draft-live-pass-confirm');
}

function confirmPassAll(request, response) {
	var ownerName = request.query.ownerName || 'this franchise';
	response.render('partials/draft-live-pass-all-confirm', { ownerName: ownerName });
}

module.exports = {
	livePage: livePage,
	searchRookies: searchRookies,
	selectPlayer: selectPlayer,
	passOnPick: passOnPick,
	passAllForFranchise: passAllForFranchise,
	previewSalary: previewSalary,
	confirmPass: confirmPass,
	confirmPassAll: confirmPassAll
};
