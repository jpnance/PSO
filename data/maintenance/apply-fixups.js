/**
 * Apply manual data corrections after reset-migration.
 * 
 * Reads fixups.json and calls admin route handlers with fake request/response
 * objects. This uses the same code paths as the admin UI.
 * 
 * Usage:
 *   docker compose run --rm web node data/maintenance/apply-fixups.js
 *   docker compose run --rm web node data/maintenance/apply-fixups.js --dry-run
 */

var dotenv = require('dotenv').config({ path: __dirname + '/../../.env' });
var mongoose = require('mongoose');
var fs = require('fs');
var path = require('path');
var readline = require('readline');

var adminService = require('../../services/admin');
var adminPlayers = require('../../services/admin-players');
var adminTrades = require('../../services/admin-trades');

var Franchise = require('../../models/Franchise');
var Transaction = require('../../models/Transaction');
var Player = require('../../models/Player');
var Regime = require('../../models/Regime');

mongoose.connect(process.env.MONGODB_URI);

var configDir = path.join(__dirname, '../config');
var fixupsPath = path.join(configDir, 'fixups.json');
var fixups = require(fixupsPath);
var fixupsModified = false;

// Track sleeper fixups separately so we can write back to the correct files
var sleeperFixupsByYear = {};

// Load additional fixup files (sleeper-fixups-*.json)
var sleeperFixupsFiles = fs.readdirSync(configDir).filter(function(f) {
	return f.match(/^sleeper-fixups-\d{4}\.json$/);
}).sort();

sleeperFixupsFiles.forEach(function(filename) {
	var match = filename.match(/^sleeper-fixups-(\d{4})\.json$/);
	var year = match[1];
	var filePath = path.join(configDir, filename);
	var sleeperFixups = JSON.parse(fs.readFileSync(filePath, 'utf8'));
	sleeperFixupsByYear[year] = { path: filePath, data: sleeperFixups, modified: false };
	
	console.log('Loaded ' + filename);
});

function saveSleeperFixups() {
	var years = Object.keys(sleeperFixupsByYear);
	console.log('saveSleeperFixups: checking ' + years.length + ' files');
	years.forEach(function(year) {
		var entry = sleeperFixupsByYear[year];
		console.log('  ' + year + ': modified=' + entry.modified);
		if (entry.modified) {
			fs.writeFileSync(entry.path, JSON.stringify(entry.data, null, '\t'));
			console.log('  → Wrote ' + entry.path);
		}
	});
}

function prompt(question) {
	var rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout
	});
	return new Promise(function(resolve) {
		rl.question(question, function(answer) {
			rl.close();
			resolve(answer.trim());
		});
	});
}

function saveFixups() {
	fs.writeFileSync(fixupsPath, JSON.stringify(fixups, null, '\t'));
}

