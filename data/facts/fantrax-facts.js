/**
 * Fantrax Transaction Facts Parser
 * 
 * Extracts raw facts from Fantrax CSV transaction data for 2020-2021 seasons.
 * 
 * CSV Format:
 *   Player, Team, Position, Type, Team (franchise), Bid, Pr, Grp/Max, Date (PST), Week
 *   "Marcus Mariota","LV","QB","Drop","(Trevor) The Greenbay Packers","","1","1/99","Wed Dec 23, 2020, 8:05PM","16"
 */

var fs = require('fs');
var path = require('path');

var FANTRAX_DIR = path.join(__dirname, '../fantrax');

/**
 * Transaction types in Fantrax data.
 */
var TransactionType = {
	CLAIM: 'Claim',
	DROP: 'Drop'
};

/**
 * FAAB open dates by season.
 * FAAB opens the day before NFL season starts (Wednesday before Thursday kickoff).
 * Transactions before this date are auction/draft entry, not real FAAB.
 */
var faabOpenDates = {
	2020: new Date('2020-09-09'),
	2021: new Date('2021-09-08'),
	2022: new Date('2022-09-07'),
	2023: new Date('2023-09-06'),
	2024: new Date('2024-09-04'),
	2025: new Date('2025-09-03')
};

/**
 * Map owner codes/names from Fantrax team names to canonical owner names.
 * Format: "(code) Team Name" -> extract code
 */
var ownerCodeMap = {
	// Common codes
	'trevor': 'Trevor',
	'keyon': 'Keyon',
	'schx': 'Schex',
	'pat': 'Patrick',
	'reyn': 'Jason',       // Reynolds
	'qtm': 'Mitch',        // Quantum
	'tman': 'James',       // T-Man
	'luke': 'Luke',
	'john': 'John',
	'koci': 'Koci',
	'syed': 'Syed',
	'brett': 'Brett',
	'mike': 'Mike',
	'nance': 'Nance',
	'justin': 'Justin',
	'anthony': 'Anthony',
	'quinn': 'Quinn',
	
	// Additional codes found in Fantrax data
	'mitch': 'Mitch',      // Uppercase variant
	'ridd': 'Jason',       // Riddler = Jason/Reynolds
	'joza': 'John',        // John/Zach regime
	'bleez': 'Brett',      // Brett/Luke regime
	'komu': 'Koci'         // Koci/Mueller regime
};

/**
 * Extract owner from Fantrax team name.
 * e.g., "(Trevor) The Greenbay Packers" -> "Trevor"
 *       "Figrin J'OHN and the Modal Nodes" -> "John"
 *       "Cap'n Geech & The Shrimp Shaq Shooters" -> unknown
 * 
 * @param {string} teamName - Fantrax team name
 * @returns {string|null} Owner name or null if unknown
 */
function extractOwner(teamName) {
	if (!teamName) return null;
	
	// Try parenthetical code first: "(code) Team Name"
	var codeMatch = teamName.match(/^\(([^)]+)\)/);
	if (codeMatch) {
		var code = codeMatch[1].toLowerCase();
		return ownerCodeMap[code] || codeMatch[1];
	}
	
	// Try to find owner name embedded in team name
	var lowerName = teamName.toLowerCase();
	for (var code in ownerCodeMap) {
		if (lowerName.indexOf(code) >= 0) {
			return ownerCodeMap[code];
		}
	}
	
	// Special cases
	if (lowerName.indexOf("j'ohn") >= 0 || lowerName.indexOf('modal nodes') >= 0) {
		return 'John';
	}
	if (lowerName.indexOf('geech') >= 0 || lowerName.indexOf('shrimp shaq') >= 0) {
		return 'Syed'; // Cap'n Geech was Syed's team
	}
	
	return null;
}

/**
 * Parse a Fantrax date string.
 * e.g., "Wed Dec 23, 2020, 8:05PM" -> Date object
 * 
 * @param {string} dateStr - Fantrax date string
 * @returns {Date|null} Parsed date or null
 */
function parseDate(dateStr) {
	if (!dateStr) return null;
	
	try {
		// Remove day name prefix
		var cleaned = dateStr.replace(/^[A-Za-z]+\s+/, '');
		// Parse "Dec 23, 2020, 8:05PM"
		var match = cleaned.match(/([A-Za-z]+)\s+(\d+),\s+(\d+),\s+(\d+):(\d+)(AM|PM)/i);
		if (!match) return null;
		
		var months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, 
		               jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
		var month = months[match[1].toLowerCase()];
		var day = parseInt(match[2]);
		var year = parseInt(match[3]);
		var hour = parseInt(match[4]);
		var minute = parseInt(match[5]);
		var ampm = match[6].toUpperCase();
		
		if (ampm === 'PM' && hour < 12) hour += 12;
		if (ampm === 'AM' && hour === 12) hour = 0;
		
		// PST is UTC-8
		return new Date(Date.UTC(year, month, day, hour + 8, minute));
	} catch (err) {
		return null;
	}
}

