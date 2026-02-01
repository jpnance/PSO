/**
 * Contract Term Inference Engine
 * 
 * Infers startYear and endYear from a contract string and context.
 * Returns confidence level: 'certain', 'inferred', or 'ambiguous'.
 * 
 * This is the core inference logic extracted and enhanced from trades.js.
 */

// Auction dates per season (when contracts for that season are signed)
var auctionDates = {
	2008: new Date('2008-08-18'), 2009: new Date('2009-08-16'), 2010: new Date('2010-08-22'),
	2011: new Date('2011-08-20'), 2012: new Date('2012-08-25'), 2013: new Date('2013-08-24'),
	2014: new Date('2014-08-23'), 2015: new Date('2015-08-29'), 2016: new Date('2016-08-20'),
	2017: new Date('2017-08-19'), 2018: new Date('2018-08-25'), 2019: new Date('2019-08-24'),
	2020: new Date('2020-08-29'), 2021: new Date('2021-08-28'), 2022: new Date('2022-08-27'),
	2023: new Date('2023-08-26'), 2024: new Date('2024-08-24'), 2025: new Date('2025-08-23')
};

// Contract due dates per season
var contractDueDates = {
	2008: new Date('2008-08-24'), 2009: new Date('2009-09-02'), 2010: new Date('2010-08-31'),
	2011: new Date('2011-08-26'), 2012: new Date('2012-09-01'), 2013: new Date('2013-08-31'),
	2014: new Date('2014-08-31'), 2015: new Date('2015-09-05'), 2016: new Date('2016-08-28'),
	2017: new Date('2017-08-27'), 2018: new Date('2018-09-01'), 2019: new Date('2019-09-01'),
	2020: new Date('2020-09-07'), 2021: new Date('2021-09-06'), 2022: new Date('2022-09-05'),
	2023: new Date('2023-09-04'), 2024: new Date('2024-09-02'), 2025: new Date('2025-09-01')
};

// NFL season start dates
var seasonStartDates = {
	2008: new Date('2008-09-04'), 2009: new Date('2009-09-10'), 2010: new Date('2010-09-09'),
	2011: new Date('2011-09-08'), 2012: new Date('2012-09-05'), 2013: new Date('2013-09-05'),
	2014: new Date('2014-09-04'), 2015: new Date('2015-09-10'), 2016: new Date('2016-09-08'),
	2017: new Date('2017-09-07'), 2018: new Date('2018-09-06'), 2019: new Date('2019-09-05'),
	2020: new Date('2020-09-10'), 2021: new Date('2021-09-09'), 2022: new Date('2022-09-08'),
	2023: new Date('2023-09-07'), 2024: new Date('2024-09-05'), 2025: new Date('2025-09-04')
};

/**
 * Confidence levels for inferred values.
 */
var Confidence = {
	CERTAIN: 'certain',      // Explicitly stated in source data
	INFERRED: 'inferred',    // Single valid solution from constraints
	AMBIGUOUS: 'ambiguous'   // Multiple valid solutions possible
};

/**
 * Get the "season year" for a given date.
 * A transaction before this year's auction is in the previous season.
 * 
 * @param {Date} date - The transaction date
 * @returns {number} The season year
 */
function getSeasonYear(date) {
	var calendarYear = date.getFullYear();
	var auctionDate = auctionDates[calendarYear];
	
	// If date is before this year's auction, it's in the previous season
	if (auctionDate && date < auctionDate) {
		return calendarYear - 1;
	}
	return calendarYear;
}

/**
 * Parse a contract string and infer term.
 * 
 * @param {string} contractStr - The raw contract string (e.g., "2019", "19/21", "FA", "2021-R")
 * @param {object} context - Context for inference
 * @param {Date} context.date - Date of the transaction
 * @param {number} context.salary - Player's salary (optional)
 * @param {number} context.draftYear - Player's draft year if known (optional)
 * @returns {object} { startYear, endYear, confidence, reason }
 */
