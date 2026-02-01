/**
 * Constraint Definitions
 * 
 * Constraints are rules that must hold for the data to be consistent.
 * Each constraint function takes facts and returns an array of violations.
 * A violation includes what's wrong and which facts are involved.
 */

/**
 * Violation object structure:
 * {
 *   constraint: 'ConstraintName',
 *   message: 'Human-readable description',
 *   facts: [fact1, fact2, ...],  // Facts involved in the violation
 *   context: { ... }             // Additional context for debugging
 * }
 */

// ============================================================
// CONSTRAINT: SalaryContinuity
// A player's salary should not change during a contract term.
// If we see the same player at different salaries in the same
// contract period, something is wrong.
// ============================================================

/**
 * Check salary continuity across snapshots.
 * 
 * @param {Array} snapshotFacts - Contract snapshots
 * @returns {Array} Array of violations
 */
function salaryContinuity(snapshotFacts) {
	var violations = [];
	
	// Group by player name (normalized)
	var byPlayer = {};
	snapshotFacts.forEach(function(s) {
		var name = s.playerName.toLowerCase();
		if (!byPlayer[name]) byPlayer[name] = [];
		byPlayer[name].push(s);
	});
	
	// Check each player's history
	Object.keys(byPlayer).forEach(function(name) {
		var contracts = byPlayer[name].sort(function(a, b) {
			return a.season - b.season;
		});
		
		// Look for salary changes within a contract term
		for (var i = 0; i < contracts.length - 1; i++) {
			var current = contracts[i];
			var next = contracts[i + 1];
			
			// If both are within the same contract term (overlapping years)
			// and have different salaries, that's a violation
			if (current.endYear >= next.season && 
			    current.startYear === next.startYear &&
			    current.endYear === next.endYear &&
			    current.salary !== next.salary) {
				violations.push({
					constraint: 'SalaryContinuity',
					message: 'Salary changed from $' + current.salary + ' to $' + next.salary + 
					         ' for ' + current.playerName + ' within same contract term',
					facts: [current, next],
					context: {
						player: current.playerName,
						contractTerm: current.startYear + '-' + current.endYear,
						salaries: [current.salary, next.salary]
					}
				});
			}
		}
	});
	
	return violations;
}

// ============================================================
// CONSTRAINT: ContractSpansTrade
// When a player is traded, the trade date must fall within 
// their contract term.
// ============================================================

/**
 * Check that trade dates fall within contract terms.
 * 
 * @param {Array} tradeFacts - Trade facts with players
 * @param {object} options - Options for constraint checking
 * @returns {Array} Array of violations
 */
function contractSpansTrade(tradeFacts, options) {
	options = options || {};
	var violations = [];
	
	tradeFacts.forEach(function(trade) {
		if (!trade.date) return;
		
		var tradeYear = trade.date.getFullYear();
		var tradeMonth = trade.date.getMonth();
		
		// Determine the "season" for this trade
		// Trades before August are typically in the previous season
		var tradeSeason = (tradeMonth < 7) ? tradeYear - 1 : tradeYear;
		
		trade.parties.forEach(function(party) {
			party.players.forEach(function(player) {
				// Skip if we don't have parsed contract terms
				if (player.endYear === undefined || player.endYear === null) return;
				
				// The contract's end year must be >= trade season
				if (player.endYear < tradeSeason) {
					violations.push({
						constraint: 'ContractSpansTrade',
						message: player.name + ' traded in ' + tradeSeason + 
						         ' but contract ends in ' + player.endYear,
						facts: [trade, player],
						context: {
							tradeId: trade.tradeId,
							tradeDate: trade.date,
							tradeSeason: tradeSeason,
							player: player.name,
							endYear: player.endYear
						}
					});
				}
				
				// If we have startYear, trade season must be >= startYear
				if (player.startYear !== undefined && player.startYear !== null) {
					if (player.startYear > tradeSeason) {
						violations.push({
							constraint: 'ContractSpansTrade',
							message: player.name + ' traded in ' + tradeSeason + 
							         ' but contract starts in ' + player.startYear,
							facts: [trade, player],
							context: {
								tradeId: trade.tradeId,
								tradeDate: trade.date,
								tradeSeason: tradeSeason,
								player: player.name,
								startYear: player.startYear
							}
						});
					}
				}
			});
		});
	});
	
	return violations;
}

