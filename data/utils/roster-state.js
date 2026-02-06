/**
 * Roster State Tracker
 * 
 * Tracks which players are on which franchise's roster as transactions
 * are processed chronologically. Provides query interface for player
 * resolution based on roster context.
 * 
 * Usage:
 *   var RosterState = require('./roster-state');
 *   var state = new RosterState();
 *   
 *   // Record transactions
 *   state.acquire(playerId, playerName, franchiseId);
 *   state.release(playerId);
 *   state.trade(playerId, toFranchiseId);
 *   state.convertToRfa(playerId);  // still owned, but RFA state
 *   state.lapse(playerId);         // RFA rights lapsed, now available
 *   
 *   // Query for resolution
 *   state.findOnRoster(franchiseId, name);  // returns playerId or null
 *   state.getOwner(playerId);               // returns franchiseId or null
 *   state.getState(playerId);               // returns 'available'|'rostered'|'rfa-held'
 */

var resolver = require('./player-resolver');

var STATES = {
	AVAILABLE: 'available',
	ROSTERED: 'rostered',
	RFA_HELD: 'rfa-held'
};

function RosterState() {
	// playerId (string) → { name, franchiseId, state }
	this.players = {};
	
	// franchiseId (string) → Set of playerIds
	this.rosters = {};
}

/**
 * Normalize name for matching.
 */
RosterState.prototype.normalizeName = function(name) {
	return resolver.normalizePlayerName(name);
};

/**
 * Get or create roster set for a franchise.
 */
RosterState.prototype.getRosterSet = function(franchiseId) {
	var key = franchiseId.toString();
	if (!this.rosters[key]) {
		this.rosters[key] = new Set();
	}
	return this.rosters[key];
};

/**
 * Record a player acquisition (auction, draft, FA pickup).
 * Player moves from available → rostered.
 */
RosterState.prototype.acquire = function(playerId, playerName, franchiseId) {
	var pid = playerId.toString();
	var fid = franchiseId.toString();
	
	// Remove from any previous roster
	var existing = this.players[pid];
	if (existing && existing.franchiseId) {
		var oldRoster = this.getRosterSet(existing.franchiseId);
		oldRoster.delete(pid);
	}
	
	// Add to new roster
	this.players[pid] = {
		name: playerName,
		normalizedName: this.normalizeName(playerName),
		franchiseId: fid,
		state: STATES.ROSTERED
	};
	this.getRosterSet(fid).add(pid);
};

/**
 * Record a player release (cut).
 * Player moves from rostered → available.
 */
RosterState.prototype.release = function(playerId) {
	var pid = playerId.toString();
	var player = this.players[pid];
	
	if (player && player.franchiseId) {
		var roster = this.getRosterSet(player.franchiseId);
		roster.delete(pid);
	}
	
	if (player) {
		player.franchiseId = null;
		player.state = STATES.AVAILABLE;
	}
};

/**
 * Record a trade.
 * Player moves from one franchise's roster to another's.
 */
RosterState.prototype.trade = function(playerId, toFranchiseId) {
	var pid = playerId.toString();
	var toFid = toFranchiseId.toString();
	var player = this.players[pid];
	
	if (player && player.franchiseId) {
		var oldRoster = this.getRosterSet(player.franchiseId);
		oldRoster.delete(pid);
	}
	
	if (player) {
		player.franchiseId = toFid;
		// State stays the same (rostered or rfa-held)
	}
	
	this.getRosterSet(toFid).add(pid);
};

/**
 * Record RFA conversion (contract expired, franchise holds RFA rights).
 * Player moves from rostered → rfa-held (still associated with franchise).
 */
RosterState.prototype.convertToRfa = function(playerId) {
	var pid = playerId.toString();
	var player = this.players[pid];
	
	if (player) {
		player.state = STATES.RFA_HELD;
		// Still on the franchise's roster for matching purposes
	}
};

/**
 * Record RFA rights lapsed (not matched at auction).
 * Player moves from rfa-held → available.
 */
RosterState.prototype.lapse = function(playerId) {
	var pid = playerId.toString();
	var player = this.players[pid];
	
	if (player && player.franchiseId) {
		var roster = this.getRosterSet(player.franchiseId);
		roster.delete(pid);
	}
	
	if (player) {
		player.franchiseId = null;
		player.state = STATES.AVAILABLE;
	}
};

/**
 * Record a contract signing (player stays rostered).
 */
RosterState.prototype.signContract = function(playerId) {
	var pid = playerId.toString();
	var player = this.players[pid];
	
	if (player) {
		player.state = STATES.ROSTERED;
	}
};

// =============================================================================
// Query Methods
// =============================================================================

/**
 * Get the franchise that owns a player (if any).
 */
RosterState.prototype.getOwner = function(playerId) {
	var pid = playerId.toString();
	var player = this.players[pid];
	return player ? player.franchiseId : null;
};

/**
 * Get the current state of a player.
 */
RosterState.prototype.getState = function(playerId) {
	var pid = playerId.toString();
	var player = this.players[pid];
	return player ? player.state : STATES.AVAILABLE;
};

/**
 * Find a player on a franchise's roster by name.
 * Returns playerId if exactly one match, null otherwise.
 * 
 * This is the key resolver method - given a name and franchise context,
 * find the player ID.
 */
RosterState.prototype.findOnRoster = function(franchiseId, name) {
	var fid = franchiseId.toString();
	var normalizedName = this.normalizeName(name);
	var roster = this.rosters[fid];
	
	if (!roster) return null;
	
	var matches = [];
	var self = this;
	
	roster.forEach(function(pid) {
		var player = self.players[pid];
		if (player && player.normalizedName === normalizedName) {
			matches.push(pid);
		}
	});
	
	if (matches.length === 1) {
		return matches[0];
	}
	
	return null; // No match or ambiguous
};

/**
 * Find all players on a roster matching a name.
 * Returns array of { playerId, name, state }.
 */
RosterState.prototype.findAllOnRoster = function(franchiseId, name) {
	var fid = franchiseId.toString();
	var normalizedName = this.normalizeName(name);
	var roster = this.rosters[fid];
	
	if (!roster) return [];
	
	var matches = [];
	var self = this;
	
	roster.forEach(function(pid) {
		var player = self.players[pid];
		if (player && player.normalizedName === normalizedName) {
			matches.push({
				playerId: pid,
				name: player.name,
				state: player.state
			});
		}
	});
	
	return matches;
};

/**
 * Get full roster for a franchise.
 * Returns array of { playerId, name, state }.
 */
RosterState.prototype.getRoster = function(franchiseId) {
	var fid = franchiseId.toString();
	var roster = this.rosters[fid];
	
	if (!roster) return [];
	
	var result = [];
	var self = this;
	
	roster.forEach(function(pid) {
		var player = self.players[pid];
		if (player) {
			result.push({
				playerId: pid,
				name: player.name,
				state: player.state
			});
		}
	});
	
	return result;
};

/**
 * Get summary stats.
 */
RosterState.prototype.getStats = function() {
	var self = this;
	var total = Object.keys(this.players).length;
	var byState = { available: 0, rostered: 0, 'rfa-held': 0 };
	
	Object.keys(this.players).forEach(function(pid) {
		var player = self.players[pid];
		byState[player.state]++;
	});
	
	return {
		total: total,
		available: byState.available,
		rostered: byState.rostered,
		rfaHeld: byState['rfa-held']
	};
};

// Export
RosterState.STATES = STATES;
module.exports = RosterState;
