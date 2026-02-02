/**
 * Draft Facts Parser
 * 
 * Extracts raw facts from Google Sheets draft data without inference.
 * Supports both network fetching and local cache loading.
 */

var fs = require('fs');
var path = require('path');
var request = require('superagent');

// Sheet URLs
var PAST_DRAFTS_SHEET = 'https://sheets.googleapis.com/v4/spreadsheets/1O0iyyKdniwP-oVvBTwlgxJRYs_WhMsypHGBDB8AO2lM/values/';
var MAIN_SHEET = 'https://sheets.googleapis.com/v4/spreadsheets/1nas3AqWZtCu_UZIV77Jgxd9oriF1NQjzSjFWW86eong/values/';

// Local cache directory
var DRAFTS_DIR = path.join(__dirname, '../drafts');

/**
 * Parse draft data from sheet rows into raw facts.
 * 
 * @param {number} season - The draft year
 * @param {Array<Array>} rows - Sheet data rows
 * @returns {Array} Array of draft facts
 */
function parseDraftSheet(season, rows) {
	var picks = [];
	
	for (var i = 0; i < rows.length; i++) {
		// Skip header row
		if (i === 0) continue;
		
		var row = rows[i];
		
		// 2020 has an extra column offset
		var offset = (season === 2020) ? 1 : 0;
		
		var pickNumber = parseInt(row[0 + offset]);
		var round = parseInt(row[1 + offset]);
		var owner = row[2 + offset];
		var playerName = row[3 + offset];
		
		// Skip invalid rows
		if (isNaN(round)) continue;
		
		// Skip "pass" selections
		if (!playerName || playerName.toLowerCase() === 'pass') continue;
		
		picks.push({
			season: season,
			pickNumber: isNaN(pickNumber) ? null : pickNumber,
			round: round,
			owner: owner ? owner.trim() : null,
			playerName: playerName.trim()
		});
	}
	
	return picks;
}

/**
 * Fetch draft data for a single season.
 * 
 * @param {number} season - The draft year
 * @param {string} apiKey - Google API key
 * @param {boolean} useMainSheet - Use main sheet (current year) vs past drafts sheet
 * @returns {Promise<Array>} Array of draft facts for that season
 */
async function fetchSeason(season, apiKey, useMainSheet) {
	if (!apiKey) {
		throw new Error('GOOGLE_API_KEY required');
	}
	
	var sheetName = useMainSheet ? (season + ' Draft') : String(season);
	var baseUrl = useMainSheet ? MAIN_SHEET : PAST_DRAFTS_SHEET;
	
	try {
		var response = await request
			.get(baseUrl + encodeURIComponent(sheetName))
			.query({ alt: 'json', key: apiKey });

		var dataJson = JSON.parse(response.text);
		return parseDraftSheet(season, dataJson.values);
	} catch (err) {
		// Sheet might not exist for this year
		return [];
	}
}

/**
 * Fetch all draft data from 2010 to current year (plus future drafts).
 * 
 * @param {string} apiKey - Google API key
 * @param {number} currentYear - Current season year
 * @returns {Promise<Array>} Array of all draft facts
 */
async function fetchAll(apiKey, currentYear) {
	if (!apiKey) {
		throw new Error('GOOGLE_API_KEY required');
	}
	
	var allPicks = [];
	var startYear = 2010; // No 2009 data
	
	// Fetch past drafts (2010 through currentYear-1) from past drafts sheet
	for (var year = startYear; year < currentYear; year++) {
		var picks = await fetchSeason(year, apiKey, false);
		allPicks = allPicks.concat(picks);
	}
	
	// Fetch current year and future years from main sheet
	// Try current year through current+2 to catch future drafts
	for (var year = currentYear; year <= currentYear + 2; year++) {
		var picks = await fetchSeason(year, apiKey, true);
		allPicks = allPicks.concat(picks);
	}
	
	// Also try fetching recent years from main sheet in case they haven't
	// been archived to past drafts sheet yet
	for (var year = currentYear - 1; year >= currentYear - 2; year--) {
		// Only add if we didn't already get picks for this year
		var existingForYear = allPicks.filter(function(p) { return p.season === year; });
		if (existingForYear.length === 0) {
			var picks = await fetchSeason(year, apiKey, true);
			allPicks = allPicks.concat(picks);
		}
	}
	
	return allPicks;
}