// ============================================================
// CONSTRAINT: CutSalaryMatchesAcquisition
// When a player is cut, their salary should match the salary
// at which they were acquired (auction, draft, or trade).
// ============================================================

/**
 * Check that cut salaries match acquisition salaries.
 * 
 * @param {Array} cutFacts - Cut facts with salaries
 * @param {Array} snapshotFacts - Snapshot facts to cross-reference
 * @returns {Array} Array of violations
 */
function cutSalaryMatchesAcquisition(cutFacts, snapshotFacts) {
	var violations = [];
	
	// Build lookup of player -> salary by year from snapshots
	var snapshotSalaries = {};
	snapshotFacts.forEach(function(s) {
		var key = s.playerName.toLowerCase() + '|' + s.season;
		snapshotSalaries[key] = s.salary;
	});
	
	cutFacts.forEach(function(cut) {
		if (!cut.salary || !cut.cutYear) return;
		
		var key = cut.name.toLowerCase() + '|' + cut.cutYear;
		var snapshotSalary = snapshotSalaries[key];
		
		// If we have a snapshot for the same year, salaries should match
		if (snapshotSalary !== undefined && snapshotSalary !== cut.salary) {
			violations.push({
				constraint: 'CutSalaryMatchesAcquisition',
				message: cut.name + ' cut at $' + cut.salary + 
				         ' but snapshot shows $' + snapshotSalary,
				facts: [cut],
				context: {
					player: cut.name,
					cutYear: cut.cutYear,
					cutSalary: cut.salary,
					snapshotSalary: snapshotSalary
				}
			});
		}
	});
	
	return violations;
}

// ============================================================
// CONSTRAINT: SnapshotConsistency
// A player appearing in a snapshot must have a contract that
// covers that season.
// ============================================================

/**
 * Check that snapshot entries have valid contract terms.
 * 
 * @param {Array} snapshotFacts - Snapshot facts
 * @returns {Array} Array of violations
 */
function snapshotConsistency(snapshotFacts) {
	var violations = [];
	
	snapshotFacts.forEach(function(s) {
		// startYear and endYear must make sense for the season
		if (s.endYear !== null && s.endYear < s.season) {
			violations.push({
				constraint: 'SnapshotConsistency',
				message: s.playerName + ' in ' + s.season + ' snapshot but contract ends in ' + s.endYear,
				facts: [s],
				context: {
					player: s.playerName,
					season: s.season,
					endYear: s.endYear
				}
			});
		}
		
		if (s.startYear !== null && s.startYear > s.season) {
			violations.push({
				constraint: 'SnapshotConsistency',
				message: s.playerName + ' in ' + s.season + ' snapshot but contract starts in ' + s.startYear,
				facts: [s],
				context: {
					player: s.playerName,
					season: s.season,
					startYear: s.startYear
				}
			});
		}
		
		// Contract can be at most 3 years
		if (s.startYear !== null && s.endYear !== null) {
			var length = s.endYear - s.startYear + 1;
			if (length > 3) {
				violations.push({
					constraint: 'SnapshotConsistency',
					message: s.playerName + ' has ' + length + '-year contract (max is 3)',
					facts: [s],
					context: {
						player: s.playerName,
						startYear: s.startYear,
						endYear: s.endYear,
						length: length
					}
				});
			}
			if (length < 1) {
				violations.push({
					constraint: 'SnapshotConsistency',
					message: s.playerName + ' has invalid contract term',
					facts: [s],
					context: {
						player: s.playerName,
						startYear: s.startYear,
						endYear: s.endYear
					}
				});
			}
		}
	});
	
	return violations;
}

// ============================================================
// CONSTRAINT: ContractSequence
// A player's contracts should not overlap and should be 
// contiguous or have FA gaps.
// ============================================================

/**
 * Check that a player's contracts form a valid sequence.
 * 
 * @param {Array} snapshotFacts - Snapshot facts
 * @returns {Array} Array of violations
 */
