/**
 * Shared player find-or-create logic with position upsert.
 * 
 * When finding an existing HISTORICAL player (no sleeperId):
 *   - If they have no positions and we have position data, update them
 *   - Never overwrite existing positions with null/empty
 * 
 * Modern players (with sleeperId) are never updated here - their
 * positions come from Sleeper sync.
 * 
 * When creating a new player:
 *   - Include positions if available
 * 
 * Usage:
 *   var playerUpsert = require('../utils/player-upsert');
 *   
 *   // Initialize with caches and options
 *   var upsert = playerUpsert.create({
 *     Player: require('../../models/Player'),
 *     playersBySleeperId: {},
 *     playersByName: {},
 *     dryRun: false
 *   });
 *   
 *   // Find or create with position upsert
 *   var player = await upsert.findOrCreate({
 *     sleeperId: '12345',
 *     name: 'Josh Allen',
 *     positions: ['QB']
 *   });
 */

/**
 * Check if a positions array is empty/missing.
 */
function hasNoPositions(player) {
	return !player.positions || player.positions.length === 0;
}

/**
 * Check if we have valid position data to use.
 */
function hasPositionData(positions) {
	return positions && Array.isArray(positions) && positions.length > 0;
}

/**
 * Normalize position data from entry.
 * Handles both `positions` array and `position` singular field.
 */
function getPositions(entry) {
	if (entry.positions && Array.isArray(entry.positions) && entry.positions.length > 0) {
		return entry.positions;
	}
	if (entry.position && typeof entry.position === 'string') {
		return [entry.position];
	}
	return null;
}

/**
 * Create a player upsert helper with shared caches.
 * 
 * @param {Object} options
 * @param {Object} options.Player - Mongoose Player model
 * @param {Object} options.playersBySleeperId - Cache of players by sleeperId
 * @param {Object} options.playersByName - Cache of players by name (with |historical suffix for historical)
 * @param {boolean} options.dryRun - If true, don't actually create/update
 * @returns {Object} Helper with findOrCreate method
 */
function create(options) {
	var Player = options.Player;
	var playersBySleeperId = options.playersBySleeperId;
	var playersByName = options.playersByName;
	var dryRun = options.dryRun || false;
	
	var stats = {
		found: 0,
		created: 0,
		positionsUpdated: 0
	};
	
	/**
	 * Update positions on an existing player if they're missing them.
	 * Only updates historical players (no sleeperId) - modern players
	 * get their positions from Sleeper sync.
	 */
	async function maybeUpdatePositions(player, positions) {
		// Only update historical players - modern players get positions from Sleeper
		if (player.sleeperId) {
			return false;
		}
		
		if (hasNoPositions(player) && hasPositionData(positions)) {
			if (!dryRun) {
				await Player.updateOne(
					{ _id: player._id },
					{ $set: { positions: positions } }
				);
				// Update the in-memory object too
				player.positions = positions;
			}
			stats.positionsUpdated++;
			return true;
		}
		return false;
	}
	
	/**
	 * Find or create a player, upserting positions if needed.
	 * 
	 * @param {Object} entry
	 * @param {string} entry.sleeperId - Sleeper player ID (null for historical)
	 * @param {string} entry.name - Player name (or entry.playerName)
	 * @param {string[]} entry.positions - Positions array (optional)
	 * @param {string} entry.position - Single position string (optional, alternative to positions)
	 * @returns {Object} Player document or null
	 */
	async function findOrCreate(entry) {
		var positions = getPositions(entry);
		
		// Try sleeperId first (modern players)
		if (entry.sleeperId) {
			if (playersBySleeperId[entry.sleeperId]) {
				var cached = playersBySleeperId[entry.sleeperId];
				await maybeUpdatePositions(cached, positions);
				stats.found++;
				return cached;
			}
			
			var player = await Player.findOne({ sleeperId: entry.sleeperId });
			if (player) {
				await maybeUpdatePositions(player, positions);
				playersBySleeperId[entry.sleeperId] = player;
				stats.found++;
				return player;
			}
		}
		
		// Historical player (no sleeperId) - use name + "historical" as cache key
		var name = entry.name || entry.playerName;
		if (name) {
			var isHistorical = !entry.sleeperId;
			var nameKey = name.toLowerCase();
			var cacheKey = isHistorical ? nameKey + '|historical' : nameKey;
			
			if (playersByName[cacheKey]) {
				var cached = playersByName[cacheKey];
				await maybeUpdatePositions(cached, positions);
				stats.found++;
				return cached;
			}
			
			// Look up by name, but for historical players only match those without sleeperId
			var query = { name: name };
			if (isHistorical) {
				query.sleeperId = null;
			}
			
			var player = await Player.findOne(query);
			if (player) {
				await maybeUpdatePositions(player, positions);
				playersByName[cacheKey] = player;
				stats.found++;
				return player;
			}
			
			// Create player (historical or with sleeperId)
			if (!dryRun) {
				player = await Player.create({
					name: name,
					sleeperId: entry.sleeperId || null,
					positions: hasPositionData(positions) ? positions : []
				});
				playersByName[cacheKey] = player;
				if (entry.sleeperId) {
					playersBySleeperId[entry.sleeperId] = player;
				}
			}
			stats.created++;
			return player;
		}
		
		return null;
	}
	
	return {
		findOrCreate: findOrCreate,
		stats: stats
	};
}

module.exports = {
	create: create,
	hasNoPositions: hasNoPositions,
	hasPositionData: hasPositionData
};
