/**
 * Cut Facts Parser
 * 
 * Extracts raw facts from Google Sheets cuts data without inference.
 * Supports both network fetching and local cache loading.
 * 
 * NAMING CONVENTION: The cuts sheet uses 2025 regime display names for owners
 * (e.g., "Justin", "Jason", "Anthony") regardless of what year the cut occurred.
 * Consumers should map these to franchise IDs using the 2025 regime lookup.
 */

var fs = require('fs');
var path = require('path');
var request = require('superagent');

var SHEET_URL = 'https://sheets.googleapis.com/v4/spreadsheets/1nas3AqWZtCu_UZIV77Jgxd9oriF1NQjzSjFWW86eong/values/Cuts';

// Local cache directory
var CUTS_DIR = path.join(__dirname, '../cuts');

/**
 * Parse a player name that may contain a disambiguation hint.
 * e.g., "Brandon Marshall (DEN)" -> { name: "Brandon Marshall", hint: "DEN" }
 * 
 * @param {string} rawName - The raw player name from the sheet
 * @returns {object} { name, hint, raw }
 */
function parseNameWithHint(rawName) {
	if (!rawName) return { name: null, hint: null, raw: rawName };
	
	var match = rawName.match(/^(.+?)\s*\(([^)]+)\)$/);
	if (match) {
		return {
			name: match[1].trim(),
			hint: match[2].trim(),
			raw: rawName
		};
	}
	return {
		name: rawName.trim(),
		hint: null,
		raw: rawName
	};
}

/**
 * Parse cuts data from sheet rows into raw facts.
 * 
 * Sheet format:
 *   Row 0-1: Headers
 *   Row 2+: Data
 *   Columns: Owner, Name, Position, Start, End, Salary, Cut Year
 * 
 * @param {Array<Array>} rows - Sheet data rows
 * @returns {Array} Array of cut facts
 */
function parseCutsSheet(rows) {
	var cuts = [];
	
	// Skip first 2 header rows
	for (var i = 2; i < rows.length; i++) {
		var row = rows[i];
		
		// Skip empty rows
		if (!row[1]) continue;
		
		var rawName = row[1];
		var parsed = parseNameWithHint(rawName);
		
		// Parse start year - "FA" means null
		var startYearStr = row[3];
		var startYear = null;
		if (startYearStr && startYearStr.toUpperCase() !== 'FA') {
			startYear = parseInt(startYearStr);
			if (isNaN(startYear)) startYear = null;
		}
		
		var endYear = parseInt(row[4]);
		var salary = parseInt((row[5] || '').replace(/[$,]/g, '')) || 0;
		var cutYear = parseInt(row[6]);
		
		cuts.push({
			owner: row[0] || null,
			name: parsed.name,
			hint: parsed.hint,
			rawName: rawName,
			position: row[2] || null,
			startYear: startYear,
			endYear: isNaN(endYear) ? null : endYear,
			salary: salary,
			cutYear: isNaN(cutYear) ? null : cutYear
		});
	}
	
	return cuts;
}

/**
 * Fetch cuts data from Google Sheets and parse into facts.
 * 
 * @param {string} apiKey - Google API key
 * @returns {Promise<Array>} Array of cut facts
 */
async function fetchAll(apiKey) {
	if (!apiKey) {
		throw new Error('GOOGLE_API_KEY required');
	}
	
	var response = await request
		.get(SHEET_URL)
		.query({ alt: 'json', key: apiKey });

	var dataJson = JSON.parse(response.text);
	return parseCutsSheet(dataJson.values);
}

/**
 * Group cuts by year for analysis.
 * 
 * @param {Array} cutFacts - Array of cut facts
 * @returns {object} Cuts grouped by cutYear
 */
function groupByYear(cutFacts) {
	var byYear = {};
	
	cutFacts.forEach(function(cut) {
		var year = cut.cutYear || 'unknown';
		if (!byYear[year]) byYear[year] = [];
		byYear[year].push(cut);
	});
	
	return byYear;
}

/**
 * Get summary statistics for cut facts.
 * 
 * @param {Array} cutFacts - Array of cut facts
 * @returns {object} Summary stats
 */
