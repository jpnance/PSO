/**
 * Player resolution helper.
 * 
 * Provides functions to look up player names and resolve them to Sleeper IDs
 * or historical player records. Caches resolutions to avoid repeated prompts.
 * 
 * Resolution file format:
 * {
 *   "_ambiguous": ["mike williams", "michael thomas"],  // Always prompt these
 *   "ceedee lamb": { "sleeperId": "6786" },
 *   "ricky williams": { "sleeperId": null, "name": "Ricky Williams" },
 *   "michael thomas|2016|saints": { "sleeperId": "4046" }  // Context override
 * }
 */

var fs = require('fs');
var path = require('path');

var resolutionsPath = path.join(__dirname, '../config/player-resolutions.json');
var resolutions = null;
var dirty = false;

/**
 * Load resolutions from disk (lazy, cached).
 */
function loadResolutions() {
	if (resolutions !== null) return resolutions;

	try {
		resolutions = require('../config/player-resolutions.json');
	} catch (e) {
		resolutions = {};
	}

	return resolutions;
}

/**
 * Save resolutions to disk (if modified).
 */
function saveResolutions() {
	if (!dirty) return;

	// Sort by key (but keep _ambiguous at top)
	var sorted = {};
	var keys = Object.keys(resolutions).sort(function(a, b) {
		if (a === '_ambiguous') return -1;
		if (b === '_ambiguous') return 1;
		return a.localeCompare(b);
	});
	keys.forEach(function(key) {
		sorted[key] = resolutions[key];
	});

	fs.writeFileSync(resolutionsPath, JSON.stringify(sorted, null, 2));
	dirty = false;
}

/**
 * Normalize a player name for lookup.
 */
