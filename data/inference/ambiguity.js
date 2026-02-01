/**
 * Ambiguity Tracking and Resolution
 * 
 * Tracks ambiguous inferences, stores resolutions, and validates
 * that resolutions are consistent with constraints.
 */

var fs = require('fs');
var path = require('path');

var RESOLUTIONS_PATH = path.join(__dirname, '../config/inferred-resolutions.json');

// In-memory cache of resolutions
var resolutions = null;

/**
 * Ambiguity types we track.
 */
var AmbiguityType = {
	CONTRACT_TERM: 'contractTerm',
	PLAYER_IDENTITY: 'playerIdentity',
	TRANSACTION_TIMING: 'transactionTiming',
	FA_TRANSACTION: 'faTransaction'
};

/**
 * Load resolutions from disk.
 * 
 * @returns {object} Resolutions object
 */
function loadResolutions() {
	if (resolutions !== null) {
		return resolutions;
	}
	
	try {
		if (fs.existsSync(RESOLUTIONS_PATH)) {
			var content = fs.readFileSync(RESOLUTIONS_PATH, 'utf8');
			resolutions = JSON.parse(content);
		} else {
			resolutions = {
				contractTerms: [],
				playerIdentities: [],
				transactionTimings: [],
				faTransactions: [],
				_meta: {
					version: 1,
					lastModified: new Date().toISOString()
				}
			};
		}
	} catch (err) {
		console.error('Error loading resolutions:', err.message);
		resolutions = { contractTerms: [], playerIdentities: [], transactionTimings: [], faTransactions: [], _meta: { version: 1 } };
	}
	
	return resolutions;
}

/**
 * Save resolutions to disk.
 */
function saveResolutions() {
	if (resolutions === null) {
		return;
	}
	
	resolutions._meta = resolutions._meta || {};
	resolutions._meta.lastModified = new Date().toISOString();
	
	var content = JSON.stringify(resolutions, null, '\t');
	fs.writeFileSync(RESOLUTIONS_PATH, content, 'utf8');
}

/**
 * Clear cached resolutions (for testing).
 */
function clearCache() {
	resolutions = null;
}

// ============================================================
// Contract Term Resolutions
// ============================================================

/**
 * Get a contract term resolution if one exists.
 * 
 * @param {object} query - { playerName, tradeId } or similar
 * @returns {object|null} Resolution if found
 */
function getContractTermResolution(query) {
	var res = loadResolutions();
	
	return res.contractTerms.find(function(r) {
		// Match by player + tradeId
		if (query.tradeId !== undefined && r.tradeId !== undefined) {
			return r.player.toLowerCase() === query.playerName.toLowerCase() &&
			       r.tradeId === query.tradeId;
		}
		// Match by player + season
		if (query.season !== undefined && r.season !== undefined) {
			return r.player.toLowerCase() === query.playerName.toLowerCase() &&
			       r.season === query.season;
		}
		return false;
	});
}

/**
 * Add or update a contract term resolution.
 * 
 * @param {object} resolution - The resolution to add
 * @param {string} resolution.player - Player name
 * @param {number} resolution.tradeId - Trade ID (optional)
 * @param {number} resolution.season - Season (optional)
 * @param {number} resolution.startYear - Resolved start year
 * @param {number} resolution.endYear - Resolved end year
 * @param {string} resolution.reason - Human-readable reason
 */
function addContractTermResolution(resolution) {
	var res = loadResolutions();
	
	// Check if already exists and update
	var existing = res.contractTerms.findIndex(function(r) {
		if (resolution.tradeId !== undefined && r.tradeId !== undefined) {
			return r.player.toLowerCase() === resolution.player.toLowerCase() &&
			       r.tradeId === resolution.tradeId;
		}
		return false;
	});
	
	if (existing >= 0) {
		res.contractTerms[existing] = resolution;
	} else {
		res.contractTerms.push(resolution);
	}
	
	saveResolutions();
}

/**
 * Remove a contract term resolution.
 * 
 * @param {object} query - { playerName, tradeId }
 * @returns {boolean} True if removed
 */