/**
 * Group draft picks by season for analysis.
 * 
 * @param {Array} draftFacts - Array of draft facts
 * @returns {object} Picks grouped by season
 */
function groupBySeason(draftFacts) {
	var bySeason = {};
	
	draftFacts.forEach(function(pick) {
		var year = pick.season;
		if (!bySeason[year]) bySeason[year] = [];
		bySeason[year].push(pick);
	});
	
	return bySeason;
}

/**
 * Get summary statistics for draft facts.
 * 
 * @param {Array} draftFacts - Array of draft facts
 * @returns {object} Summary stats
 */
function getSummary(draftFacts) {
	var bySeason = groupBySeason(draftFacts);
	var seasons = Object.keys(bySeason).sort();
	
	return {
		total: draftFacts.length,
		seasons: seasons,
		bySeason: Object.keys(bySeason).reduce(function(acc, year) {
			acc[year] = bySeason[year].length;
			return acc;
		}, {})
	};
}

/**
 * Check if local draft cache exists.
 * 
 * @returns {boolean} True if cache file exists
 */
function checkAvailability() {
	var cacheFile = path.join(DRAFTS_DIR, 'drafts.json');
	return fs.existsSync(cacheFile);
}

/**
 * Load draft data from local cache.
 * 
 * @returns {Array} Array of draft facts from cache, or empty array if not cached
 */
function loadAll() {
	var cacheFile = path.join(DRAFTS_DIR, 'drafts.json');
	
	if (!fs.existsSync(cacheFile)) {
		return [];
	}
	
	var raw = fs.readFileSync(cacheFile, 'utf8');
	return JSON.parse(raw);
}

/**
 * Load draft data for a specific season from local cache.
 * 
 * @param {number} season - The draft year
 * @returns {Array} Array of draft facts for that season
 */
function loadSeason(season) {
	var all = loadAll();
	return all.filter(function(pick) {
		return pick.season === season;
	});
}

/**
 * Save draft data to local cache.
 * 
 * @param {Array} draftFacts - Array of draft facts to save
 */
function saveCache(draftFacts) {
	var cacheFile = path.join(DRAFTS_DIR, 'drafts.json');
	
	// Ensure directory exists
	if (!fs.existsSync(DRAFTS_DIR)) {
		fs.mkdirSync(DRAFTS_DIR, { recursive: true });
	}
	
	fs.writeFileSync(cacheFile, JSON.stringify(draftFacts, null, 2));
}

/**
 * Fetch all drafts and save to local cache.
 * 
 * @param {string} apiKey - Google API key
 * @param {number} currentYear - Current season year
 * @returns {Promise<Array>} Array of all draft facts
 */
async function fetchAndCache(apiKey, currentYear) {
	var picks = await fetchAll(apiKey, currentYear);
	saveCache(picks);
	console.log('    Cached ' + picks.length + ' draft picks to ' + path.join(DRAFTS_DIR, 'drafts.json'));
	return picks;
}

module.exports = {
	// Network fetching
	parseDraftSheet: parseDraftSheet,
	fetchSeason: fetchSeason,
	fetchAll: fetchAll,
	fetchAndCache: fetchAndCache,
	
	// Local cache
	checkAvailability: checkAvailability,
	loadAll: loadAll,
	loadSeason: loadSeason,
	saveCache: saveCache,
	
	// Analysis
	groupBySeason: groupBySeason,
	getSummary: getSummary
};