/**
 * Parse a single CSV line (handles quoted fields).
 * 
 * @param {string} line - CSV line
 * @returns {Array} Array of field values
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
			fields.push(current);
			current = '';
		} else {
			current += char;
		}
	}
	fields.push(current);
	
	return fields;
}

/**
 * Parse a Fantrax CSV file into transaction facts.
 * 
 * @param {number} season - The season year
 * @param {string} content - CSV file content
 * @returns {Array} Array of transaction facts
 */
function parseCSV(season, content) {
	var lines = content.trim().split('\n');
	var transactions = [];
	
	// Skip header row
	for (var i = 1; i < lines.length; i++) {
		var line = lines[i].trim();
		if (!line) continue;
		
		var fields = parseCSVLine(line);
		if (fields.length < 10) continue;
		
		var playerName = fields[0];
		var nflTeam = fields[1];
		var position = fields[2];
		var type = fields[3];
		var franchiseTeam = fields[4];
		var bid = fields[5];
		var priority = fields[6];
		var dateStr = fields[8];
		var week = fields[9];
		
		var owner = extractOwner(franchiseTeam);
		var timestamp = parseDate(dateStr);
		
		transactions.push({
			season: season,
			type: type,
			timestamp: timestamp,
			week: parseInt(week) || null,
			owner: owner,
			franchiseTeam: franchiseTeam,
			playerName: playerName,
			nflTeam: nflTeam,
			position: position,
			bid: bid ? parseFloat(bid) : null,
			priority: parseInt(priority) || null,
			_raw: line
		});
	}
	
	return transactions;
}

/**
 * Load transaction facts for a single season.
 * 
 * @param {number} season - The season year (2020 or 2021)
 * @returns {Array} Array of transaction facts for that season
 */
function loadSeason(season) {
	var filename = 'transactions-' + season + '.csv';
	var filepath = path.join(FANTRAX_DIR, filename);
	
	if (!fs.existsSync(filepath)) {
		return [];
	}
	
	var content = fs.readFileSync(filepath, 'utf8');
	return parseCSV(season, content);
}

/**
 * Load all available Fantrax transaction facts (2020-2021).
 * 
 * @returns {Array} Array of all transaction facts
 */
function loadAll() {
	var allTransactions = [];
	
	[2020, 2021].forEach(function(season) {
		var transactions = loadSeason(season);
		allTransactions = allTransactions.concat(transactions);
	});
	
	// Sort by timestamp (newest first, matching CSV order)
	allTransactions.sort(function(a, b) {
		if (!a.timestamp) return 1;
		if (!b.timestamp) return -1;
		return b.timestamp - a.timestamp;
	});
	
	return allTransactions;
}

/**
 * Check if Fantrax data is available.
 * 
 * @returns {object} { available: boolean, years: [], counts: {} }
 */
function checkAvailability() {
	var result = { available: false, years: [], counts: {} };
	
	if (!fs.existsSync(FANTRAX_DIR)) {
		return result;
	}
	
	[2020, 2021].forEach(function(year) {
		var filepath = path.join(FANTRAX_DIR, 'transactions-' + year + '.csv');
		if (fs.existsSync(filepath)) {
			result.years.push(year);
			var transactions = loadSeason(year);
			result.counts[year] = transactions.length;
		}
	});
	
	result.available = result.years.length > 0;
	return result;
}

/**
 * Filter transactions by type.
 * 
 * @param {Array} transactions - Array of transaction facts
 * @param {string|Array} types - Type(s) to filter for
 * @returns {Array} Filtered transactions
 */
function filterByType(transactions, types) {
	if (!Array.isArray(types)) {
		types = [types];
	}
	
	// Normalize types for comparison
	var normalizedTypes = types.map(function(t) { return t.toLowerCase(); });
	
	return transactions.filter(function(tx) {
		return normalizedTypes.indexOf(tx.type.toLowerCase()) >= 0;
	});
}

/**
 * Get claims only.
 * 
 * @param {Array} transactions - Array of transaction facts
 * @returns {Array} Claim transactions only
 */
function getClaims(transactions) {
	return filterByType(transactions, ['Claim', 'claim']);
}

/**
 * Get drops only.
 * 
 * @param {Array} transactions - Array of transaction facts
 * @returns {Array} Drop transactions only
 */
function getDrops(transactions) {
	return filterByType(transactions, ['Drop', 'drop']);
}

