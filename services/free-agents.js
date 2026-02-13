var Contract = require('../models/Contract');
var Regime = require('../models/Regime');

// Position sort order
var positionOrder = ['QB', 'RB', 'WR', 'TE', 'DL', 'LB', 'DB', 'K'];

function getPositionIndex(positions) {
	if (!positions || positions.length === 0) return 99;
	for (var i = 0; i < positionOrder.length; i++) {
		if (positions.includes(positionOrder[i])) return i;
	}
	return 99;
}

// Get position key for grouping (e.g., "RB", "WR", "RB/WR")
function getPositionKey(positions) {
	if (!positions || positions.length === 0) return 'Unknown';
	var sorted = positions.slice().sort(function(a, b) {
		return positionOrder.indexOf(a) - positionOrder.indexOf(b);
	});
	return sorted.join('/');
}

exports.rfa = async function(request, response) {
	try {
		// Get all RFA contracts (salary === null)
		var rfaContracts = await Contract.find({ salary: null })
			.populate('playerId', 'name slugs positions team')
			.populate('franchiseId')
			.lean();
		
		// Get all current regimes to look up display names
		var currentRegimes = await Regime.find({ 'tenures.endSeason': null }).lean();
		
		// Build a map of franchiseId -> displayName
		var franchiseDisplayNames = {};
		currentRegimes.forEach(function(regime) {
			regime.tenures.forEach(function(tenure) {
				if (tenure.endSeason === null) {
					franchiseDisplayNames[tenure.franchiseId.toString()] = regime.displayName;
				}
			});
		});
		
		// Transform into display format
		var rfaPlayers = rfaContracts
			.filter(function(c) { return c.playerId; })
			.map(function(c) {
				var franchiseId = c.franchiseId ? c.franchiseId._id.toString() : null;
			return {
				_id: c.playerId._id,
				name: c.playerId.name,
				slug: c.playerId.slugs && c.playerId.slugs[0],
				positions: c.playerId.positions || [],
				team: c.playerId.team,
				franchise: franchiseId ? franchiseDisplayNames[franchiseId] || 'Unknown' : 'Unknown',
				franchiseRosterId: c.franchiseId ? c.franchiseId.rosterId : null
			};
			})
			.sort(function(a, b) {
				// Sort by position, then by name
				var posA = getPositionIndex(a.positions);
				var posB = getPositionIndex(b.positions);
				if (posA !== posB) return posA - posB;
				return a.name.localeCompare(b.name);
			});
		
		// Group by position
		var playersByPosition = {};
		var positionKeys = [];
		rfaPlayers.forEach(function(player) {
			var key = getPositionKey(player.positions);
			if (!playersByPosition[key]) {
				playersByPosition[key] = [];
				positionKeys.push(key);
			}
			playersByPosition[key].push(player);
		});
		
		// Sort position keys by standard order
		positionKeys.sort(function(a, b) {
			var primaryA = a.split('/')[0];
			var primaryB = b.split('/')[0];
			var idxA = positionOrder.indexOf(primaryA);
			var idxB = positionOrder.indexOf(primaryB);
			if (idxA === -1) idxA = 99;
			if (idxB === -1) idxB = 99;
			if (idxA !== idxB) return idxA - idxB;
			// Single positions before dual
			return a.length - b.length;
		});
		
		response.render('rfa', {
			activePage: 'rfa',
			playersByPosition: playersByPosition,
			positionKeys: positionKeys
		});
	} catch (err) {
		console.error('Error loading RFA list:', err);
		response.status(500).send('Error loading RFA list');
	}
};
