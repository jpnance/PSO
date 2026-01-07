/**
 * Test harness for cap warning calculations in the trade machine.
 * 
 * Tests the logic for calculating trade impact on available cap and recoverable.
 * 
 * Usage: 
 *   node propose/test-cap-warnings.js
 */

// ============================================================================
// Extract the pure calculation functions (mirroring public/trade.js logic)
// ============================================================================

function calculateTradeImpact(deal, franchisesInvolved) {
	var impact = {};
	
	franchisesInvolved.forEach((fId) => {
		impact[fId] = {
			playersIn: 0,
			playersOut: 0,
			salaryIn: 0,
			salaryOut: 0,
			recoverableIn: 0,
			recoverableOut: 0
		};
	});
	
	franchisesInvolved.forEach((receivingId) => {
		var bucket = deal[receivingId];
		
		bucket.players.forEach((player) => {
			if (player.terms !== 'rfa-rights') {
				impact[receivingId].playersIn++;
				impact[receivingId].salaryIn += player.salary || 0;
				impact[receivingId].recoverableIn += player.recoverable || 0;
				
				if (player.fromFranchiseId && impact[player.fromFranchiseId]) {
					impact[player.fromFranchiseId].playersOut++;
					impact[player.fromFranchiseId].salaryOut += player.salary || 0;
					impact[player.fromFranchiseId].recoverableOut += player.recoverable || 0;
				}
			}
		});
	});
	
	return impact;
}

function calculateCashDeltas(deal, franchisesInvolved, season) {
	var deltas = {};
	
	franchisesInvolved.forEach((fId) => {
		deltas[fId] = 0;
	});
	
	franchisesInvolved.forEach((receiverId) => {
		var bucket = deal[receiverId];
		bucket.cash.forEach((c) => {
			if (c.season === season) {
				deltas[receiverId] += c.amount;
				if (deltas[c.fromFranchiseId] !== undefined) {
					deltas[c.fromFranchiseId] -= c.amount;
				}
			}
		});
	});
	
	return deltas;
}

function getWarningsForFranchise(fId, franchiseData, deal, franchisesInvolved, currentSeason, isBeforeCutDay) {
	var warnings = [];
	var data = franchiseData[fId];
	if (!data) return warnings;
	
	var impact = calculateTradeImpact(deal, franchisesInvolved);
	var cashDeltas = calculateCashDeltas(deal, franchisesInvolved, currentSeason);
	
	var imp = impact[fId];
	if (!imp) return warnings;
	
	var netSalary = imp.salaryIn - imp.salaryOut;
	var netRecoverable = imp.recoverableIn - imp.recoverableOut;
	var cashDelta = cashDeltas[fId] || 0;
	
	var newAvailable = data.available - netSalary + cashDelta;
	var newRecoverable = data.recoverable + netRecoverable;
	
	if (newAvailable < 0) {
		var deficit = Math.abs(newAvailable);
		
		if (isBeforeCutDay && (newAvailable + newRecoverable) >= 0) {
			warnings.push({
				type: 'warning',
				text: '$' + deficit + ' over (can recover)'
			});
		} else {
			warnings.push({
				type: 'danger',
				text: '$' + deficit + ' over cap'
			});
		}
	}
	
	return warnings;
}

// ============================================================================
// Test helpers
// ============================================================================

var passed = 0;
var failed = 0;

function assert(condition, message) {
	if (condition) {
		passed++;
		console.log('  ✓ ' + message);
	} else {
		failed++;
		console.log('  ✗ ' + message);
	}
}

function assertEqual(actual, expected, message) {
	if (actual === expected) {
		passed++;
		console.log('  ✓ ' + message);
	} else {
		failed++;
		console.log('  ✗ ' + message + ' (expected ' + expected + ', got ' + actual + ')');
	}
}

// ============================================================================
// Tests
// ============================================================================

console.log('\n=== Test: calculateTradeImpact ===\n');

(function testBasicPlayerTrade() {
	console.log('Basic player trade (Patrick sends $50 player to Quinn):');
	
	var deal = {
		'patrick': { players: [], picks: [], cash: [] },
		'quinn': { 
			players: [{ 
				id: 'player1', 
				fromFranchiseId: 'patrick', 
				salary: 50, 
				recoverable: 20,
				terms: 'signed'
			}], 
			picks: [], 
			cash: [] 
		}
	};
	
	var impact = calculateTradeImpact(deal, ['patrick', 'quinn']);
	
	assertEqual(impact.patrick.salaryOut, 50, 'Patrick loses $50 salary');
	assertEqual(impact.patrick.recoverableOut, 20, 'Patrick loses $20 recoverable');
	assertEqual(impact.quinn.salaryIn, 50, 'Quinn gains $50 salary');
	assertEqual(impact.quinn.recoverableIn, 20, 'Quinn gains $20 recoverable');
})();