function getSummary(cutFacts) {
	var byYear = groupByYear(cutFacts);
	var years = Object.keys(byYear).filter(function(y) { return y !== 'unknown'; }).sort();
	
	return {
		total: cutFacts.length,
		yearRange: years.length > 0 ? [years[0], years[years.length - 1]] : null,
		byYear: Object.keys(byYear).reduce(function(acc, year) {
			acc[year] = byYear[year].length;
			return acc;
		}, {}),
		withHints: cutFacts.filter(function(c) { return c.hint; }).length,
		faContracts: cutFacts.filter(function(c) { return c.startYear === null; }).length
	};
}

/**
 * Check if local cuts cache exists.
 * 
 * @returns {boolean} True if cache file exists
 */
function checkAvailability() {
	var cacheFile = path.join(CUTS_DIR, 'cuts.json');
	return fs.existsSync(cacheFile);
}

/**
 * Load cuts data from local cache.
 * 
 * @returns {Array} Array of cut facts from cache, or empty array if not cached
 */
function loadAll() {
	var cacheFile = path.join(CUTS_DIR, 'cuts.json');
	
	if (!fs.existsSync(cacheFile)) {
		return [];
	}
	
	var raw = fs.readFileSync(cacheFile, 'utf8');
	return JSON.parse(raw);
}

/**
 * Save cuts data to local cache.
 * 
 * @param {Array} cutFacts - Array of cut facts to save
 */
function saveCache(cutFacts) {
	var cacheFile = path.join(CUTS_DIR, 'cuts.json');
	
	// Ensure directory exists
	if (!fs.existsSync(CUTS_DIR)) {
		fs.mkdirSync(CUTS_DIR, { recursive: true });
	}
	
	fs.writeFileSync(cacheFile, JSON.stringify(cutFacts, null, 2));
}

/**
 * Fetch all cuts and save to local cache.
 * 
 * @param {string} apiKey - Google API key
 * @returns {Promise<Array>} Array of all cut facts
 */
async function fetchAndCache(apiKey) {
	var cuts = await fetchAll(apiKey);
	saveCache(cuts);
	console.log('    Cached ' + cuts.length + ' cuts to ' + path.join(CUTS_DIR, 'cuts.json'));
	return cuts;
}

/**
 * Build an owner name -> franchise ID map using 2025 regime names.
 * This handles the naming convention used in the cuts sheet.
 * 
 * @param {Array} regimes - Regime documents (with tenures)
 * @param {Array} franchises - Franchise documents
 * @returns {Object} Map of lowercase owner name -> franchise ObjectId
 */
function buildOwnerMap(regimes, franchises) {
	var ownerToFranchise = {};
	
	franchises.forEach(function(franchise) {
		for (var i = 0; i < regimes.length; i++) {
			var regime = regimes[i];
			for (var j = 0; j < regime.tenures.length; j++) {
				var tenure = regime.tenures[j];
				// Use 2025 as the reference year for cuts sheet naming
				if (tenure.franchiseId.equals(franchise._id) &&
					tenure.startSeason <= 2025 &&
					(tenure.endSeason === null || tenure.endSeason >= 2025)) {
					ownerToFranchise[regime.displayName.toLowerCase()] = franchise._id;
					// Also add individual names from partnerships (e.g., "Koci/Mueller" -> "koci", "mueller")
					var parts = regime.displayName.split('/');
					parts.forEach(function(part) {
						ownerToFranchise[part.toLowerCase().trim()] = franchise._id;
					});
				}
			}
		}
	});
	
	return ownerToFranchise;
}

/**
 * Get franchise ID for an owner name using the cuts naming convention.
 * 
 * @param {string} ownerName - Owner name from cuts sheet
 * @param {Object} ownerMap - Map from buildOwnerMap()
 * @returns {ObjectId|null} Franchise ID or null if not found
 */
function getFranchiseId(ownerName, ownerMap) {
	if (!ownerName) return null;
	return ownerMap[ownerName.toLowerCase()] || null;
}

module.exports = {
	// Network fetching
	parseNameWithHint: parseNameWithHint,
	parseCutsSheet: parseCutsSheet,
	fetchAll: fetchAll,
	fetchAndCache: fetchAndCache,
	
	// Local cache
	checkAvailability: checkAvailability,
	loadAll: loadAll,
	saveCache: saveCache,
	
	// Analysis
	groupByYear: groupByYear,
	getSummary: getSummary,
	
	// Owner mapping (cuts sheet uses 2025 regime names)
	buildOwnerMap: buildOwnerMap,
	getFranchiseId: getFranchiseId
};