function removeContractTermResolution(query) {
	var res = loadResolutions();
	
	var idx = res.contractTerms.findIndex(function(r) {
		if (query.tradeId !== undefined) {
			return r.player.toLowerCase() === query.playerName.toLowerCase() &&
			       r.tradeId === query.tradeId;
		}
		return false;
	});
	
	if (idx >= 0) {
		res.contractTerms.splice(idx, 1);
		saveResolutions();
		return true;
	}
	
	return false;
}

// ============================================================
// Ambiguity Tracking
// ============================================================

/**
 * An ambiguity record.
 */
function Ambiguity(type, context, possibleValues, reason) {
	this.type = type;
	this.context = context;
	this.possibleValues = possibleValues;
	this.reason = reason;
	this.timestamp = new Date();
}

/**
 * Collector for ambiguities during processing.
 */
function AmbiguityCollector() {
	this.items = [];
}

AmbiguityCollector.prototype.add = function(type, context, possibleValues, reason) {
	this.items.push(new Ambiguity(type, context, possibleValues, reason));
};

AmbiguityCollector.prototype.addContractTerm = function(playerName, tradeId, date, possibleTerms, reason) {
	this.add(AmbiguityType.CONTRACT_TERM, {
		playerName: playerName,
		tradeId: tradeId,
		date: date
	}, possibleTerms, reason);
};

AmbiguityCollector.prototype.count = function() {
	return this.items.length;
};

AmbiguityCollector.prototype.byType = function() {
	var counts = {};
	this.items.forEach(function(a) {
		counts[a.type] = (counts[a.type] || 0) + 1;
	});
	return counts;
};

AmbiguityCollector.prototype.getAll = function() {
	return this.items;
};

AmbiguityCollector.prototype.getByType = function(type) {
	return this.items.filter(function(a) { return a.type === type; });
};

// ============================================================
// Resolution Validation
// ============================================================

/**
 * Validate that a contract term resolution is consistent with constraints.
 * 
 * @param {object} resolution - The resolution to validate
 * @param {object} context - Context with facts
 * @returns {object} { valid: boolean, errors: [] }
 */
function validateContractTermResolution(resolution, context) {
	var errors = [];
	
	// Check contract length
	if (resolution.startYear !== null && resolution.endYear !== null) {
		var length = resolution.endYear - resolution.startYear + 1;
		if (length < 1 || length > 3) {
			errors.push('Contract length ' + length + ' is invalid (must be 1-3)');
		}
	}
	
	// Check that trade date falls within contract
	if (context && context.tradeDate) {
		var tradeSeason = context.tradeDate.getFullYear();
		var tradeMonth = context.tradeDate.getMonth();
		if (tradeMonth < 7) tradeSeason -= 1;
		
		if (resolution.endYear < tradeSeason) {
			errors.push('Contract ends before trade season');
		}
		if (resolution.startYear !== null && resolution.startYear > tradeSeason) {
			errors.push('Contract starts after trade season');
		}
	}
	
	// Check against snapshot if available
	if (context && context.snapshots) {
		var normalizedName = resolution.player.toLowerCase().replace(/[^a-z]/g, '');
		var matchingSnapshot = context.snapshots.find(function(s) {
			var sName = s.playerName.toLowerCase().replace(/[^a-z]/g, '');
			return sName === normalizedName && s.endYear === resolution.endYear;
		});
		
		if (matchingSnapshot && matchingSnapshot.startYear !== null &&
		    matchingSnapshot.startYear !== resolution.startYear) {
			errors.push('Resolution conflicts with snapshot (start year ' + 
			            matchingSnapshot.startYear + ' vs ' + resolution.startYear + ')');
		}
	}
	
	return {
		valid: errors.length === 0,
		errors: errors
	};
}

/**
 * Validate all resolutions against current facts.
 * 
 * @param {object} facts - Current facts
 * @returns {object} { valid: number, invalid: number, errors: [] }
 */
function validateAllResolutions(facts) {
	var res = loadResolutions();
	var result = { valid: 0, invalid: 0, errors: [] };
	
	res.contractTerms.forEach(function(resolution) {
		var validation = validateContractTermResolution(resolution, { snapshots: facts.snapshots });
		if (validation.valid) {
			result.valid++;
		} else {
			result.invalid++;
			result.errors.push({
				resolution: resolution,
				errors: validation.errors
			});
		}
	});
	
	return result;
}