(function testTwoWayPlayerTrade() {
	console.log('\nTwo-way player trade (Patrick sends $50, Quinn sends $30):');
	
	var deal = {
		'patrick': { 
			players: [{ 
				id: 'player2', 
				fromFranchiseId: 'quinn', 
				salary: 30, 
				recoverable: 12,
				terms: 'signed'
			}], 
			picks: [], 
			cash: [] 
		},
		'quinn': { 
			players: [{ 
				id: 'player1', 
				fromFranchiseId: 'patrick', 
				salary: 50, 
				recoverable: 20,
				terms: 'signed'
			}], 
			picks: [], 
			cash: [] 
		}
	};
	
	var impact = calculateTradeImpact(deal, ['patrick', 'quinn']);
	
	assertEqual(impact.patrick.salaryIn, 30, 'Patrick gains $30 salary');
	assertEqual(impact.patrick.salaryOut, 50, 'Patrick loses $50 salary');
	assertEqual(impact.quinn.salaryIn, 50, 'Quinn gains $50 salary');
	assertEqual(impact.quinn.salaryOut, 30, 'Quinn loses $30 salary');
})();

(function testRfaRightsIgnored() {
	console.log('\nRFA rights should not affect salary/recoverable:');
	
	var deal = {
		'patrick': { players: [], picks: [], cash: [] },
		'quinn': { 
			players: [{ 
				id: 'player1', 
				fromFranchiseId: 'patrick', 
				salary: 0, 
				recoverable: 0,
				terms: 'rfa-rights'
			}], 
			picks: [], 
			cash: [] 
		}
	};
	
	var impact = calculateTradeImpact(deal, ['patrick', 'quinn']);
	
	assertEqual(impact.patrick.salaryOut, 0, 'Patrick loses $0 salary (RFA rights)');
	assertEqual(impact.quinn.salaryIn, 0, 'Quinn gains $0 salary (RFA rights)');
	assertEqual(impact.quinn.playersIn, 0, 'RFA rights not counted as player');
})();


console.log('\n=== Test: calculateCashDeltas ===\n');

(function testCashInCurrentSeason() {
	console.log('Cash in current season:');
	
	var deal = {
		'patrick': { 
			players: [], 
			picks: [], 
			cash: [{ amount: 25, fromFranchiseId: 'quinn', season: 2025 }] 
		},
		'quinn': { players: [], picks: [], cash: [] }
	};
	
	var deltas = calculateCashDeltas(deal, ['patrick', 'quinn'], 2025);
	
	assertEqual(deltas.patrick, 25, 'Patrick receives $25');
	assertEqual(deltas.quinn, -25, 'Quinn sends $25');
})();

(function testCashInFutureSeason() {
	console.log('\nCash in future season (should not affect current season):');
	
	var deal = {
		'patrick': { 
			players: [], 
			picks: [], 
			cash: [{ amount: 25, fromFranchiseId: 'quinn', season: 2026 }] 
		},
		'quinn': { players: [], picks: [], cash: [] }
	};
	
	var deltas = calculateCashDeltas(deal, ['patrick', 'quinn'], 2025);
	
	assertEqual(deltas.patrick, 0, 'Patrick receives $0 in 2025');
	assertEqual(deltas.quinn, 0, 'Quinn sends $0 in 2025');
})();


console.log('\n=== Test: getWarningsForFranchise (Cap Warnings) ===\n');

(function testNoWarningWhenUnderCap() {
	console.log('No warning when staying under cap:');
	
	var franchiseData = {
		'patrick': { available: 100, recoverable: 50 }
	};
	var deal = {
		'patrick': { players: [], picks: [], cash: [] },
		'quinn': { 
			players: [{ 
				id: 'player1', 
				fromFranchiseId: 'patrick', 
				salary: 50, 
				recoverable: 20,
				terms: 'signed'
			}], 
			picks: [], 
			cash: [] 
		}
	};
	
	// Patrick sends $50 player, so available goes UP by $50 (100 + 50 = 150)
	var warnings = getWarningsForFranchise('patrick', franchiseData, deal, ['patrick', 'quinn'], 2025, true);
	
	assertEqual(warnings.length, 0, 'No warnings for Patrick');
})();