function parseContractString(contractStr, context) {
	var result = {
		startYear: null,
		endYear: null,
		confidence: Confidence.AMBIGUOUS,
		reason: null
	};
	
	if (!contractStr) {
		result.reason = 'No contract string provided';
		return result;
	}
	
	contractStr = contractStr.trim();
	context = context || {};
	
	var date = context.date || new Date();
	var seasonYear = getSeasonYear(date);
	var dueDate = contractDueDates[seasonYear] || new Date(seasonYear + '-08-21');
	var isBeforeContractsDue = date < dueDate;
	
	// === Pattern: FA/unsigned/franchise (no contract) ===
	var lowerContract = contractStr.toLowerCase();
	if (lowerContract === 'fa' || lowerContract === 'unsigned' || lowerContract === 'franchise') {
		result.reason = 'Explicitly marked as ' + contractStr;
		return result;
	}
	
	// === Pattern: Year range with slash "2019/21" or "2019/2021" or "19/21" ===
	var rangeMatch = contractStr.match(/^(\d{2,4})\/(\d{2,4})$/);
	if (rangeMatch) {
		var startStr = rangeMatch[1];
		var endStr = rangeMatch[2];
		result.startYear = startStr.length === 2 ? parseInt('20' + startStr) : parseInt(startStr);
		result.endYear = endStr.length === 2 ? parseInt('20' + endStr) : parseInt(endStr);
		result.confidence = Confidence.CERTAIN;
		result.reason = 'Explicit range notation';
		return result;
	}
	
	// === Pattern: FA/year range "FA/21" or "FA/2021" ===
	var faRangeMatch = contractStr.match(/^FA\/(\d{2,4})$/i);
	if (faRangeMatch) {
		var endStr = faRangeMatch[1];
		result.startYear = null; // FA pickup, unknown start
		result.endYear = endStr.length === 2 ? parseInt('20' + endStr) : parseInt(endStr);
		result.confidence = Confidence.CERTAIN;
		result.reason = 'Explicit FA notation with end year';
		return result;
	}
	
	// === Pattern: Year with dash range "2019-2021" ===
	var dashRangeMatch = contractStr.match(/^(\d{4})-(\d{4})$/);
	if (dashRangeMatch) {
		result.startYear = parseInt(dashRangeMatch[1]);
		result.endYear = parseInt(dashRangeMatch[2]);
		result.confidence = Confidence.CERTAIN;
		result.reason = 'Explicit dash range notation';
		return result;
	}
	
	// === Pattern: Single year with -R suffix "2021-R" (RFA = multi-year) ===
	var yearRMatch = contractStr.match(/^(\d{2,4})-R$/i);
	if (yearRMatch) {
		var yearStr = yearRMatch[1];
		var endYear = yearStr.length === 2 ? parseInt('20' + yearStr) : parseInt(yearStr);
		result.endYear = endYear;
		
		// -R means RFA, which means multi-year contract
		// Apply heuristics based on timing
		if (seasonYear === 2008 && endYear > 2008) {
			result.startYear = 2008;
			result.confidence = Confidence.INFERRED;
			result.reason = 'RFA in inaugural season, must start 2008';
		} else if (seasonYear <= endYear - 2) {
			result.startYear = endYear - 2;
			result.confidence = Confidence.INFERRED;
			result.reason = 'Trade 2+ years before end, assume 3-year contract';
		} else if (seasonYear === endYear - 1 && isBeforeContractsDue) {
			result.startYear = endYear - 2;
			result.confidence = Confidence.INFERRED;
			result.reason = 'Trade 1 year before end, pre-contract due, assume 3-year';
		} else {
			result.startYear = Math.min(seasonYear, endYear);
			result.confidence = Confidence.AMBIGUOUS;
			result.reason = 'RFA suffix but timing ambiguous';
		}
		return result;
	}
	
	// === Pattern: Single year with -U suffix "2021-U" (UFA) ===
	var yearUMatch = contractStr.match(/^(\d{2,4})-U$/i);
	if (yearUMatch) {
		var yearStr = yearUMatch[1];
		var endYear = yearStr.length === 2 ? parseInt('20' + yearStr) : parseInt(yearStr);
		result.endYear = endYear;
		result.startYear = Math.min(seasonYear, endYear);
		result.confidence = Confidence.AMBIGUOUS;
		result.reason = 'UFA suffix, contract length unknown';
		return result;
	}
	
	// === Pattern: Single year "2019" or "19" ===
	var singleYearMatch = contractStr.match(/^(\d{2,4})$/);
	if (singleYearMatch) {
		var yearStr = singleYearMatch[1];
		var endYear = yearStr.length === 2 ? parseInt('20' + yearStr) : parseInt(yearStr);
		result.endYear = endYear;
		
		// Apply date-based heuristics
		if (seasonYear === 2008 && endYear > 2008) {
			result.startYear = 2008;
			result.confidence = Confidence.INFERRED;
			result.reason = 'Inaugural season, contract must start 2008';
		} else if (seasonYear <= endYear - 2) {
			result.startYear = endYear - 2;
			result.confidence = Confidence.INFERRED;
			result.reason = 'Trade 2+ years before end, must be 3-year contract';
		} else if (seasonYear === endYear - 1 && isBeforeContractsDue) {
			result.startYear = endYear - 2;
			result.confidence = Confidence.INFERRED;
			result.reason = 'Trade 1 year before end, pre-contract due';
		} else if (seasonYear === 2009 && endYear === 2009 && isBeforeContractsDue) {
			result.startYear = 2008;
			result.confidence = Confidence.INFERRED;
			result.reason = 'Early 2009, contract from inaugural season';
		} else {
			result.startYear = Math.min(seasonYear, endYear);
			result.confidence = Confidence.AMBIGUOUS;
			result.reason = 'Single year, could be 1/2/3 year or FA';
		}
		
		return result;
	}
	
	// Unknown format
	result.reason = 'Unrecognized contract format: ' + contractStr;
	return result;
}