// Convert Eastern Time to UTC
// DST runs from 2nd Sunday of March to 1st Sunday of November
function etToUtc(year, month, day, hours, mins) {
	// Find 2nd Sunday of March (DST start)
	var marchFirst = new Date(Date.UTC(year, 2, 1));
	var marchFirstDay = marchFirst.getUTCDay();
	var dstStartDay = 8 + (7 - marchFirstDay) % 7; // 2nd Sunday
	var dstStart = Date.UTC(year, 2, dstStartDay, 7, 0); // 2am ET = 7am UTC
	
	// Find 1st Sunday of November (DST end)
	var novFirst = new Date(Date.UTC(year, 10, 1));
	var novFirstDay = novFirst.getUTCDay();
	var dstEndDay = 1 + (7 - novFirstDay) % 7; // 1st Sunday
	var dstEnd = Date.UTC(year, 10, dstEndDay, 6, 0); // 2am ET = 6am UTC (still in EDT)
	
	// Create date in UTC as if it were ET
	var utcAsEt = Date.UTC(year, month, day, hours, mins, 0);
	
	// Determine offset: EDT (UTC-4) or EST (UTC-5)
	var offset = (utcAsEt >= dstStart && utcAsEt < dstEnd) ? 4 : 5;
	
	return new Date(utcAsEt + offset * 60 * 60 * 1000);
}

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
		
		var franchise = await Franchise.findOne({ rosterId: ft.rosterId });
		if (!franchise) {
			console.log('  ✗ Franchise ' + ft.rosterId + ' not found');
			errors.push('Franchise ' + ft.rosterId + ' not found');
		} else {
			console.log('  rosterId: ' + ft.rosterId + ' → ' + ft.newDisplayName);
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
		
		// Map rosterId → franchiseId for draft order
		if (sr.draftOrder) {
			console.log('  Draft order (rosterId → slot):');
			franchises.forEach(function(f) {
				var slot = sr.draftOrder[String(f.rosterId)];
				if (slot) {
					body['draftOrder_' + f._id.toString()] = String(slot);
					console.log('    ' + f.rosterId + ' → ' + slot);
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
	// Trade Contract Corrections
	// =========================================================================
	if (fixups.tradeContractCorrections && fixups.tradeContractCorrections.length > 0) {
		console.log('=== Trade Contract Corrections ===');
		
		for (var i = 0; i < fixups.tradeContractCorrections.length; i++) {
			var tcc = fixups.tradeContractCorrections[i];
			var trade = await Transaction.findOne({ type: 'trade', tradeId: tcc.tradeId });
			
			if (!trade) {
				console.log('  ✗ Trade #' + tcc.tradeId + ' not found');
				errors.push('Trade #' + tcc.tradeId + ' not found');
				continue;
			}
			
			// Find the player in the trade
			var player = await Player.findOne({ name: tcc.player });
			if (!player) {
				console.log('  ✗ Trade #' + tcc.tradeId + ': Player "' + tcc.player + '" not found');
				errors.push('Trade #' + tcc.tradeId + ': Player "' + tcc.player + '" not found');
				continue;
			}
			
			// Find and update the player entry in the trade
			var found = false;
			for (var p = 0; p < trade.parties.length; p++) {
				var party = trade.parties[p];
				for (var pl = 0; pl < (party.receives.players || []).length; pl++) {
					var playerEntry = party.receives.players[pl];
					if (playerEntry.playerId.toString() === player._id.toString()) {
						found = true;
						
						console.log('  Trade #' + tcc.tradeId + ': ' + tcc.player);
						console.log('    ' + (playerEntry.startYear || '?') + '/' + (playerEntry.endYear || '?') + 
							' → ' + tcc.startYear + '/' + tcc.endYear);
						
						if (!dryRun) {
							playerEntry.startYear = tcc.startYear;
							playerEntry.endYear = tcc.endYear;
							playerEntry.ambiguous = false;
						}
						break;
					}
				}
				if (found) break;
			}
			
			if (!found) {
				console.log('  ✗ Trade #' + tcc.tradeId + ': Player "' + tcc.player + '" not in trade');
				errors.push('Trade #' + tcc.tradeId + ': Player "' + tcc.player + '" not in trade');
				continue;
			}
			
			if (!dryRun) {
				await trade.save();
				console.log('    ✓ Done');
			}
		}
		console.log('');
	}

	// =========================================================================
	// Trade Player Corrections (swap wrong player for correct one)
	// =========================================================================
	if (fixups.tradePlayerCorrections && fixups.tradePlayerCorrections.length > 0) {
		console.log('=== Trade Player Corrections ===');
		
		for (var i = 0; i < fixups.tradePlayerCorrections.length; i++) {
			var tpc = fixups.tradePlayerCorrections[i];
			var trade = await Transaction.findOne({ type: 'trade', tradeId: tpc.tradeId });
			
			if (!trade) {
				console.log('  ✗ Trade #' + tpc.tradeId + ' not found');
				errors.push('Trade #' + tpc.tradeId + ' not found');
				continue;
			}
			
			// Find the wrong and correct players
			var wrongPlayer = await Player.findOne({ sleeperId: tpc.wrongSleeperId });
			var correctPlayer = await Player.findOne({ sleeperId: tpc.correctSleeperId });
			
			if (!wrongPlayer) {
				console.log('  ✗ Trade #' + tpc.tradeId + ': Wrong player (sleeperId ' + tpc.wrongSleeperId + ') not found');
				errors.push('Trade #' + tpc.tradeId + ': Wrong player not found');
				continue;
			}
			
			if (!correctPlayer) {
				console.log('  ✗ Trade #' + tpc.tradeId + ': Correct player (sleeperId ' + tpc.correctSleeperId + ') not found');
				errors.push('Trade #' + tpc.tradeId + ': Correct player not found');
				continue;
			}
			
			// Find and replace the player in the trade
			var found = false;
			for (var p = 0; p < trade.parties.length; p++) {
				var party = trade.parties[p];
				for (var pl = 0; pl < (party.receives.players || []).length; pl++) {
					var playerEntry = party.receives.players[pl];
					if (playerEntry.playerId.toString() === wrongPlayer._id.toString()) {
						found = true;
						
						console.log('  Trade #' + tpc.tradeId + ': ' + wrongPlayer.name + ' → ' + correctPlayer.name);
						if (tpc.notes) console.log('    (' + tpc.notes + ')');
						
						if (!dryRun) {
							playerEntry.playerId = correctPlayer._id;
						}
						break;
					}
				}
				if (found) break;
			}
			
			if (!found) {
				console.log('  ✗ Trade #' + tpc.tradeId + ': Player "' + wrongPlayer.name + '" not in trade');
				errors.push('Trade #' + tpc.tradeId + ': Player "' + wrongPlayer.name + '" not in trade');
				continue;
			}
			
			if (!dryRun) {
				await trade.save();
				console.log('    ✓ Done');
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
		if (pc.college !== undefined) {
			body.college = pc.college;
			console.log('    college: ' + pc.college);
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
	// Save modified fixup files
	// =========================================================================
	if (!dryRun) {
		if (fixupsModified) {
			saveFixups();
			console.log('Updated fixups.json\n');
		}
		saveSleeperFixups();
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
