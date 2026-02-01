/**
 * Draft Facts Parser
 * 
 * Extracts raw facts from Google Sheets draft data without inference.
 */

var request = require('superagent');

// Sheet URLs
var PAST_DRAFTS_SHEET = 'https://sheets.googleapis.com/v4/spreadsheets/1O0iyyKdniwP-oVvBTwlgxJRYs_WhMsypHGBDB8AO2lM/values/';
var MAIN_SHEET = 'https://sheets.googleapis.com/v4/spreadsheets/1nas3AqWZtCu_UZIV77Jgxd9oriF1NQjzSjFWW86eong/values/';

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
 * Fetch all draft data from 2010 to current year.
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
	
	// Fetch past drafts (2010 through currentYear-1)
	for (var year = startYear; year < currentYear; year++) {
		var picks = await fetchSeason(year, apiKey, false);
		allPicks = allPicks.concat(picks);
	}
	
	// Fetch current year from main sheet
	var currentPicks = await fetchSeason(currentYear, apiKey, true);
	allPicks = allPicks.concat(currentPicks);
	
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

module.exports = {
	parseDraftSheet: parseDraftSheet,
	fetchSeason: fetchSeason,
	fetchAll: fetchAll,
	groupBySeason: groupBySeason,
	getSummary: getSummary
};
