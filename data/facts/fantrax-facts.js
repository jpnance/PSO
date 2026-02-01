/**
 * Fantrax Transaction Facts Parser
 * 
 * Extracts raw facts from Fantrax XHR JSON transaction data for 2020-2021 seasons.
 * 
 * XHR JSON Format (from Fantrax transaction history API):
 *   responses[0].data.table.rows[] - array of individual player movements
 *   Each row has txSetId to group related movements (claim + drop = one transaction)
 */

var fs = require('fs');
var path = require('path');

var FANTRAX_DIR = path.join(__dirname, '../fantrax');

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
 * Parse a Fantrax date string from XHR response.
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
 * Extract cell value by key from a row's cells array.
 * 
 * @param {Array} cells - Array of cell objects
 * @param {string} key - Cell key to find
 * @returns {string|null} Cell content or null
 */
function getCellValue(cells, key) {
	if (!cells) return null;
	var cell = cells.find(function(c) { return c.key === key; });
	return cell ? cell.content : null;
}

/**
 * Parse a single XHR row into a player movement.
 * 
 * @param {object} row - XHR row object
 * @returns {object} Player movement fact
 */
function parseRow(row) {
	var scorer = row.scorer || {};
	var cells = row.cells || [];
	
	var teamCell = cells.find(function(c) { return c.key === 'team'; });
	var franchiseTeam = teamCell ? teamCell.content : null;
	var teamId = teamCell ? teamCell.teamId : null;
	
	return {
		txSetId: row.txSetId,
		transactionCode: row.transactionCode,  // 'CLAIM' or 'DROP'
		transactionType: row.transactionType,  // 'Claim' or 'Drop'
		executed: row.executed,
		resultCode: row.resultCode,
		claimType: row.claimType,              // 'FA' for free agent, '' for drops
		numInGroup: row.numInGroup,
		
		// Player info
		playerId: scorer.scorerId,
		playerName: scorer.name,
		playerShortName: scorer.shortName,
		positions: scorer.posShortNames,
		nflTeam: scorer.teamShortName,
		nflTeamFull: scorer.teamName,
		isRookie: scorer.rookie,
		
		// Franchise info
		franchiseTeam: franchiseTeam,
		franchiseTeamId: teamId,
		owner: extractOwner(franchiseTeam),
		
		// Transaction details
		bid: getCellValue(cells, 'bid'),
		priority: getCellValue(cells, 'priority'),
		week: getCellValue(cells, 'week'),
		dateStr: getCellValue(cells, 'date'),
		
		// Raw for debugging
		_raw: row
	};
}

/**
 * Group rows by txSetId into unified transactions.
 * 
 * @param {Array} rows - Array of parsed row objects
 * @param {number} season - Season year
 * @returns {Array} Array of grouped transactions
 */
function groupByTxSetId(rows, season) {
	// Group by txSetId
	var groups = {};
	rows.forEach(function(row) {
		var id = row.txSetId;
		if (!groups[id]) {
			groups[id] = [];
		}
		groups[id].push(row);
	});
	
	// Convert each group to a unified transaction
	var transactions = [];
	Object.keys(groups).forEach(function(txSetId) {
		var group = groups[txSetId];
		
		var adds = [];
		var drops = [];
		var timestamp = null;
		var week = null;
		var owner = null;
		var franchiseTeam = null;
		var franchiseTeamId = null;
		var bid = null;
		var executed = true;
		var claimType = null;
		
		group.forEach(function(row) {
			// Collect common transaction info from any row
			if (!timestamp && row.dateStr) {
				timestamp = parseDate(row.dateStr);
			}
			if (!week && row.week) {
				week = parseInt(row.week) || null;
			}
			if (!owner && row.owner) {
				owner = row.owner;
			}
			if (!franchiseTeam && row.franchiseTeam) {
				franchiseTeam = row.franchiseTeam;
			}
			if (!franchiseTeamId && row.franchiseTeamId) {
				franchiseTeamId = row.franchiseTeamId;
			}
			if (row.executed === false) {
				executed = false;
			}
			
			// Build player movement
			var playerMovement = {
				playerId: row.playerId,
				playerName: row.playerName,
				positions: row.positions,
				nflTeam: row.nflTeam,
				isRookie: row.isRookie
			};
			
			if (row.transactionCode === 'CLAIM') {
				adds.push(playerMovement);
				if (row.bid) {
					bid = parseFloat(row.bid) || null;
				}
				if (row.claimType) {
					claimType = row.claimType;
				}
			} else if (row.transactionCode === 'DROP') {
				drops.push(playerMovement);
			}
		});
		
		// Determine transaction type
		var type = 'unknown';
		if (adds.length > 0 && drops.length > 0) {
			type = 'waiver';  // claim + drop
		} else if (adds.length > 0) {
			type = 'claim';   // just a claim (no corresponding drop)
		} else if (drops.length > 0) {
			type = 'drop';    // just a drop
		}
		
		transactions.push({
			transactionId: txSetId,
			season: season,
			type: type,
			claimType: claimType,
			timestamp: timestamp,
			week: week,
			owner: owner,
			franchiseTeam: franchiseTeam,
			franchiseTeamId: franchiseTeamId,
			executed: executed,
			adds: adds,
			drops: drops,
			bid: bid,
			numInGroup: group.length
		});
	});
	
	return transactions;
}

