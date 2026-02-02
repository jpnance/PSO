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
		return 'Luke'; // Cap'n Geech was Syed's team name, but Luke took over in 2020
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
		// Parse "Dec 23, 2020, 8:05PM" or "Dec 23, 2020, 8:05:30 PM" (with seconds)
		var match = cleaned.match(/([A-Za-z]+)\s+(\d+),\s+(\d+),\s+(\d+):(\d+)(?::\d+)?\s*(AM|PM)/i);
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
 * Parse the actual processed date from a toolTip string.
 * Format: "<b>Processed</b> Thu Dec 10, 2020, 12:43:59 PM<br/><b>Created</b>..."
 * 
 * @param {string} toolTip - HTML tooltip string
 * @returns {Date|null} Parsed processed date or null
 */
function parseProcessedDate(toolTip) {
	if (!toolTip) return null;
	
	// Extract the processed date from the HTML
	var match = toolTip.match(/<b>Processed<\/b>\s*([^<]+)/i);
	if (!match) return null;
	
	return parseDate(match[1].trim());
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
 * Extract cell object by key from a row's cells array.
 * 
 * @param {Array} cells - Array of cell objects
 * @param {string} key - Cell key to find
 * @returns {object|null} Cell object or null
 */
function getCell(cells, key) {
	if (!cells) return null;
	return cells.find(function(c) { return c.key === key; }) || null;
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
	
	// Check for commissioner execution and get actual processed date
	var dateCell = getCell(cells, 'date');
	var isCommissioner = dateCell && dateCell.icon === 'COMMISSIONER';
	var commissionerNote = dateCell ? dateCell.iconToolTip : null;
	
	// For commissioner actions, use the actual processed date from toolTip
	// (the content date is often backdated to game lock time)
	var dateStr = dateCell ? dateCell.content : null;
	var processedDate = null;
	if (isCommissioner && dateCell && dateCell.toolTip) {
		processedDate = parseProcessedDate(dateCell.toolTip);
	}
	
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
		dateStr: dateStr,
		processedDate: processedDate,  // Actual date for commissioner actions
		isCommissioner: isCommissioner,
		commissionerNote: commissionerNote,
		
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
		var isCommissioner = false;
		var commissionerNote = null;
		
		group.forEach(function(row) {
			// Collect common transaction info from any row
			// For commissioner actions, prefer the actual processedDate over the backdated content
			if (!timestamp) {
				if (row.processedDate) {
					timestamp = row.processedDate;
				} else if (row.dateStr) {
					timestamp = parseDate(row.dateStr);
				}
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
			if (row.isCommissioner) {
				isCommissioner = true;
				commissionerNote = row.commissionerNote;
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
			isCommissioner: isCommissioner,
			commissionerNote: commissionerNote,
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
 * A rollback is: owner claim followed by commissioner drop of the same player.
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
	
	// Look for owner add followed by commissioner drop of same player
	sorted.forEach(function(tx, i) {
		if (!tx.adds || tx.adds.length === 0) return;
		// Skip if the add was commissioner-executed (not an owner action)
		if (tx.isCommissioner) return;
		
		tx.adds.forEach(function(add) {
			// Look ahead for matching commissioner drop
			for (var j = i + 1; j < sorted.length && j < i + 50; j++) {
				var other = sorted[j];
				if (!other.drops) continue;
				if (other.owner !== tx.owner) continue;
				// Must be a commissioner action to count as rollback
				if (!other.isCommissioner) continue;
				
				var matchingDrop = other.drops.find(function(d) {
					return d.playerName === add.playerName;
				});
				
				if (matchingDrop && tx.timestamp && other.timestamp) {
					var hours = (other.timestamp - tx.timestamp) / (1000 * 60 * 60);
					if (hours >= 0 && hours < options.maxHours) {
						suspicious.push({
							type: 'rollback',
							player: add.playerName,
							playerId: add.playerId,
							positions: add.positions,
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
 * Confidence levels for flagged commissioner actions.
 */
var Confidence = {
	ROLLBACK_LIKELY: 'rollback_likely',           // Owner add followed by commissioner drop within 72h
	REVERSAL_PAIR: 'reversal_pair',               // Commissioner drop + add within 5 minutes (swap)
	TRADE_FACILITATION: 'trade_facilitation',     // Roster was involved in a trade within 72h
	MANUAL_ASSIST: 'manual_assist',               // Standalone action, no recent owner activity
	UNKNOWN: 'unknown'                            // Has context but doesn't fit other patterns
};

/**
 * Load trades for a specific season.
 * 
 * @param {number} season - Season year (e.g., 2020)
 * @returns {Array} Array of parsed trade facts
 */
function loadTrades(season) {
	var filePath = path.join(FANTRAX_DIR, 'trades-' + season + '.json');
	
	if (!fs.existsSync(filePath)) {
		return [];
	}
	
	var raw = fs.readFileSync(filePath, 'utf8');
	var data = JSON.parse(raw);
	
	// Extract rows from XHR response
	var rows = [];
	if (data.responses && data.responses[0] && data.responses[0].data && data.responses[0].data.table) {
		rows = data.responses[0].data.table.rows || [];
	}
	
	// Group by txSetId
	var groups = {};
	rows.forEach(function(row) {
		var txSetId = row.txSetId;
		if (!groups[txSetId]) {
			groups[txSetId] = [];
		}
		groups[txSetId].push(row);
	});
	
	// Parse each trade group
	var trades = [];
	Object.keys(groups).forEach(function(txSetId) {
		var group = groups[txSetId];
		var timestamp = null;
		var processedDate = null;
		var week = null;
		var parties = {};  // owner -> { sends: [], receives: [] }
		
		group.forEach(function(row) {
			var fromCell = getCell(row.cells, 'from');
			var toCell = getCell(row.cells, 'to');
			var dateCell = getCell(row.cells, 'date');
			var weekCell = getCell(row.cells, 'week');
			
			// Get timestamp from first row with date
			if (!timestamp && dateCell && dateCell.content && dateCell.content.length > 5) {
				timestamp = parseDate(dateCell.content);
				if (dateCell.toolTip) {
					processedDate = parseProcessedDate(dateCell.toolTip);
				}
			}
			
			if (!week && weekCell) {
				week = parseInt(weekCell.content, 10) || null;
			}
			
			var fromOwner = fromCell ? extractOwner(fromCell.content) : null;
			var toOwner = toCell ? extractOwner(toCell.content) : null;
			var fromTeamId = fromCell ? fromCell.teamId : null;
			var toTeamId = toCell ? toCell.teamId : null;
			
			var player = {
				playerId: row.scorer ? row.scorer.scorerId : null,
				playerName: row.scorer ? row.scorer.name : null,
				positions: row.scorer ? row.scorer.posShortNames : null
			};
			
			// Track what each owner sends/receives
			if (fromOwner) {
				if (!parties[fromOwner]) {
					parties[fromOwner] = { sends: [], receives: [], teamId: fromTeamId };
				}
				parties[fromOwner].sends.push(player);
			}
			if (toOwner) {
				if (!parties[toOwner]) {
					parties[toOwner] = { sends: [], receives: [], teamId: toTeamId };
				}
				parties[toOwner].receives.push(player);
			}
		});
		
		trades.push({
			transactionId: txSetId,
			type: 'trade',
			season: season,
			timestamp: processedDate || timestamp,
			week: week,
			parties: parties,
			owners: Object.keys(parties)
		});
	});
	
	return trades;
}

/**
 * Load all trades from all available seasons.
 * 
 * @returns {Array} Array of all trade facts
 */
function loadAllTrades() {
	var allTrades = [];
	[2020, 2021].forEach(function(season) {
		allTrades = allTrades.concat(loadTrades(season));
	});
	return allTrades;
}

/**
 * Find all in-season commissioner transactions with confidence indicators.
 * Every commissioner action during the season is flagged in Fantrax.
 * 
 * @param {Array} transactions - Array of transaction facts
 * @param {Array} [trades] - Optional array of trade facts (loaded automatically if not provided)
 * @returns {Array} Array of flagged commissioner actions with confidence
 */
function findCommissionerActions(transactions, trades) {
	var WINDOW_HOURS = 72;
	
	// Load trades if not provided
	if (!trades) {
		trades = loadAllTrades();
	}
	
	// Filter to real FAAB (in-season) and commissioner actions
	var inSeason = filterRealFaab(transactions);
	var commissionerTxs = inSeason.filter(function(tx) {
		return tx.isCommissioner;
	});
	
	// Sort all non-commissioner transactions by timestamp for context lookup
	var sorted = inSeason.filter(function(tx) {
		return !tx.isCommissioner;
	}).sort(function(a, b) {
		if (!a.timestamp) return 1;
		if (!b.timestamp) return -1;
		return a.timestamp - b.timestamp;
	});
	
	// For each commissioner transaction, find context and assign confidence
	return commissionerTxs.map(function(tx) {
		var affectedPlayers = [];
		
		// Collect all players in this transaction
		(tx.adds || []).forEach(function(p) {
			affectedPlayers.push({ name: p.playerName, id: p.playerId, positions: p.positions, action: 'add' });
		});
		(tx.drops || []).forEach(function(p) {
			affectedPlayers.push({ name: p.playerName, id: p.playerId, positions: p.positions, action: 'drop' });
		});
		
		// Find recent transactions for each affected player (within 72h window)
		var context = affectedPlayers.map(function(player) {
			var recentTxs = sorted.filter(function(otherTx) {
				if (otherTx.transactionId === tx.transactionId) return false;
				if (!otherTx.timestamp || !tx.timestamp) return false;
				var hoursDiff = (tx.timestamp - otherTx.timestamp) / (1000 * 60 * 60);
				if (hoursDiff < 0 || hoursDiff > WINDOW_HOURS) return false;
				
				var inAdds = (otherTx.adds || []).some(function(p) { return p.playerName === player.name; });
				var inDrops = (otherTx.drops || []).some(function(p) { return p.playerName === player.name; });
				return inAdds || inDrops;
			});
			
			return {
				player: player.name,
				playerId: player.id,
				positions: player.positions,
				commissionerAction: player.action,
				recentTransactions: recentTxs.map(function(t) {
					var playerAction = null;
					if ((t.adds || []).some(function(p) { return p.playerName === player.name; })) {
						playerAction = 'added';
					} else if ((t.drops || []).some(function(p) { return p.playerName === player.name; })) {
						playerAction = 'dropped';
					}
					var hoursDiff = Math.round((tx.timestamp - t.timestamp) / (1000 * 60 * 60));
					return {
						transactionId: t.transactionId,
						timestamp: t.timestamp,
						owner: t.owner,
						playerAction: playerAction,
						isCommissioner: t.isCommissioner,
						hoursAgo: hoursDiff
					};
				})
			};
		});
		
		// Determine confidence level
		var owner = tx.owner;
		var confidence = Confidence.UNKNOWN;
		var confidenceReason = null;
		
		// Check for reversal pair (commissioner actions within 5 minutes for same owner)
		var hasMatchingSwap = commissionerTxs.some(function(other) {
			if (other.transactionId === tx.transactionId) return false;
			if (other.owner !== owner) return false;
			
			var timeDiff = Math.abs(tx.timestamp - other.timestamp) / (1000 * 60);
			if (timeDiff > 5) return false;
			
			// Complementary actions (one adds, other drops)
			var thisHasAdds = tx.adds && tx.adds.length > 0 && (!tx.drops || tx.drops.length === 0);
			var thisHasDrops = tx.drops && tx.drops.length > 0 && (!tx.adds || tx.adds.length === 0);
			var otherHasAdds = other.adds && other.adds.length > 0 && (!other.drops || other.drops.length === 0);
			var otherHasDrops = other.drops && other.drops.length > 0 && (!other.adds || other.adds.length === 0);
			
			return (thisHasAdds && otherHasDrops) || (thisHasDrops && otherHasAdds);
		});
		
		if (hasMatchingSwap) {
			confidence = Confidence.REVERSAL_PAIR;
			confidenceReason = 'Commissioner add and drop at same time (swap/rollback)';
		} else {
			// Check for rollback pattern: owner action reversed by commissioner
			var hasReversalPattern = context.some(function(c) {
				return c.recentTransactions.some(function(t) {
					if (t.isCommissioner) return false;
					if (c.commissionerAction === 'drop' && t.playerAction === 'added') return true;
					if (c.commissionerAction === 'add' && t.playerAction === 'dropped') return true;
					return false;
				});
			});
			
			if (hasReversalPattern) {
				confidence = Confidence.ROLLBACK_LIKELY;
				confidenceReason = 'Owner transaction reversed by commissioner';
			} else {
				// Check for trade facilitation: was this owner in a trade within 72h before or 24h after?
				var FORWARD_WINDOW_HOURS = 24;
				var recentTrade = trades.find(function(trade) {
					if (!trade.timestamp || !tx.timestamp) return false;
					var hoursDiff = (tx.timestamp - trade.timestamp) / (1000 * 60 * 60);
					if (hoursDiff < -FORWARD_WINDOW_HOURS || hoursDiff > WINDOW_HOURS) return false;
					return trade.owners.indexOf(owner) >= 0;
				});
				
				if (recentTrade) {
					confidence = Confidence.TRADE_FACILITATION;
					confidenceReason = 'Owner was involved in a trade within 72h';
				} else if (context.every(function(c) { return c.recentTransactions.length === 0; })) {
					confidence = Confidence.MANUAL_ASSIST;
					confidenceReason = 'No recent owner activity for affected players';
				}
			}
		}
		
		return {
			transactionId: tx.transactionId,
			timestamp: tx.timestamp,
			owner: tx.owner,
			franchiseTeamId: tx.franchiseTeamId,
			commissionerNote: tx.commissionerNote,
			adds: tx.adds,
			drops: tx.drops,
			context: context,
			confidence: confidence,
			confidenceReason: confidenceReason
		};
	});
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
	Confidence: Confidence,
	
	// Core parsing
	parseJSON: parseJSON,
	parseRow: parseRow,
	groupByTxSetId: groupByTxSetId,
	parseDate: parseDate,
	parseProcessedDate: parseProcessedDate,
	extractOwner: extractOwner,
	getCellValue: getCellValue,
	getCell: getCell,
	
	// Loading
	loadSeason: loadSeason,
	loadAll: loadAll,
	loadTrades: loadTrades,
	loadAllTrades: loadAllTrades,
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
	findCommissionerActions: findCommissionerActions,
	getSummary: getSummary
};