/**
 * Enhance inference using snapshot data.
 * If we have a snapshot showing the player with explicit contract terms,
 * we can improve confidence.
 * 
 * @param {object} inference - Result from parseContractString
 * @param {string} playerName - Player's name
 * @param {Array} snapshotFacts - All snapshot facts
 * @returns {object} Enhanced inference with potentially better confidence
 */
function enhanceWithSnapshots(inference, playerName, snapshotFacts) {
	if (inference.confidence === Confidence.CERTAIN) {
		return inference;
	}
	
	if (!snapshotFacts || snapshotFacts.length === 0) {
		return inference;
	}
	
	// Normalize player name for matching
	var normalizedName = playerName.toLowerCase().replace(/[^a-z]/g, '');
	
	// Find matching snapshots
	var matches = snapshotFacts.filter(function(s) {
		var snapshotName = s.playerName.toLowerCase().replace(/[^a-z]/g, '');
		return snapshotName === normalizedName;
	});
	
	if (matches.length === 0) {
		return inference;
	}
	
	// If we have an endYear, look for a snapshot that confirms the contract
	if (inference.endYear) {
		var confirming = matches.find(function(s) {
			return s.endYear === inference.endYear;
		});
		
		if (confirming && confirming.startYear !== null) {
			// Snapshot has explicit start year
			return {
				startYear: confirming.startYear,
				endYear: confirming.endYear,
				confidence: Confidence.CERTAIN,
				reason: 'Confirmed by ' + confirming.season + ' snapshot'
			};
		}
	}
	
	return inference;
}

/**
 * Enhance inference using draft records.
 * If player was drafted in our league and timing is consistent,
 * we can infer this is their rookie contract.
 * 
 * @param {object} inference - Result from parseContractString
 * @param {string} playerName - Player's name
 * @param {number} salary - Player's salary
 * @param {Date} transactionDate - Date of transaction
 * @param {Array} draftFacts - Draft facts
 * @returns {object} Enhanced inference
 */
function enhanceWithDraft(inference, playerName, salary, transactionDate, draftFacts) {
	if (inference.confidence === Confidence.CERTAIN) {
		return inference;
	}
	
	if (!draftFacts || draftFacts.length === 0 || !inference.endYear) {
		return inference;
	}
	
	// Normalize player name
	var normalizedName = playerName.toLowerCase().replace(/[^a-z]/g, '');
	
	// Find draft record
	var draftRecord = draftFacts.find(function(d) {
		var draftName = d.playerName.toLowerCase().replace(/[^a-z]/g, '');
		return draftName === normalizedName;
	});
	
	if (!draftRecord) {
		return inference;
	}
	
	var draftYear = draftRecord.season;
	var yearsFromDraft = inference.endYear - draftYear;
	
	// Rookie contracts end 0-2 years after draft
	if (yearsFromDraft >= 0 && yearsFromDraft <= 2) {
		// Check timing: is this consistent with a rookie deal?
		var tradeYear = transactionDate.getFullYear();
		var seasonStart = seasonStartDates[tradeYear] || new Date(tradeYear + '-09-07');
		var daysFromSeasonStart = Math.round((transactionDate - seasonStart) / (1000 * 60 * 60 * 24));
		
		var isHighConfidence = false;
		if (daysFromSeasonStart < 28) {
			// Pre-season or early season
			isHighConfidence = true;
		} else if (daysFromSeasonStart < 84 && salary >= 5) {
			// Mid-season with meaningful salary
			isHighConfidence = true;
		}
		
		if (isHighConfidence) {
			return {
				startYear: draftYear,
				endYear: inference.endYear,
				confidence: Confidence.INFERRED,
				reason: 'Rookie contract from ' + draftYear + ' draft'
			};
		}
	}
	
	return inference;
}

