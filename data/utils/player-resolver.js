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

var resolutionsPath = path.join(__dirname, 'player-resolutions.json');
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
 * Context might include: year, position, franchise, pick, etc.
 */
function buildContextKey(normalizedName, context) {
	if (!context) return null;

	var parts = [normalizedName];

	// Add context in consistent order
	if (context.year) parts.push(context.year);
	if (context.position) parts.push(context.position.toLowerCase());
	if (context.franchise) parts.push(context.franchise.toLowerCase());
	if (context.pick) parts.push('pick:' + context.pick);

	return parts.length > 1 ? parts.join('|') : null;
}

/**
 * Look up a player name in the resolutions cache.
 * 
 * @param {string} name - Player name (will be normalized)
 * @param {Object} [context] - Optional context { year, position, franchise, pick }
 * @returns {Object|null} - { sleeperId: string|null, name?: string } or null if not found
 *                          Returns { ambiguous: true } if name is in ambiguous list without any cached resolution
 */
function lookup(name, context) {
	var normalized = normalizePlayerName(name);
	var res = loadResolutions();

	// Try context-specific key first (if context provided)
	if (context) {
		var contextKey = buildContextKey(normalized, context);
		if (contextKey && res[contextKey]) {
			return res[contextKey];
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
	save: saveResolutions
};
