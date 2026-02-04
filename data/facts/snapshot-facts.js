/**
 * Snapshot Facts Parser
 * 
 * Extracts raw facts from contracts-YEAR.txt files without inference.
 * These files represent post-season roster snapshots with explicit contract terms.
 */

var fs = require('fs');
var path = require('path');

var ARCHIVE_DIR = path.join(__dirname, '../archive/snapshots');

/**
 * Parse a contracts CSV file into raw facts.
 * 
 * CSV format: ID,Owner,Player,Position,Start,End,Salary
 * 
 * @param {number} season - The season year
 * @param {string} content - File content
 * @returns {Array} Array of snapshot facts
 */
function parseContractsFile(season, content) {
	var lines = content.trim().split('\n');
	var contracts = [];
	
	// Skip header row
	for (var i = 1; i < lines.length; i++) {
		var line = lines[i];
		if (!line.trim()) continue;
		
		// Parse CSV using quote-aware parser (handles names like "Ted Ginn, Jr.")
		var cols = parseCSVLine(line);
		if (cols.length < 7) continue;
		
		var espnId = cols[0];
		var owner = cols[1];
		var playerName = cols[2];
		var position = cols[3];
		var startStr = cols[4];
		var endStr = cols[5];
		var salaryStr = cols[6];
		
		// Skip empty owner (free agents listed at bottom)
		if (!owner) continue;
		
		// Parse years
		var startYear = null;
		if (startStr && startStr.toUpperCase() !== 'FA') {
			startYear = parseInt(startStr);
			if (isNaN(startYear)) startYear = null;
		}
		
		var endYear = parseInt(endStr);
		if (isNaN(endYear)) endYear = null;
		
		// Parse salary (remove $ and commas)
		var salary = parseInt(salaryStr.replace(/[$,]/g, ''));
		if (isNaN(salary)) salary = null;
		
		contracts.push({
			season: season,
			espnId: espnId === '-1' ? null : espnId,
			owner: owner,
			playerName: playerName,
			position: position,
			startYear: startYear,
			endYear: endYear,
			salary: salary
		});
	}
	
	return contracts;
}

/**
 * Load snapshot facts for a single season from contracts file.
 * 
 * @param {number} season - The season year
 * @returns {Array} Array of snapshot facts for that season
 */
function loadSeason(season) {
	var filename = 'contracts-' + season + '.txt';
	var filepath = path.join(ARCHIVE_DIR, filename);
	
	if (!fs.existsSync(filepath)) {
		return [];
	}
	
	var content = fs.readFileSync(filepath, 'utf8');
	var contracts = parseContractsFile(season, content);
	
	// Mark source
	contracts.forEach(function(c) { c.source = 'contracts'; });
	
	return contracts;
}

/**
 * Load postseason snapshot facts for a single season.
 * 
 * @param {number} season - The season year
 * @returns {Array} Array of snapshot facts for that season
 */
function loadPostseason(season) {
	var filename = 'postseason-' + season + '.txt';
	var filepath = path.join(ARCHIVE_DIR, filename);
	
	if (!fs.existsSync(filepath)) {
		return [];
	}
	
	var content = fs.readFileSync(filepath, 'utf8');
	var contracts = parseContractsFile(season, content);
	
	// Mark source
	contracts.forEach(function(c) { c.source = 'postseason'; });
	
	return contracts;
}

/**
 * Load all snapshot facts for a season from all available sources.
 * 
 * @param {number} season - The season year
 * @param {object} options - { preferPostseason: boolean }
 * @returns {Array} Array of snapshot facts
 */
function loadSeasonAll(season, options) {
	options = options || {};
	
	var contracts = loadSeason(season);
	var postseason = loadPostseason(season);
	
	if (options.preferPostseason && postseason.length > 0) {
		return postseason;
	}
	
	// If we have both, postseason is more authoritative (taken after season ends)
	if (postseason.length > 0 && contracts.length > 0) {
		// Could merge or prefer one - for now prefer postseason
		return postseason;
	}
	
	return contracts.length > 0 ? contracts : postseason;
}

/**
 * Parse a CSV line handling quoted fields.
 * Handles fields like: "Ted Ginn, Jr." where comma is inside quotes.
 */
function parseCSVLine(line) {
	var fields = [];
	var current = '';
	var inQuotes = false;
	
	for (var i = 0; i < line.length; i++) {
		var char = line[i];
		
		if (char === '"') {
			inQuotes = !inQuotes;
		} else if (char === ',' && !inQuotes) {
			fields.push(current.trim());
			current = '';
		} else {
			current += char;
		}
	}
	fields.push(current.trim());
	
	return fields;
}

/**
 * Load extracted-all.csv which contains early-year data from various spreadsheets.
 * Only includes entries with owner attribution.
 * 
 * CSV format: Source,Year,EspnId,Owner,Name,Position,Start,End,Salary
 * 
 * @returns {Array} Array of snapshot facts from extracted-all.csv
 */