/**
 * Group transactions by owner.
 * 
 * @param {Array} transactions - Array of transaction facts
 * @returns {object} Transactions grouped by owner
 */
function groupByOwner(transactions) {
	var byOwner = {};
	
	transactions.forEach(function(tx) {
		var owner = tx.owner || 'unknown';
		if (!byOwner[owner]) byOwner[owner] = [];
		byOwner[owner].push(tx);
	});
	
	return byOwner;
}

/**
 * Check if a transaction is before FAAB opened for that season.
 * Pre-FAAB transactions are typically auction/draft entry, not real FAAB claims.
 * 
 * @param {object} tx - Transaction fact
 * @returns {boolean} True if transaction is pre-FAAB
 */
function isPreFaab(tx) {
	if (!tx.timestamp) return false;
	var faabOpen = faabOpenDates[tx.season];
	return faabOpen && tx.timestamp < faabOpen;
}

/**
 * Filter to only real FAAB transactions (after FAAB opened).
 * 
 * @param {Array} transactions - Array of transaction facts
 * @returns {Array} Only transactions after FAAB opened
 */
function filterRealFaab(transactions) {
	return transactions.filter(function(tx) {
		return !isPreFaab(tx);
	});
}

/**
 * Filter to only pre-FAAB transactions (auction/draft entry).
 * 
 * @param {Array} transactions - Array of transaction facts
 * @returns {Array} Only transactions before FAAB opened
 */
function filterPreFaab(transactions) {
	return transactions.filter(isPreFaab);
}

/**
 * Find suspicious transactions (potential rollbacks).
 * A claim followed shortly by a drop of the same player could be a rollback.
 * 
 * @param {Array} transactions - Array of transaction facts
 * @returns {Array} Array of suspicious transaction pairs
 */
function findSuspiciousTransactions(transactions) {
	var suspicious = [];
	
	// Sort by timestamp ascending
	var sorted = transactions.slice().sort(function(a, b) {
		if (!a.timestamp) return 1;
		if (!b.timestamp) return -1;
		return a.timestamp - b.timestamp;
	});
	
	// Look for claim-then-drop of same player by same owner within short time
	for (var i = 0; i < sorted.length; i++) {
		var tx = sorted[i];
		if (tx.type.toLowerCase() !== 'claim') continue;
		
		// Look ahead for matching drop
		for (var j = i + 1; j < sorted.length && j < i + 50; j++) {
			var other = sorted[j];
			if (other.type.toLowerCase() !== 'drop') continue;
			if (other.playerName !== tx.playerName) continue;
			if (other.owner !== tx.owner) continue;
			
			// Check time difference (less than 48 hours is suspicious)
			if (tx.timestamp && other.timestamp) {
				var hoursDiff = (other.timestamp - tx.timestamp) / (1000 * 60 * 60);
				if (hoursDiff < 48) {
					suspicious.push({
						claim: tx,
						drop: other,
						hoursBetween: Math.round(hoursDiff)
					});
					break;
				}
			}
		}
	}
	
	return suspicious;
}

/**
 * Get summary statistics for transaction facts.
 * 
 * @param {Array} transactions - Array of transaction facts
 * @returns {object} Summary stats
 */
function getSummary(transactions) {
	var byType = {};
	var bySeason = {};
	var byOwner = {};
	var unknownOwner = 0;
	
	transactions.forEach(function(tx) {
		byType[tx.type] = (byType[tx.type] || 0) + 1;
		bySeason[tx.season] = (bySeason[tx.season] || 0) + 1;
		if (tx.owner) {
			byOwner[tx.owner] = (byOwner[tx.owner] || 0) + 1;
		} else {
			unknownOwner++;
		}
	});
	
	return {
		total: transactions.length,
		byType: byType,
		bySeason: bySeason,
		byOwner: byOwner,
		unknownOwner: unknownOwner,
		seasons: Object.keys(bySeason).sort()
	};
}

module.exports = {
	// Constants
	TransactionType: TransactionType,
	faabOpenDates: faabOpenDates,
	
	// Core parsing
	parseCSV: parseCSV,
	parseCSVLine: parseCSVLine,
	parseDate: parseDate,
	extractOwner: extractOwner,
	
	// Loading
	loadSeason: loadSeason,
	loadAll: loadAll,
	checkAvailability: checkAvailability,
	
	// Filtering
	filterByType: filterByType,
	getClaims: getClaims,
	getDrops: getDrops,
	groupByOwner: groupByOwner,
	isPreFaab: isPreFaab,
	filterRealFaab: filterRealFaab,
	filterPreFaab: filterPreFaab,
	
	// Analysis
	findSuspiciousTransactions: findSuspiciousTransactions,
	getSummary: getSummary
};