/**
 * Full inference pipeline: parse contract string and enhance with context.
 * 
 * @param {string} contractStr - Raw contract string
 * @param {object} context - Context object
 * @param {Date} context.date - Transaction date
 * @param {string} context.playerName - Player name
 * @param {number} context.salary - Player salary (optional)
 * @param {Array} context.snapshots - Snapshot facts (optional)
 * @param {Array} context.drafts - Draft facts (optional)
 * @returns {object} { startYear, endYear, confidence, reason }
 */
function infer(contractStr, context) {
	context = context || {};
	
	// Step 1: Parse the contract string
	var result = parseContractString(contractStr, {
		date: context.date,
		salary: context.salary
	});
	
	// Step 2: Enhance with snapshot data
	if (context.playerName && context.snapshots) {
		result = enhanceWithSnapshots(result, context.playerName, context.snapshots);
	}
	
	// Step 3: Enhance with draft data
	if (context.playerName && context.drafts && context.date) {
		result = enhanceWithDraft(
			result, 
			context.playerName, 
			context.salary || 0,
			context.date,
			context.drafts
		);
	}
	
	return result;
}

/**
 * Batch infer contract terms for all players in trade facts.
 * 
 * @param {Array} tradeFacts - Trade facts with raw contract strings
 * @param {object} context - Context with snapshots and drafts
 * @returns {Array} Trade facts with inferred contract terms added
 */
function inferTradeContracts(tradeFacts, context) {
	context = context || {};
	
	return tradeFacts.map(function(trade) {
		var enhancedParties = trade.parties.map(function(party) {
			var enhancedPlayers = party.players.map(function(player) {
				var inference = infer(player.contractStr, {
					date: trade.date,
					playerName: player.name,
					salary: player.salary,
					snapshots: context.snapshots,
					drafts: context.drafts
				});
				
				return Object.assign({}, player, {
					inferredStartYear: inference.startYear,
					inferredEndYear: inference.endYear,
					confidence: inference.confidence,
					inferenceReason: inference.reason
				});
			});
			
			return Object.assign({}, party, { players: enhancedPlayers });
		});
		
		return Object.assign({}, trade, { parties: enhancedParties });
	});
}

/**
 * Get statistics about inference confidence across trades.
 * 
 * @param {Array} enhancedTrades - Trades with inferred contracts
 * @returns {object} Statistics
 */
function getInferenceStats(enhancedTrades) {
	var stats = {
		total: 0,
		certain: 0,
		inferred: 0,
		ambiguous: 0,
		byReason: {}
	};
	
	enhancedTrades.forEach(function(trade) {
		trade.parties.forEach(function(party) {
			party.players.forEach(function(player) {
				stats.total++;
				
				if (player.confidence === Confidence.CERTAIN) stats.certain++;
				else if (player.confidence === Confidence.INFERRED) stats.inferred++;
				else stats.ambiguous++;
				
				var reason = player.inferenceReason || 'unknown';
				stats.byReason[reason] = (stats.byReason[reason] || 0) + 1;
			});
		});
	});
	
	return stats;
}

module.exports = {
	// Constants
	Confidence: Confidence,
	
	// Core functions
	getSeasonYear: getSeasonYear,
	parseContractString: parseContractString,
	enhanceWithSnapshots: enhanceWithSnapshots,
	enhanceWithDraft: enhanceWithDraft,
	
	// High-level API
	infer: infer,
	inferTradeContracts: inferTradeContracts,
	getInferenceStats: getInferenceStats
};