function loadExtractedAll() {
	var filepath = path.join(ARCHIVE_DIR, 'extracted-all.csv');
	
	if (!fs.existsSync(filepath)) {
		return [];
	}
	
	var content = fs.readFileSync(filepath, 'utf8');
	var lines = content.trim().split('\n');
	var contracts = [];
	
	// Skip header row
	for (var i = 1; i < lines.length; i++) {
		var line = lines[i];
		if (!line.trim()) continue;
		
		var cols = parseCSVLine(line);
		if (cols.length < 9) continue;
		
		var source = cols[0];
		var year = parseInt(cols[1]);
		var espnId = cols[2];
		var owner = cols[3];
		var playerName = cols[4];
		var position = cols[5];
		var startStr = cols[6];
		var endStr = cols[7];
		var salaryStr = cols[8];
		
		// Skip entries without owner (can't use for disambiguation)
		if (!owner) continue;
		
		// Skip if no year
		if (isNaN(year)) continue;
		
		// Parse years
		var startYear = null;
		if (startStr && startStr.toUpperCase() !== 'FA') {
			startYear = parseInt(startStr);
			if (isNaN(startYear)) startYear = null;
		}
		
		var endYear = parseInt(endStr);
		if (isNaN(endYear)) endYear = null;
		
		// Parse salary
		var salary = parseInt(salaryStr.replace(/[$,]/g, ''));
		if (isNaN(salary)) salary = null;
		
		contracts.push({
			season: year,
			espnId: espnId || null,
			owner: owner,
			playerName: playerName,
			position: position,
			startYear: startYear,
			endYear: endYear,
			salary: salary,
			source: 'extracted:' + source
		});
	}
	
	return contracts;
}

/**
 * Load all available snapshot facts from all sources.
 * 
 * @param {number} startYear - First year to load (default 2008)
 * @param {number} endYear - Last year to load (default current year)
 * @param {object} options - { includePostseason: boolean (default true), includeExtracted: boolean (default true) }
 * @returns {Array} Array of all snapshot facts
 */
function loadAll(startYear, endYear, options) {
	startYear = startYear || 2008;
	endYear = endYear || new Date().getFullYear();
	options = options || { includePostseason: true, includeExtracted: true };
	if (options.includePostseason === undefined) options.includePostseason = true;
	if (options.includeExtracted === undefined) options.includeExtracted = true;
	
	var allContracts = [];
	var info = getAvailableYears();
	
	for (var year = startYear; year <= endYear; year++) {
		// Load from contracts file
		var contracts = loadSeason(year);
		allContracts = allContracts.concat(contracts);
		
		// Also load postseason if available and requested
		if (options.includePostseason) {
			var postseason = loadPostseason(year);
			allContracts = allContracts.concat(postseason);
		}
	}
	
	// Load extracted-all.csv if requested (filtered to year range)
	if (options.includeExtracted) {
		var extracted = loadExtractedAll().filter(function(c) {
			return c.season >= startYear && c.season <= endYear;
		});
		allContracts = allContracts.concat(extracted);
	}
	
	return allContracts;
}

/**
 * Get list of available snapshot years and their sources.
 * 
 * @returns {object} { years: [number], sources: { year: ['contracts', 'postseason'] } }
 */
function getAvailableYears() {
	var files = fs.readdirSync(ARCHIVE_DIR);
	var yearSet = {};
	var sources = {};
	
	files.forEach(function(file) {
		var contractsMatch = file.match(/^contracts-(\d{4})\.txt$/);
		var postseasonMatch = file.match(/^postseason-(\d{4})\.txt$/);
		
		if (contractsMatch) {
			var year = parseInt(contractsMatch[1]);
			yearSet[year] = true;
			if (!sources[year]) sources[year] = [];
			sources[year].push('contracts');
		}
		if (postseasonMatch) {
			var year = parseInt(postseasonMatch[1]);
			yearSet[year] = true;
			if (!sources[year]) sources[year] = [];
			sources[year].push('postseason');
		}
	});
	
	var years = Object.keys(yearSet).map(Number).sort();
	return { years: years, sources: sources };
}

/**
 * Group snapshots by season for analysis.
 * 
 * @param {Array} snapshotFacts - Array of snapshot facts
 * @returns {object} Snapshots grouped by season
 */
function groupBySeason(snapshotFacts) {
	var bySeason = {};
	
	snapshotFacts.forEach(function(contract) {
		var year = contract.season;
		if (!bySeason[year]) bySeason[year] = [];
		bySeason[year].push(contract);
	});
	
	return bySeason;
}

/**
 * Group snapshots by player for analysis.
 * 
 * @param {Array} snapshotFacts - Array of snapshot facts
 * @returns {object} Snapshots grouped by player name
 */