/**
 * Parse a Fantrax XHR JSON file into transaction facts.
 * 
 * @param {number} season - The season year
 * @param {object} data - Parsed JSON data
 * @returns {Array} Array of transaction facts (grouped by txSetId)
 */
function parseJSON(season, data) {
	// Navigate to the rows array
	var rows = [];
	if (data.responses && data.responses[0] && data.responses[0].data && 
	    data.responses[0].data.table && data.responses[0].data.table.rows) {
		rows = data.responses[0].data.table.rows;
	}
	
	if (rows.length === 0) {
		return [];
	}
	
	// Parse each row
	var parsedRows = rows.map(parseRow);
	
	// Group by txSetId
	return groupByTxSetId(parsedRows, season);
}

/**
 * Load transaction facts for a single season.
 * 
 * @param {number} season - The season year (2020 or 2021)
 * @returns {Array} Array of transaction facts for that season
 */
function loadSeason(season) {
	var filename = 'transactions-' + season + '.json';
	var filepath = path.join(FANTRAX_DIR, filename);
	
	if (!fs.existsSync(filepath)) {
		return [];
	}
	
	var content = fs.readFileSync(filepath, 'utf8');
	var data = JSON.parse(content);
	return parseJSON(season, data);
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
	
	// Sort by timestamp (newest first)
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
		var filepath = path.join(FANTRAX_DIR, 'transactions-' + year + '.json');
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
	
	return transactions.filter(function(tx) {
		return types.indexOf(tx.type) >= 0;
	});
}

/**
 * Get waiver transactions (claim + drop).
 * 
 * @param {Array} transactions - Array of transaction facts
 * @returns {Array} Waiver transactions only
 */
function getWaivers(transactions) {
	return filterByType(transactions, 'waiver');
}

/**
 * Get standalone claims only.
 * 
 * @param {Array} transactions - Array of transaction facts
 * @returns {Array} Claim-only transactions
 */
function getClaims(transactions) {
	return filterByType(transactions, 'claim');
}

/**
 * Get standalone drops only.
 * 
 * @param {Array} transactions - Array of transaction facts
 * @returns {Array} Drop-only transactions
 */
function getDrops(transactions) {
	return filterByType(transactions, 'drop');
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
 * An add followed shortly by a drop of the same player could be a rollback.
 * 
 * @param {Array} transactions - Array of transaction facts
 * @param {object} options - { maxHours: 48 }
 * @returns {Array} Array of suspicious transaction pairs
 */
function findSuspiciousTransactions(transactions, options) {
	options = options || { maxHours: 48 };
	var suspicious = [];
	
	// Sort by timestamp ascending
	var sorted = transactions.slice().sort(function(a, b) {
		if (!a.timestamp) return 1;
		if (!b.timestamp) return -1;
		return a.timestamp - b.timestamp;
	});
	
	// Look for add-then-drop of same player by same owner within short time
	sorted.forEach(function(tx, i) {
		if (!tx.adds || tx.adds.length === 0) return;
		
		tx.adds.forEach(function(add) {
			// Look ahead for matching drop
			for (var j = i + 1; j < sorted.length && j < i + 50; j++) {
				var other = sorted[j];
				if (!other.drops) continue;
				if (other.owner !== tx.owner) continue;
				
				var matchingDrop = other.drops.find(function(d) {
					return d.playerName === add.playerName;
				});
				
				if (matchingDrop && tx.timestamp && other.timestamp) {
					var hours = (other.timestamp - tx.timestamp) / (1000 * 60 * 60);
					if (hours >= 0 && hours < options.maxHours) {
						suspicious.push({
							type: 'quick-turnaround',
							player: add.playerName,
							playerId: add.playerId,
							addTransaction: tx,
							dropTransaction: other,
							hours: Math.round(hours)
						});
						break;
					}
				}
			}
		});
	});
	
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
	var totalAdds = 0;
	var totalDrops = 0;
	
	transactions.forEach(function(tx) {
		byType[tx.type] = (byType[tx.type] || 0) + 1;
		bySeason[tx.season] = (bySeason[tx.season] || 0) + 1;
		if (tx.owner) {
			byOwner[tx.owner] = (byOwner[tx.owner] || 0) + 1;
		} else {
			unknownOwner++;
		}
		totalAdds += tx.adds ? tx.adds.length : 0;
		totalDrops += tx.drops ? tx.drops.length : 0;
	});
	
	return {
		total: transactions.length,
		totalAdds: totalAdds,
		totalDrops: totalDrops,
		byType: byType,
		bySeason: bySeason,
		byOwner: byOwner,
		unknownOwner: unknownOwner,
		seasons: Object.keys(bySeason).sort()
	};
}

module.exports = {
	// Constants
	faabOpenDates: faabOpenDates,
	
	// Core parsing
	parseJSON: parseJSON,
	parseRow: parseRow,
	groupByTxSetId: groupByTxSetId,
	parseDate: parseDate,
	extractOwner: extractOwner,
	getCellValue: getCellValue,
	
	// Loading
	loadSeason: loadSeason,
	loadAll: loadAll,
	checkAvailability: checkAvailability,
	
	// Filtering
	filterByType: filterByType,
	getWaivers: getWaivers,
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
