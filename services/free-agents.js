var Contract = require('../models/Contract');
var LeagueConfig = require('../models/LeagueConfig');
var Regime = require('../models/Regime');
var Transaction = require('../models/Transaction');

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

exports.ufa = async function(request, response) {
	try {
		var config = await LeagueConfig.findById('pso');
		if (!config) {
			return response.status(500).send('League config not found');
		}

		var phase = config.getPhase();
		var inSeason = ['regular-season', 'post-deadline', 'playoff-fa'].includes(phase);

		// Dead period straddles rollover — check if contracts for
		// the current season still exist to decide which side we're on
		if (phase === 'dead-period') {
			var remaining = await Contract.countDocuments({ endYear: config.season });
			if (remaining > 0) inSeason = true;
		}

		var ufaSeason = inSeason ? config.season : config.season - 1;

		// Source 1: contracts still on rosters with UFA-qualifying terms
		// (FA pickup: startYear null, or 1-year auction: startYear === endYear)
		var ufaContracts = await Contract.find({
			endYear: ufaSeason,
			salary: { $ne: null },
			$or: [
				{ startYear: null },
				{ startYear: ufaSeason }
			]
		}).populate('playerId', 'name slugs positions team').lean();

		// Source 2: contract-expiry transactions (already expired as UFA)
		var expiryTransactions = await Transaction.find({
			type: 'contract-expiry',
			endYear: ufaSeason
		}).populate('playerId', 'name slugs positions team').lean();

		// Source 3: FA drops with UFA-qualifying terms (cut mid-season)
		var faDropTransactions = await Transaction.find({
			type: 'fa',
			drops: {
				$elemMatch: {
					endYear: ufaSeason,
					$or: [
						{ startYear: null },
						{ startYear: ufaSeason }
					]
				}
			}
		}).populate('drops.playerId', 'name slugs positions team').lean();

		// Players from Source 1 are upcoming UFAs still on rosters
		var rosteredUfas = {};
		ufaContracts.forEach(function(c) {
			if (c.playerId) {
				rosteredUfas[c.playerId._id.toString()] = c.playerId;
			}
		});

		// Players from Sources 2+3 are already free — need re-acquisition check
		var expiredUfas = {};

		expiryTransactions.forEach(function(t) {
			if (t.playerId) {
				expiredUfas[t.playerId._id.toString()] = t.playerId;
			}
		});

		faDropTransactions.forEach(function(t) {
			if (!t.drops) return;
			t.drops.forEach(function(drop) {
				if (drop.playerId && drop.endYear === ufaSeason &&
					(drop.startYear == null || drop.startYear === ufaSeason)) {
					expiredUfas[drop.playerId._id.toString()] = drop.playerId;
				}
			});
		});

		// Remove expired/cut players who have since been re-acquired
		var expiredIds = Object.keys(expiredUfas);
		if (expiredIds.length > 0) {
			var currentContracts = await Contract.find({
				playerId: { $in: expiredIds }
			}).lean();

			currentContracts.forEach(function(c) {
				delete expiredUfas[c.playerId.toString()];
			});
		}

		// Merge both sources
		var playerMap = {};
		Object.keys(rosteredUfas).forEach(function(id) { playerMap[id] = rosteredUfas[id]; });
		Object.keys(expiredUfas).forEach(function(id) { playerMap[id] = expiredUfas[id]; });

		var ufaPlayers = Object.keys(playerMap)
			.map(function(id) {
				var player = playerMap[id];
				return {
					_id: player._id,
					name: player.name,
					slug: player.slugs && player.slugs[0],
					positions: player.positions || [],
					team: player.team
				};
			})
			.sort(function(a, b) {
				var posA = getPositionIndex(a.positions);
				var posB = getPositionIndex(b.positions);
				if (posA !== posB) return posA - posB;
				return a.name.localeCompare(b.name);
			});

		// Group by position
		var playersByPosition = {};
		var positionKeys = [];
		ufaPlayers.forEach(function(player) {
			var key = getPositionKey(player.positions);
			if (!playersByPosition[key]) {
				playersByPosition[key] = [];
				positionKeys.push(key);
			}
			playersByPosition[key].push(player);
		});

		positionKeys.sort(function(a, b) {
			var primaryA = a.split('/')[0];
			var primaryB = b.split('/')[0];
			var idxA = positionOrder.indexOf(primaryA);
			var idxB = positionOrder.indexOf(primaryB);
			if (idxA === -1) idxA = 99;
			if (idxB === -1) idxB = 99;
			if (idxA !== idxB) return idxA - idxB;
			return a.length - b.length;
		});

		response.render('ufa', {
			activePage: 'ufa',
			playersByPosition: playersByPosition,
			positionKeys: positionKeys,
			ufaSeason: ufaSeason
		});
	} catch (err) {
		console.error('Error loading UFA list:', err);
		response.status(500).send('Error loading UFA list');
	}
};