function groupByPlayer(snapshotFacts) {
	var byPlayer = {};
	
	snapshotFacts.forEach(function(contract) {
		var name = contract.playerName;
		if (!byPlayer[name]) byPlayer[name] = [];
		byPlayer[name].push(contract);
	});
	
	return byPlayer;
}

/**
 * Get summary statistics for snapshot facts.
 * 
 * @param {Array} snapshotFacts - Array of snapshot facts
 * @returns {object} Summary stats
 */
function getSummary(snapshotFacts) {
	var bySeason = groupBySeason(snapshotFacts);
	var seasons = Object.keys(bySeason).sort();
	
	var withEspnId = snapshotFacts.filter(function(c) { return c.espnId; }).length;
	var faContracts = snapshotFacts.filter(function(c) { return c.startYear === null; }).length;
	
	return {
		total: snapshotFacts.length,
		seasons: seasons,
		bySeason: Object.keys(bySeason).reduce(function(acc, year) {
			acc[year] = bySeason[year].length;
			return acc;
		}, {}),
		withEspnId: withEspnId,
		faContracts: faContracts
	};
}

/**
 * Find a player's contract history across all snapshots.
 * 
 * @param {Array} snapshotFacts - Array of snapshot facts
 * @param {string} playerName - Player name to search for
 * @returns {Array} Contracts for that player, sorted by season
 */
function findPlayerHistory(snapshotFacts, playerName) {
	var normalizedSearch = playerName.toLowerCase().replace(/[^a-z]/g, '');
	
	return snapshotFacts
		.filter(function(c) {
			var normalizedName = c.playerName.toLowerCase().replace(/[^a-z]/g, '');
			return normalizedName === normalizedSearch;
		})
		.sort(function(a, b) { return a.season - b.season; });
}

/**
 * Extract ownership facts from snapshots.
 * 
 * An ownership fact is: { owner, player, startYear, salary, seenInSeasons: [] }
 * This represents: "this owner had this player under a contract starting in startYear"
 * 
 * @param {Array} snapshotFacts - All snapshot facts
 * @returns {Array} Array of ownership facts
 */
function extractOwnershipFacts(snapshotFacts) {
	// Key: owner|player|startYear -> fact
	var factMap = {};
	
	snapshotFacts.forEach(function(s) {
		if (!s.owner || !s.playerName) return;
		
		// Use startYear if available, otherwise infer from endYear
		var startYear = s.startYear;
		if (startYear === null && s.endYear) {
			// FA contract - startYear is same as endYear
			startYear = s.endYear;
		}
		if (!startYear) return;
		
		var key = s.owner + '|' + s.playerName.toLowerCase() + '|' + startYear;
		
		if (!factMap[key]) {
			factMap[key] = {
				owner: s.owner,
				playerName: s.playerName,
				startYear: startYear,
				endYear: s.endYear,
				salary: s.salary,
				seenInSeasons: [],
				espnId: s.espnId,
				position: s.position
			};
		}
		
		// Track which seasons we saw this ownership
		if (factMap[key].seenInSeasons.indexOf(s.season) < 0) {
			factMap[key].seenInSeasons.push(s.season);
		}
		
		// Update endYear if we see it in a later season
		if (s.endYear && s.endYear > factMap[key].endYear) {
			factMap[key].endYear = s.endYear;
		}
		
		// Capture ESPN ID if we get one
		if (s.espnId && !factMap[key].espnId) {
			factMap[key].espnId = s.espnId;
		}
	});
	
	// Sort seasons
	var facts = Object.values(factMap);
	facts.forEach(function(f) {
		f.seenInSeasons.sort();
	});
	
	return facts;
}

/**
 * Find ownership changes for a player across snapshots.
 * 
 * @param {Array} ownershipFacts - From extractOwnershipFacts()
 * @param {string} playerName - Player to search for
 * @returns {Array} Ownership facts for that player, sorted by startYear
 */
function findPlayerOwnership(ownershipFacts, playerName) {
	var normalized = playerName.toLowerCase().replace(/[^a-z]/g, '');
	
	return ownershipFacts
		.filter(function(f) {
			var fNorm = f.playerName.toLowerCase().replace(/[^a-z]/g, '');
			return fNorm === normalized;
		})
		.sort(function(a, b) { return a.startYear - b.startYear; });
}

module.exports = {
	parseCSVLine: parseCSVLine,
	parseContractsFile: parseContractsFile,
	loadSeason: loadSeason,
	loadPostseason: loadPostseason,
	loadSeasonAll: loadSeasonAll,
	loadExtractedAll: loadExtractedAll,
	loadAll: loadAll,
	getAvailableYears: getAvailableYears,
	groupBySeason: groupBySeason,
	groupByPlayer: groupByPlayer,
	getSummary: getSummary,
	findPlayerHistory: findPlayerHistory,
	extractOwnershipFacts: extractOwnershipFacts,
	findPlayerOwnership: findPlayerOwnership
};