function normalizePlayerName(name) {
	if (!name) return '';
	return name
		.replace(/&#8217;/g, "'")  // HTML apostrophe
		.replace(/\s*\([A-Z]{2,4}\)\s*/g, '')  // Strip team suffixes like (CAR), (NO), (JAX)
		.replace(/\s+(III|II|IV|V|Jr\.|Sr\.)$/i, '')
		.replace(/[^\w\s]/g, '')
		.replace(/\s+/g, ' ')
		.trim()
		.toLowerCase();
}

/**
 * Check if a name is in the ambiguous list.
 */
function isAmbiguous(normalizedName) {
	var res = loadResolutions();
	var ambiguous = res._ambiguous || [];
	return ambiguous.includes(normalizedName);
}

/**
 * Build a context key from name and context object.
 * Strong keys use: name|year|type|franchise
 */
function buildContextKey(normalizedName, context) {
	if (!context) return null;

	var parts = [normalizedName];

	// Add context in consistent order: year, type, franchise
	if (context.year) parts.push(context.year);
	if (context.type) parts.push('type:' + context.type.toLowerCase());
	if (context.franchise) parts.push(context.franchise.toLowerCase().replace(/\s+/g, ''));

	return parts.length > 1 ? parts.join('|') : null;
}

/**
 * Look up a player name in the resolutions cache.
 * Tries progressively less specific context keys.
 * 
 * @param {string} name - Player name (will be normalized)
 * @param {Object} [context] - Optional context { year, type, franchise }
 * @returns {Object|null} - { sleeperId: string|null, name?: string } or null if not found
 *                          Returns { ambiguous: true } if name is in ambiguous list without any cached resolution
 */
function lookup(name, context) {
	var normalized = normalizePlayerName(name);
	var res = loadResolutions();

	// Try progressively less specific context keys
	if (context) {
		// 1. Full context: name|year|type|franchise
		var fullKey = buildContextKey(normalized, context);
		if (fullKey && res[fullKey]) {
			return res[fullKey];
		}
		
		// 2. Without franchise: name|year|type
		if (context.franchise) {
			var noFranchise = { year: context.year, type: context.type };
			var noFranchiseKey = buildContextKey(normalized, noFranchise);
			if (noFranchiseKey && res[noFranchiseKey]) {
				return res[noFranchiseKey];
			}
		}
		
		// 3. Just year: name|year
		if (context.year) {
			var yearOnlyKey = normalized + '|' + context.year;
			if (res[yearOnlyKey]) {
				return res[yearOnlyKey];
			}
		}
	}

	// Check for name-only resolution (takes priority over ambiguous flag)
	// This handles cases like historical players who appear multiple times
	if (res[normalized]) {
		return res[normalized];
	}

	// No cached resolution - check if this name is known to be ambiguous
	if (isAmbiguous(normalized)) {
		return { ambiguous: true };
	}

	// Not found and not ambiguous
	return null;
}

/**
 * Add or update a resolution.
 * 
 * @param {string} name - Player name (will be normalized)
 * @param {string|null} sleeperId - Sleeper ID or null for historical
 * @param {string} [displayName] - Display name (required if historical)
 * @param {Object} [context] - Optional context for ambiguous names { year, position, franchise, pick }
 */
function addResolution(name, sleeperId, displayName, context) {
	var normalized = normalizePlayerName(name);
	loadResolutions();

	// Use context key if provided, otherwise just the name
	var key = normalized;
	if (context) {
		var contextKey = buildContextKey(normalized, context);
		if (contextKey) key = contextKey;
	}

	if (sleeperId) {
		resolutions[key] = { sleeperId: sleeperId };
	} else {
		resolutions[key] = { sleeperId: null, name: displayName || name };
	}

	dirty = true;
}

/**
 * Mark a name as ambiguous (will always require prompting unless context matches).
 * 
 * @param {string} name - Player name (will be normalized)
 */
function markAmbiguous(name) {
	var normalized = normalizePlayerName(name);
	loadResolutions();

	if (!resolutions._ambiguous) {
		resolutions._ambiguous = [];
	}

	if (!resolutions._ambiguous.includes(normalized)) {
		resolutions._ambiguous.push(normalized);
		resolutions._ambiguous.sort();
		dirty = true;
	}
}

/**
 * Add an alias for an existing resolution.
 * 
 * @param {string} alias - New alias name
 * @param {string} existingName - Name that already has a resolution
 */
function addAlias(alias, existingName) {
	var existing = lookup(existingName);
	if (!existing) {
		throw new Error('No resolution found for: ' + existingName);
	}

	var normalizedAlias = normalizePlayerName(alias);
	loadResolutions();
	resolutions[normalizedAlias] = existing;
	dirty = true;
}

/**
 * Check if a resolution exists for a name.
 */
function has(name) {
	return lookup(name) !== null;
}

/**
 * Get all resolutions (for debugging/inspection).
 */
function getAll() {
	return loadResolutions();
}

/**
 * Get count of resolutions.
 */
function count() {
	return Object.keys(loadResolutions()).length;
}

/**
 * Create a readline interface for prompting.
 */
function createPromptInterface() {
	var readline = require('readline');
	return readline.createInterface({
		input: process.stdin,
		output: process.stdout
	});
}

/**
 * Prompt the user with a question.
 */
function prompt(rl, question) {
	return new Promise(function(resolve) {
		rl.question(question, function(answer) {
			resolve(answer);
		});
	});
}

/**
 * Format context for display.
 */
function formatContext(context) {
	var parts = [];
	if (context.type) parts.push(context.type);
	if (context.year) parts.push(context.year);
	if (context.franchise) parts.push('by ' + context.franchise);
	if (context.round && context.pick) parts.push('Round ' + context.round + ' Pick ' + context.pick);
	if (context.tradeId) parts.push('Trade #' + context.tradeId);
	return parts.join(', ');
}

/**
 * Order candidates by likelihood given context.
 * Prefers: exact rookieYear match, closer estimatedRookieYear, active players, higher searchRank.
 */
function orderCandidates(candidates, context) {
	return candidates.slice().sort(function(a, b) {
		if (context && context.year) {
			// First: prefer exact rookieYear match (reliable data)
			var aRookieMatch = a.rookieYear === context.year ? 1 : 0;
			var bRookieMatch = b.rookieYear === context.year ? 1 : 0;
			if (aRookieMatch !== bRookieMatch) return bRookieMatch - aRookieMatch;
			
			// Second: prefer closer estimatedRookieYear (for ordering, not auto-resolution)
			var aEstimated = a.estimatedRookieYear || a.rookieYear;
			var bEstimated = b.estimatedRookieYear || b.rookieYear;
			if (aEstimated && bEstimated) {
				var aDist = Math.abs(aEstimated - context.year);
				var bDist = Math.abs(bEstimated - context.year);
				if (aDist !== bDist) return aDist - bDist;
			} else if (aEstimated) {
				return -1; // a has estimate, b doesn't - prefer a
			} else if (bEstimated) {
				return 1; // b has estimate, a doesn't - prefer b
			}
		}
		
		// Prefer active players
		var aActive = a.active ? 1 : 0;
		var bActive = b.active ? 1 : 0;
		if (aActive !== bActive) return bActive - aActive;
		
		// Prefer higher searchRank (lower number = more relevant)
		var aRank = a.searchRank || 9999999;
		var bRank = b.searchRank || 9999999;
		return aRank - bRank;
	});
}

/**
 * Unified player resolution prompt.
 * 
 * @param {Object} options
 * @param {string} options.name - Player name from source data
 * @param {Object} options.context - Context { year, type, franchise, round, pick, tradeId }
 * @param {Array} options.candidates - Array of Player documents (Sleeper players)
 * @param {string} [options.position] - Position from source data (for display)
 * @param {Object} options.Player - Mongoose Player model (for creating historical)
 * @param {Object} [options.rl] - Existing readline interface (if null and prompt needed, will skip)
 * @param {Object} [options.playerCache] - Seeder's in-memory cache to update when creating historical players
 * @returns {Promise<Object>} - { player: Player document or null, action: 'matched'|'created'|'skipped'|'quit' }
 */
async function promptForPlayer(options) {
	var name = options.name;
	var context = options.context || {};
	var candidates = options.candidates || [];
	var position = options.position;
	var Player = options.Player;
	var rl = options.rl;
	var playerCache = options.playerCache; // Optional: seeder's in-memory cache to update
	var autoHistorical = options.autoHistorical; // Auto-create historical player if no candidates
	var dryRun = options.dryRun; // Skip database writes
	
	// Helper to update seeder's cache when creating historical players
	function addToCache(player) {
		if (!playerCache) return;
		var norm = normalizePlayerName(player.name);
		if (!playerCache[norm]) playerCache[norm] = [];
		playerCache[norm].push(player);
	}
	
	var normalized = normalizePlayerName(name);
	
	// Check cache first
	var cached = lookup(name, context);
	if (cached && cached.sleeperId) {
		// Find player by sleeperId
		var cachedPlayer = candidates.find(function(c) { return c.sleeperId === cached.sleeperId; });
		if (cachedPlayer) {
			return { player: cachedPlayer, action: 'matched' };
		}
		// Sleeper ID in cache but not in candidates - might be a player not in our filter
		var dbPlayer = await Player.findOne({ sleeperId: cached.sleeperId });
		if (dbPlayer) {
			return { player: dbPlayer, action: 'matched' };
		}
	}
	if (cached && cached.name && !cached.sleeperId) {
		// Historical player - find or create by name
		var historical = await Player.findOne({ name: cached.name, sleeperId: null });
		if (historical) {
			return { player: historical, action: 'matched' };
		}
		// Cached resolution exists but Player was deleted (e.g., by reset) - recreate it
		historical = new Player({ name: cached.name, sleeperId: null });
		if (!dryRun) {
			await historical.save();
			addToCache(historical);
			console.log('  ✓ Recreated historical: ' + cached.name);
		} else {
			console.log('  [dry-run] Would recreate historical: ' + cached.name);
		}
		return { player: historical, action: 'created' };
	}
	
	// Filter candidates by position if we have position data
	var filteredCandidates = candidates;
	if (position && position !== 'FA') {
		var positions = position.split('/');
		var positionFiltered = candidates.filter(function(c) {
			// Include players with no position data (e.g., historical players)
			if (!c.positions || c.positions.length === 0) return true;
			return c.positions.some(function(p) {
				return positions.includes(p);
			});
		});
		if (positionFiltered.length > 0) {
			filteredCandidates = positionFiltered;
		}
	}
	
	// Filter by rookie year plausibility if we have context year
	if (context && context.year && filteredCandidates.length > 1) {
		var plausible = filteredCandidates.filter(function(c) {
			if (context.type === 'draft') {
				// For drafts, player must be a rookie
				if (c.rookieYear) {
					// Reliable: exact match
					return c.rookieYear === context.year;
				} else if (c.estimatedRookieYear) {
					// Estimated: allow ±2 window
					return Math.abs(c.estimatedRookieYear - context.year) <= 2;
				}
			} else {
				// For trades/cuts/etc, player just needs to have existed by then
				if (c.rookieYear) {
					// Reliable: exact check
					return c.rookieYear <= context.year;
				} else if (c.estimatedRookieYear) {
					// Estimated: allow margin
					return c.estimatedRookieYear <= context.year + 2;
				}
			}
			return true; // No data, keep as candidate
		});
		// Only apply filter if it narrows down (but doesn't eliminate all)
		if (plausible.length > 0 && plausible.length < filteredCandidates.length) {
			filteredCandidates = plausible;
		}
	}
	
	// Order candidates
	filteredCandidates = orderCandidates(filteredCandidates, context);
	
	// Check for automatic resolution (single non-ambiguous match)
	if (filteredCandidates.length === 1 && !isAmbiguous(normalized)) {
		return { player: filteredCandidates[0], action: 'matched' };
	}
	
	// Auto-create historical player if no candidates and autoHistorical is enabled
	if (autoHistorical && filteredCandidates.length === 0) {
		// Strip parenthetical hints for display name (keep original capitalization)
		var displayName = name.replace(/\s*\([^)]+\)$/, '');
		
		var historical = new Player({ name: displayName, sleeperId: null });
		if (!dryRun) {
			await historical.save();
			addToCache(historical);
			addResolution(name, null, displayName, context);
			console.log('  + Auto-created historical: ' + displayName);
		} else {
			console.log('  [dry-run] Would auto-create historical: ' + displayName);
		}
		return { player: historical, action: 'created' };
	}
	
	// Need to prompt - but if no rl, skip instead
	if (!rl) {
		if (filteredCandidates.length === 0) {
			console.log('  ✗ No candidates for: ' + name + ' (skipping)');
		} else {
			console.log('  ✗ Ambiguous: ' + name + ' (' + filteredCandidates.length + ' candidates, skipping)');
		}
		return { player: null, action: 'skipped' };
	}
	
	console.log('');
	console.log('Resolving: "' + name + '"' + (position ? ' (' + position + ')' : ''));
	console.log('Context: ' + formatContext(context));
	
	if (filteredCandidates.length === 0) {
		console.log('No candidates found.');
	} else {
		console.log('Candidates:');
		for (var i = 0; i < filteredCandidates.length; i++) {
			var c = filteredCandidates[i];
			var rookieYearDisplay = c.rookieYear 
				? String(c.rookieYear) 
				: (c.estimatedRookieYear ? '~' + c.estimatedRookieYear : '?');
			var idDisplay = c.sleeperId ? '#' + c.sleeperId : '(historical)';
			var details = [
				c.name,
				(c.positions || []).join('/'),
				rookieYearDisplay,
				c.college || '?',
				idDisplay
			].join(' | ');
			console.log('  ' + (i + 1) + ') ' + details);
		}
	}
	
	var optionsText = [];
	if (filteredCandidates.length > 0) optionsText.push('1-' + filteredCandidates.length);
	optionsText.push('#ID for Sleeper ID');
	optionsText.push('h for historical');
	optionsText.push('s to skip');
	optionsText.push('q to quit');
	console.log('Options: ' + optionsText.join(', '));
	console.log('        (add ! suffix to save as global alias, e.g. 1! or #5916!)');
	
	var answer = await prompt(rl, 'Selection: ');
	answer = answer.trim();
	
	// Handle quit
	if (answer.toLowerCase() === 'q') {
		return { player: null, action: 'quit' };
	}
	
	// Handle skip
	if (answer.toLowerCase() === 's') {
		return { player: null, action: 'skipped' };
	}
	
	// Handle historical
	if (answer.toLowerCase() === 'h') {
		// Strip hint parenthetical from default name (e.g., "Steve Smith (PHI)" → "Steve Smith")
		var cleanName = name.replace(/\s*\([^)]+\)$/, '');
		var displayName = await prompt(rl, 'Display name [' + cleanName + ']: ');
		displayName = displayName.trim() || cleanName;
		
		// Check for existing historical player
		var existing = await Player.findOne({ name: displayName, sleeperId: null });
		if (existing) {
			console.log('  Using existing historical player: ' + displayName);
			if (!dryRun) {
				addResolution(name, null, displayName, context);
				saveResolutions();
			}
			return { player: existing, action: 'matched' };
		}
		
		// Create new historical player
		var newPlayer = new Player({
			name: displayName,
			positions: position ? position.split('/') : [],
			sleeperId: null
		});
		if (!dryRun) {
			await newPlayer.save();
			addToCache(newPlayer);
			console.log('  Created historical player: ' + displayName);
			addResolution(name, null, displayName, context);
			saveResolutions();
		} else {
			console.log('  [dry-run] Would create historical player: ' + displayName);
		}
		return { player: newPlayer, action: 'created' };
	}
	
	// Handle Sleeper ID
	if (answer.startsWith('#')) {
		var isGlobalAlias = answer.endsWith('!');
		var sleeperId = isGlobalAlias ? answer.slice(1, -1) : answer.slice(1);
		var player = await Player.findOne({ sleeperId: sleeperId });
		if (player) {
			console.log('  → ' + player.name + (isGlobalAlias ? ' (global alias)' : ''));
			if (!dryRun) {
				addResolution(name, sleeperId, null, isGlobalAlias ? null : context);
				saveResolutions();
			}
			return { player: player, action: 'matched' };
		} else {
			console.log('  ✗ No player found with Sleeper ID: ' + sleeperId);
			// Recurse to try again
			return promptForPlayer(options);
		}
	}
	
	// Handle numeric selection
	var isGlobalAlias = answer.endsWith('!');
	var selectionStr = isGlobalAlias ? answer.slice(0, -1) : answer;
	var selection = parseInt(selectionStr, 10);
	if (selection >= 1 && selection <= filteredCandidates.length) {
		var selectedPlayer = filteredCandidates[selection - 1];
		console.log('  → ' + selectedPlayer.name + (isGlobalAlias ? ' (global alias)' : ''));
		if (!dryRun) {
			// For historical players (no sleeperId), pass their name to avoid storing the hint
			var resolvedName = selectedPlayer.sleeperId ? null : selectedPlayer.name;
			addResolution(name, selectedPlayer.sleeperId, resolvedName, isGlobalAlias ? null : context);
			saveResolutions();
		}
		return { player: selectedPlayer, action: 'matched' };
	}
	
	// Invalid input - recurse
	console.log('  Invalid selection. Try again.');
	return promptForPlayer(options);
}

module.exports = {
	normalizePlayerName: normalizePlayerName,
	lookup: lookup,
	addResolution: addResolution,
	addAlias: addAlias,
	markAmbiguous: markAmbiguous,
	isAmbiguous: isAmbiguous,
	has: has,
	getAll: getAll,
	count: count,
	save: saveResolutions,
	promptForPlayer: promptForPlayer
};