(function testSoftCapWarning() {
	console.log('\nSoft cap warning (over but can recover, before cut day):');
	
	var franchiseData = {
		'quinn': { available: 30, recoverable: 40 }
	};
	var deal = {
		'patrick': { players: [], picks: [], cash: [] },
		'quinn': { 
			players: [{ 
				id: 'player1', 
				fromFranchiseId: 'patrick', 
				salary: 50, 
				recoverable: 20,
				terms: 'signed'
			}], 
			picks: [], 
			cash: [] 
		}
	};
	
	// Quinn acquires $50 player: available = 30 - 50 = -20
	// Quinn gains $20 recoverable: recoverable = 40 + 20 = 60
	// -20 + 60 = 40 >= 0, so can recover
	var warnings = getWarningsForFranchise('quinn', franchiseData, deal, ['patrick', 'quinn'], 2025, true);
	
	assertEqual(warnings.length, 1, 'One warning for Quinn');
	assertEqual(warnings[0].type, 'warning', 'Warning is soft cap (yellow)');
	assert(warnings[0].text.includes('20'), 'Shows $20 deficit');
	assert(warnings[0].text.includes('can recover'), 'Mentions can recover');
})();

(function testHardCapWarningAfterCutDay() {
	console.log('\nHard cap warning (over cap, after cut day):');
	
	var franchiseData = {
		'quinn': { available: 30, recoverable: 100 }
	};
	var deal = {
		'patrick': { players: [], picks: [], cash: [] },
		'quinn': { 
			players: [{ 
				id: 'player1', 
				fromFranchiseId: 'patrick', 
				salary: 50, 
				recoverable: 20,
				terms: 'signed'
			}], 
			picks: [], 
			cash: [] 
		}
	};
	
	// Same trade, but after cut day - can't recover
	var warnings = getWarningsForFranchise('quinn', franchiseData, deal, ['patrick', 'quinn'], 2025, false);
	
	assertEqual(warnings.length, 1, 'One warning for Quinn');
	assertEqual(warnings[0].type, 'danger', 'Warning is hard cap (red)');
	assert(warnings[0].text.includes('over cap'), 'Mentions over cap');
})();

(function testHardCapWarningCantRecover() {
	console.log('\nHard cap warning (over cap, cannot recover even before cut day):');
	
	var franchiseData = {
		'quinn': { available: 30, recoverable: 10 }
	};
	var deal = {
		'patrick': { players: [], picks: [], cash: [] },
		'quinn': { 
			players: [{ 
				id: 'player1', 
				fromFranchiseId: 'patrick', 
				salary: 50, 
				recoverable: 5,
				terms: 'signed'
			}], 
			picks: [], 
			cash: [] 
		}
	};
	
	// Quinn acquires $50 player: available = 30 - 50 = -20
	// Quinn gains $5 recoverable: recoverable = 10 + 5 = 15
	// -20 + 15 = -5 < 0, cannot recover
	var warnings = getWarningsForFranchise('quinn', franchiseData, deal, ['patrick', 'quinn'], 2025, true);
	
	assertEqual(warnings.length, 1, 'One warning for Quinn');
	assertEqual(warnings[0].type, 'danger', 'Warning is hard cap (red)');
})();

(function testCashHelpsAvoidWarning() {
	console.log('\nCash received helps avoid cap warning:');
	
	var franchiseData = {
		'quinn': { available: 30, recoverable: 10 }
	};
	var deal = {
		'patrick': { players: [], picks: [], cash: [] },
		'quinn': { 
			players: [{ 
				id: 'player1', 
				fromFranchiseId: 'patrick', 
				salary: 50, 
				recoverable: 5,
				terms: 'signed'
			}], 
			picks: [], 
			cash: [{ amount: 25, fromFranchiseId: 'patrick', season: 2025 }] 
		}
	};
	
	// Quinn acquires $50 player but receives $25 cash
	// available = 30 - 50 + 25 = 5 >= 0, no warning
	var warnings = getWarningsForFranchise('quinn', franchiseData, deal, ['patrick', 'quinn'], 2025, true);
	
	assertEqual(warnings.length, 0, 'No warning when cash covers deficit');
})();


// ============================================================================
// Summary
// ============================================================================

console.log('\n=== Summary ===\n');
console.log('Passed: ' + passed);
console.log('Failed: ' + failed);

if (failed > 0) {
	process.exit(1);
}
