var Player = require('../models/Player');
var Contract = require('../models/Contract');
var { POSITION_ORDER, sortedPositions } = require('../helpers/view');

// GET /admin/players - list/search players
async function listPlayers(request, response) {
	var query = (request.query.q || '').trim();
	var filterType = request.query.filter || '';
	
	// Only show results if there's a search query or filter
	var hasSearch = query || filterType;
	
	var players = [];
	var totalCount = 0;
	
	if (hasSearch) {
		var filter = {};
		if (query) {
			filter.name = { $regex: query, $options: 'i' };
		}
		
		// Apply filter type
		if (filterType === 'historical') {
			filter.sleeperId = null;
		} else if (filterType === 'no-position') {
			filter.$or = [
				{ positions: { $exists: false } },
				{ positions: { $size: 0 } }
			];
		}
		
		totalCount = await Player.countDocuments(filter);
		
		var rawPlayers = await Player.find(filter)
			.sort({ name: 1 })
			.limit(200) // Reasonable limit for search results
			.lean();
		
		players = rawPlayers.map(function(p) {
			return {
				_id: p._id,
				name: p.name,
				sleeperId: p.sleeperId,
				positions: sortedPositions(p.positions),
				positionDisplay: sortedPositions(p.positions).join('/') || '—',
				college: p.college
			};
		});
	}
	
	response.render('admin-players', {
		players: players,
		query: query,
		filter: filterType,
		totalCount: totalCount,
		hasSearch: hasSearch,
		activePage: 'admin-players'
	});
}

// GET /admin/players/:id - edit form
async function editPlayerForm(request, response) {
	var player = await Player.findById(request.params.id).lean();
	
	if (!player) {
		return response.status(404).send('Player not found');
	}
	
	// Check if player has contracts
	var contracts = await Contract.find({ playerId: player._id })
		.populate('franchiseId')
		.lean();
	
	// Find potential duplicates (same name, different ID)
	// Exclude cases where both players have Sleeper IDs - those are legitimately different people
	var allDuplicates = await Player.find({
		name: { $regex: new RegExp('^' + player.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') },
		_id: { $ne: player._id }
	}).lean();
	
	var potentialDuplicates = allDuplicates.filter(function(dup) {
		// Only show as duplicate if at least one player is not from Sleeper
		return !player.sleeperId || !dup.sleeperId;
	});
	
	response.render('admin-player-edit', {
		player: player,
		positions: sortedPositions(player.positions),
		contracts: contracts,
		potentialDuplicates: potentialDuplicates,
		query: request.query,
		activePage: 'admin-players'
	});
}

// POST /admin/players/:id - save changes
async function editPlayer(request, response) {
	var playerId = request.params.id;
	var body = request.body;
	
	var player = await Player.findById(playerId);
	if (!player) {
		return response.status(404).send('Player not found');
	}
	
	// Update name
	var newName = (body.name || '').trim();
	if (newName && newName !== player.name) {
		player.name = newName;
	}
	
	// Update positions - collect checked positions
	var newPositions = [];
	POSITION_ORDER.forEach(function(pos) {
		if (body['pos_' + pos]) {
			newPositions.push(pos);
		}
	});
	player.positions = newPositions;
	
	// Update sleeperId if provided
	var newSleeperId = (body.sleeperId || '').trim();
	if (newSleeperId !== (player.sleeperId || '')) {
		player.sleeperId = newSleeperId || null;
	}
	
	// Update notes
	var newNotes = (body.notes || '').trim();
	player.notes = newNotes || null;
	
	// Update college (only for historical players without sleeperId)
	if (!player.sleeperId && body.college !== undefined) {
		var newCollege = (body.college || '').trim();
		player.college = newCollege || null;
	}
	
	await player.save();
	
	response.redirect('/admin/players/' + playerId + '?saved=1');
}

// POST /admin/players/:id/merge - merge another player into this one
async function mergePlayer(request, response) {
	var targetId = request.params.id;
	var sourceId = request.body.sourceId;
	
	if (!sourceId) {
		return response.status(400).send('Source player ID required');
	}
	
	var targetPlayer = await Player.findById(targetId);
	var sourcePlayer = await Player.findById(sourceId);
	
	if (!targetPlayer || !sourcePlayer) {
		return response.status(404).send('Player not found');
	}
	
	// Update all contracts to point to target player
	var result = await Contract.updateMany(
		{ playerId: sourceId },
		{ $set: { playerId: targetId } }
	);
	
	// Merge positions (add any from source that target doesn't have)
	var targetPositions = targetPlayer.positions || [];
	var sourcePositions = sourcePlayer.positions || [];
	sourcePositions.forEach(function(pos) {
		if (!targetPositions.includes(pos)) {
			targetPositions.push(pos);
		}
	});
	targetPlayer.positions = targetPositions;
	
	// If target has no sleeperId but source does, take it
	if (!targetPlayer.sleeperId && sourcePlayer.sleeperId) {
		targetPlayer.sleeperId = sourcePlayer.sleeperId;
	}
	
	await targetPlayer.save();
	
	// Delete the source player
	await Player.deleteOne({ _id: sourceId });
	
	response.redirect('/admin/players/' + targetId + '?merged=1&contracts=' + result.modifiedCount);
}

// GET /admin/players/new - new player form
async function newPlayerForm(request, response) {
	response.render('admin-player-new', {
		activePage: 'admin-players'
	});
}

// POST /admin/players/new - create player
async function createPlayer(request, response) {
	var body = request.body;
	
	var name = (body.name || '').trim();
	if (!name) {
		return response.status(400).send('Name is required');
	}
	
	// Collect positions
	var positions = [];
	POSITION_ORDER.forEach(function(pos) {
		if (body['pos_' + pos]) {
			positions.push(pos);
		}
	});
	
	var sleeperId = (body.sleeperId || '').trim() || null;
	
	var player = new Player({
		name: name,
		positions: positions,
		sleeperId: sleeperId
	});
	
	await player.save();
	
	response.redirect('/admin/players/' + player._id + '?created=1');
}

module.exports = {
	listPlayers: listPlayers,
	editPlayerForm: editPlayerForm,
	editPlayer: editPlayer,
	mergePlayer: mergePlayer,
	newPlayerForm: newPlayerForm,
	createPlayer: createPlayer
};
