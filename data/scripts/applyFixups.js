/**
 * Apply manual data corrections after reset-migration.
 * 
 * Reads fixups.json and calls admin route handlers with fake request/response
 * objects. This uses the same code paths as the admin UI.
 * 
 * Usage:
 *   docker compose run --rm web node data/scripts/applyFixups.js
 *   docker compose run --rm web node data/scripts/applyFixups.js --dry-run
 */

var dotenv = require('dotenv').config({ path: __dirname + '/../../.env' });
var mongoose = require('mongoose');

var adminService = require('../../admin/service');
var adminPlayers = require('../../admin/players');
var adminTrades = require('../../admin/trades');

var Franchise = require('../../models/Franchise');
var Transaction = require('../../models/Transaction');
var Player = require('../../models/Player');

mongoose.connect(process.env.MONGODB_URI);

var fixups = require('./fixups.json');

function fakeRequest(body, params) {
	return { body: body || {}, params: params || {}, query: {} };
}

function fakeResponse() {
	var result = { redirected: null, error: null };
	return {
		redirect: function(url) { result.redirected = url; },
		status: function(code) {
			return {
				json: function(data) { result.error = data.error || data; },
				send: function(msg) { result.error = msg; }
			};
		},
		result: result
	};
}

async function run() {
	var dryRun = process.argv.includes('--dry-run');

	console.log('Applying fixups from fixups.json...\n');
	if (dryRun) {
		console.log('DRY RUN - no changes will be made\n');
	}

	var errors = [];

	// =========================================================================
	// Franchise Transfer
	// =========================================================================
	if (fixups.franchiseTransfer) {
		console.log('=== Franchise Transfer ===');
		var ft = fixups.franchiseTransfer;
		
		var franchise = await Franchise.findOne({ sleeperRosterId: ft.sleeperRosterId });
		if (!franchise) {
			console.log('  ✗ Franchise ' + ft.sleeperRosterId + ' not found');
			errors.push('Franchise ' + ft.sleeperRosterId + ' not found');
		} else {
			console.log('  sleeperRosterId: ' + ft.sleeperRosterId + ' → ' + ft.newDisplayName);
			console.log('  newOwnerName: ' + ft.newOwnerName);
			console.log('  effectiveSeason: ' + ft.effectiveSeason);
			
			if (!dryRun) {
				var res = fakeResponse();
				await adminService.transferFranchise(fakeRequest({
					franchiseId: franchise._id.toString(),
					newOwnerName: ft.newOwnerName,
					newDisplayName: ft.newDisplayName,
					effectiveSeason: String(ft.effectiveSeason)
				}), res);
				
				if (res.result.error) {
					console.log('  ✗ ' + res.result.error);
					errors.push('Transfer: ' + res.result.error);
				} else {
					console.log('  ✓ Done');
				}
			}
		}
		console.log('');
	}

	// =========================================================================
	// Season Rollover
	// =========================================================================
	if (fixups.seasonRollover) {
		console.log('=== Season Rollover ===');
		var sr = fixups.seasonRollover;
		
		var franchises = await Franchise.find({}).lean();
		var body = {};
		
		// Map sleeperRosterId → franchiseId for draft order
		if (sr.draftOrder) {
			console.log('  Draft order (sleeperRosterId → slot):');
			franchises.forEach(function(f) {
				var slot = sr.draftOrder[String(f.sleeperRosterId)];
				if (slot) {
					body['draftOrder_' + f._id.toString()] = String(slot);
					console.log('    ' + f.sleeperRosterId + ' → ' + slot);
				}
			});
		}
		
		// Add date overrides
		if (sr.dateOverrides) {
			console.log('  Date overrides:');
			Object.keys(sr.dateOverrides).forEach(function(field) {
				body[field] = sr.dateOverrides[field];
				console.log('    ' + field + ': ' + sr.dateOverrides[field]);
			});
		}
		
		if (!dryRun) {
			var res = fakeResponse();
			await adminService.advanceSeason(fakeRequest(body), res);
			
			if (res.result.error) {
				console.log('  ✗ ' + res.result.error);
				errors.push('Rollover: ' + res.result.error);
			} else {
				console.log('  ✓ Done');
			}
		}
		console.log('');
	}

	// =========================================================================
	// Trade Amendments
	// =========================================================================
	if (fixups.tradeAmendments && fixups.tradeAmendments.length > 0) {
		console.log('=== Trade Amendments ===');
		
		for (var i = 0; i < fixups.tradeAmendments.length; i++) {
			var ta = fixups.tradeAmendments[i];
			var trade = await Transaction.findOne({ type: 'trade', tradeId: ta.tradeId });
			
			if (!trade) {
				console.log('  ✗ Trade #' + ta.tradeId + ' not found');
				errors.push('Trade #' + ta.tradeId + ' not found');
				continue;
			}
			
			console.log('  Trade #' + ta.tradeId + ':');
			if (ta.notes) console.log('    notes: ' + ta.notes);
			if (ta.timestamp) console.log('    timestamp: ' + ta.timestamp);
			
			if (!dryRun) {
				var body = {};
				if (ta.notes !== undefined) body.notes = ta.notes;
				if (ta.timestamp) body.timestamp = ta.timestamp;
				
				var res = fakeResponse();
				await adminTrades.editTrade(fakeRequest(body, { id: trade._id.toString() }), res);
				
				if (res.result.error) {
					console.log('    ✗ ' + res.result.error);
					errors.push('Trade #' + ta.tradeId + ': ' + res.result.error);
				} else {
					console.log('    ✓ Done');
				}
			}
		}
		console.log('');
	}

	// =========================================================================
	// Trade Cash Corrections
	// =========================================================================
	if (fixups.tradeCashCorrections && fixups.tradeCashCorrections.length > 0) {
		console.log('=== Trade Cash Corrections ===');
		
		for (var i = 0; i < fixups.tradeCashCorrections.length; i++) {
			var tc = fixups.tradeCashCorrections[i];
			var trade = await Transaction.findOne({ type: 'trade', tradeId: tc.tradeId });
			
			if (!trade) {
				console.log('  ✗ Trade #' + tc.tradeId + ' not found');
				errors.push('Trade #' + tc.tradeId + ' not found');
				continue;
			}
			
			var body = {};
			var prefix = 'cash_' + tc.party + '_' + tc.cash + '_';
			
			console.log('  Trade #' + tc.tradeId + ' party[' + tc.party + '].cash[' + tc.cash + ']:');
			
			if (tc.remove) {
				body[prefix + 'amount'] = '0';
				console.log('    remove: true (setting amount to 0)');
			} else {
				if (tc.amount !== undefined) {
					body[prefix + 'amount'] = String(tc.amount);
					console.log('    amount: ' + tc.amount);
				}
				if (tc.season !== undefined) {
					body[prefix + 'season'] = String(tc.season);
					console.log('    season: ' + tc.season);
				}
			}
			
			if (tc.notes !== undefined) {
				body.notes = tc.notes;
				console.log('    notes: ' + tc.notes);
			}
			
			if (!dryRun) {
				var res = fakeResponse();
				await adminTrades.editTrade(fakeRequest(body, { id: trade._id.toString() }), res);
				
				if (res.result.error) {
					console.log('    ✗ ' + res.result.error);
					errors.push('Trade #' + tc.tradeId + ' cash: ' + res.result.error);
				} else {
					console.log('    ✓ Done');
				}
			}
		}
		console.log('');
	}

	// =========================================================================
	// Player Corrections
	// =========================================================================
	if (fixups.playerCorrections && fixups.playerCorrections.length > 0) {
		console.log('=== Player Corrections ===');
		
		for (var i = 0; i < fixups.playerCorrections.length; i++) {
			var pc = fixups.playerCorrections[i];
			var player = await Player.findOne({ sleeperId: null, name: pc.name });
			
			if (!player) {
				// Try case-insensitive
				player = await Player.findOne({
					sleeperId: null,
					name: new RegExp('^' + pc.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i')
				});
			}
			
			if (!player) {
				console.log('  ✗ Player "' + pc.name + '" not found');
				errors.push('Player "' + pc.name + '" not found');
				continue;
			}
			
			console.log('  ' + pc.name + ':');
			
			var body = { name: player.name };
			
			if (pc.positions) {
				pc.positions.forEach(function(pos) { body['pos_' + pos] = 'on'; });
				console.log('    positions: ' + pc.positions.join(', '));
			}
			if (pc.notes !== undefined) {
				body.notes = pc.notes;
				console.log('    notes: ' + pc.notes);
			}
			
			if (!dryRun) {
				var res = fakeResponse();
				await adminPlayers.editPlayer(fakeRequest(body, { id: player._id.toString() }), res);
				
				if (res.result.error) {
					console.log('    ✗ ' + res.result.error);
					errors.push('Player "' + pc.name + '": ' + res.result.error);
				} else {
					console.log('    ✓ Done');
				}
			}
		}
		console.log('');
	}

	// =========================================================================
	// Summary
	// =========================================================================
	if (errors.length > 0) {
		console.log('=== Errors (' + errors.length + ') ===');
		errors.forEach(function(e) { console.log('  - ' + e); });
		console.log('');
	}

	console.log('Done!');
	process.exit(errors.length > 0 ? 1 : 0);
}

run().catch(function(err) {
	console.error('Error:', err);
	process.exit(1);
});