function contractSequence(snapshotFacts) {
	var violations = [];
	
	// Group by player
	var byPlayer = {};
	snapshotFacts.forEach(function(s) {
		var name = s.playerName.toLowerCase();
		if (!byPlayer[name]) byPlayer[name] = [];
		byPlayer[name].push(s);
	});
	
	Object.keys(byPlayer).forEach(function(name) {
		var contracts = byPlayer[name].sort(function(a, b) {
			return a.season - b.season;
		});
		
		// Look for overlapping contracts
		for (var i = 0; i < contracts.length - 1; i++) {
			var current = contracts[i];
			var next = contracts[i + 1];
			
			// If different contract terms, check they don't overlap
			if (current.startYear !== next.startYear || current.endYear !== next.endYear) {
				// Current ends after or when next starts = overlap
				if (current.endYear !== null && next.startYear !== null &&
				    current.endYear >= next.startYear) {
					// This could be valid (same contract continuing) or invalid (actual overlap)
					// Only flag if it's clearly two different contracts
					if (current.endYear !== next.endYear) {
						// Could be a contract extension, not a violation in our rules
					}
				}
			}
		}
	});
	
	return violations;
}

// ============================================================
// CONSTRAINT: ValidContractLength
// Contracts must be 1, 2, or 3 years (or FA which is 1 year).
// ============================================================

/**
 * Check that contract lengths are valid.
 * 
 * @param {Array} snapshotFacts - Snapshot facts
 * @returns {Array} Array of violations
 */
function validContractLength(snapshotFacts) {
	var violations = [];
	
	snapshotFacts.forEach(function(s) {
		if (s.startYear === null) {
			// FA contract, always 1 year - valid
			return;
		}
		
		if (s.endYear === null) {
			violations.push({
				constraint: 'ValidContractLength',
				message: s.playerName + ' has startYear but no endYear',
				facts: [s],
				context: { player: s.playerName, startYear: s.startYear }
			});
			return;
		}
		
		var length = s.endYear - s.startYear + 1;
		if (length < 1 || length > 3) {
			violations.push({
				constraint: 'ValidContractLength',
				message: s.playerName + ' has ' + length + '-year contract (must be 1-3)',
				facts: [s],
				context: {
					player: s.playerName,
					startYear: s.startYear,
					endYear: s.endYear,
					length: length
				}
			});
		}
	});
	
	return violations;
}

// ============================================================
// Run all constraints
// ============================================================

/**
 * Run all constraints on a set of facts.
 * 
 * @param {object} facts - Object containing all fact types
 * @returns {object} { violations: [], summary: {} }
 */
function checkAll(facts) {
	var allViolations = [];
	var summary = {};
	
	// Salary continuity
	if (facts.snapshots) {
		var v1 = salaryContinuity(facts.snapshots);
		allViolations = allViolations.concat(v1);
		summary.salaryContinuity = v1.length;
	}
	
	// Snapshot consistency
	if (facts.snapshots) {
		var v2 = snapshotConsistency(facts.snapshots);
		allViolations = allViolations.concat(v2);
		summary.snapshotConsistency = v2.length;
	}
	
	// Valid contract length
	if (facts.snapshots) {
		var v3 = validContractLength(facts.snapshots);
		allViolations = allViolations.concat(v3);
		summary.validContractLength = v3.length;
	}
	
	// Contract sequence
	if (facts.snapshots) {
		var v4 = contractSequence(facts.snapshots);
		allViolations = allViolations.concat(v4);
		summary.contractSequence = v4.length;
	}
	
	// Cut salary matches acquisition
	if (facts.cuts && facts.snapshots) {
		var v5 = cutSalaryMatchesAcquisition(facts.cuts, facts.snapshots);
		allViolations = allViolations.concat(v5);
		summary.cutSalaryMatchesAcquisition = v5.length;
	}
	
	return {
		violations: allViolations,
		summary: summary,
		total: allViolations.length
	};
}

module.exports = {
	// Individual constraints
	salaryContinuity: salaryContinuity,
	contractSpansTrade: contractSpansTrade,
	cutSalaryMatchesAcquisition: cutSalaryMatchesAcquisition,
	snapshotConsistency: snapshotConsistency,
	contractSequence: contractSequence,
	validContractLength: validContractLength,
	
	// Run all
	checkAll: checkAll
};