// ============================================================
// Apply Resolutions to Inferences
// ============================================================

/**
 * Apply resolutions to enhance inferred contract terms.
 * If a resolution exists for an ambiguous inference, use it.
 * 
 * @param {object} inference - The inference result
 * @param {string} playerName - Player name
 * @param {number} tradeId - Trade ID (optional)
 * @returns {object} Enhanced inference
 */
function applyResolution(inference, playerName, tradeId) {
	// Only apply to ambiguous inferences
	if (inference.confidence !== 'ambiguous') {
		return inference;
	}
	
	var resolution = getContractTermResolution({
		playerName: playerName,
		tradeId: tradeId
	});
	
	if (resolution) {
		return {
			startYear: resolution.startYear,
			endYear: resolution.endYear,
			confidence: 'resolved',
			reason: 'Resolved: ' + (resolution.reason || 'manual')
		};
	}
	
	return inference;
}

// ============================================================
// Export Ambiguities for Review
// ============================================================

/**
 * Format ambiguities for human review.
 * 
 * @param {AmbiguityCollector} collector - Collector with ambiguities
 * @returns {string} Formatted output
 */
function formatForReview(collector) {
	var lines = [];
	var items = collector.getAll();
	
	lines.push('=== Ambiguities Report ===');
	lines.push('Total: ' + items.length);
	lines.push('');
	
	var byType = collector.byType();
	Object.keys(byType).forEach(function(type) {
		lines.push(type + ': ' + byType[type]);
	});
	lines.push('');
	
	// Group contract term ambiguities by year
	var contractTerms = collector.getByType(AmbiguityType.CONTRACT_TERM);
	if (contractTerms.length > 0) {
		lines.push('--- Contract Term Ambiguities ---');
		
		// Sort by trade date
		contractTerms.sort(function(a, b) {
			return (a.context.date || 0) - (b.context.date || 0);
		});
		
		contractTerms.forEach(function(amb) {
			var ctx = amb.context;
			var dateStr = ctx.date ? ctx.date.toISOString().split('T')[0] : 'unknown';
			lines.push('');
			lines.push('Trade #' + ctx.tradeId + ' (' + dateStr + ')');
			lines.push('  Player: ' + ctx.playerName);
			lines.push('  Reason: ' + amb.reason);
			if (amb.possibleValues && amb.possibleValues.length > 0) {
				lines.push('  Possible: ' + JSON.stringify(amb.possibleValues));
			}
		});
	}
	
	return lines.join('\n');
}

/**
 * Generate resolution suggestions from ambiguities.
 * 
 * @param {AmbiguityCollector} collector - Collector with ambiguities
 * @returns {Array} Array of suggested resolutions
 */
function suggestResolutions(collector) {
	var suggestions = [];
	
	collector.getByType(AmbiguityType.CONTRACT_TERM).forEach(function(amb) {
		var ctx = amb.context;
		suggestions.push({
			type: 'contractTerm',
			player: ctx.playerName,
			tradeId: ctx.tradeId,
			date: ctx.date,
			reason: amb.reason,
			possibleValues: amb.possibleValues,
			suggestedResolution: amb.possibleValues && amb.possibleValues[0] ? amb.possibleValues[0] : null
		});
	});
	
	return suggestions;
}

module.exports = {
	// Types
	AmbiguityType: AmbiguityType,
	
	// Resolution management
	loadResolutions: loadResolutions,
	saveResolutions: saveResolutions,
	clearCache: clearCache,
	
	// Contract term resolutions
	getContractTermResolution: getContractTermResolution,
	addContractTermResolution: addContractTermResolution,
	removeContractTermResolution: removeContractTermResolution,
	
	// Ambiguity tracking
	AmbiguityCollector: AmbiguityCollector,
	
	// Validation
	validateContractTermResolution: validateContractTermResolution,
	validateAllResolutions: validateAllResolutions,
	
	// Apply resolutions
	applyResolution: applyResolution,
	
	// Reporting
	formatForReview: formatForReview,
	suggestResolutions: suggestResolutions
};
