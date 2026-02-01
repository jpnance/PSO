/**
 * Cut Facts Parser
 * 
 * Extracts raw facts from Google Sheets cuts data without inference.
 */

var request = require('superagent');

var SHEET_URL = 'https://sheets.googleapis.com/v4/spreadsheets/1nas3AqWZtCu_UZIV77Jgxd9oriF1NQjzSjFWW86eong/values/Cuts';

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

module.exports = {
	parseNameWithHint: parseNameWithHint,
	parseCutsSheet: parseCutsSheet,
	fetchAll: fetchAll,
	groupByYear: groupByYear,
	getSummary: getSummary
};
