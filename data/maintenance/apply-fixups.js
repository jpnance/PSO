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
	
	// Merge arrays (with source tracking)
	if (sleeperFixups.sleeperCutTradeLinks) {
		sleeperFixups.sleeperCutTradeLinks.forEach(function(link, idx) {
			link._sourceYear = year;
			link._sourceIndex = idx;
		});
		fixups.sleeperCutTradeLinks = (fixups.sleeperCutTradeLinks || []).concat(sleeperFixups.sleeperCutTradeLinks);
	}
	if (sleeperFixups.sleeperImports) {
		fixups.sleeperImports = (fixups.sleeperImports || []).concat(sleeperFixups.sleeperImports);
	}
	if (sleeperFixups.sleeperIgnored) {
		fixups.sleeperIgnored = (fixups.sleeperIgnored || []).concat(sleeperFixups.sleeperIgnored);
	}
	
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
	// Sleeper Cut → Trade Links
	// =========================================================================
	if (fixups.sleeperCutTradeLinks && fixups.sleeperCutTradeLinks.length > 0) {
		console.log('=== Sleeper Cut → Trade Links ===');
		
		// Load regimes for display name lookup
		var cutLinkRegimes = await Regime.find({}).lean();
		function getDisplayName(franchiseId) {
			for (var i = 0; i < cutLinkRegimes.length; i++) {
				var r = cutLinkRegimes[i];
				if (r.tenures) {
					for (var j = 0; j < r.tenures.length; j++) {
						var t = r.tenures[j];
						if (t.franchiseId && t.franchiseId.toString() === franchiseId.toString() && !t.endSeason) {
							return r.displayName;
						}
					}
				}
			}
			return 'Unknown';
		}
		
		for (var i = 0; i < fixups.sleeperCutTradeLinks.length; i++) {
			var link = fixups.sleeperCutTradeLinks[i];
			
			// Find the trade
			var trade = await Transaction.findOne({ type: 'trade', tradeId: link.facilitatesTradeId });
			if (!trade) {
				console.log('  ✗ Trade #' + link.facilitatesTradeId + ' not found');
				errors.push('Trade #' + link.facilitatesTradeId + ' not found');
				continue;
			}
			
			// Get franchise IDs and names involved in the trade
			var tradePartyIds = trade.parties.map(function(p) { return p.franchiseId; });
			var tradePartyNames = tradePartyIds.map(function(id) { return getDisplayName(id); }).join(' / ');
			
			var cut;
			
			if (link.fixupRef) {
				// Direct lookup by fixupRef
				cut = await Transaction.findOne({ type: 'fa', fixupRef: link.fixupRef });
				if (!cut) {
					console.log('  ✗ Cut fixupRef ' + link.fixupRef + ' not found');
					errors.push('Cut fixupRef ' + link.fixupRef + ' not found');
					continue;
				}
			} else {
				// Fuzzy matching by player
				var player = await Player.findOne({ sleeperId: link.sleeperId });
				if (!player) {
					console.log('  ✗ Player sleeperId ' + link.sleeperId + ' (' + link.playerName + ') not found');
					errors.push('Player sleeperId ' + link.sleeperId + ' not found');
					continue;
				}
				
				// Find cuts of this player in the same calendar year, by a trade party, that don't already have a facilitatedTradeId
				var sleeperYear = new Date(link.timestamp).getFullYear();
				var yearStart = new Date(sleeperYear, 0, 1);
				var yearEnd = new Date(sleeperYear + 1, 0, 1);
				
				var candidates = await Transaction.find({
					type: 'fa',
					'drops.playerId': player._id,
					franchiseId: { $in: tradePartyIds },
					facilitatedTradeId: null,
					timestamp: { $gte: yearStart, $lt: yearEnd }
				}).populate('franchiseId', 'displayName rosterId');
				
				if (candidates.length === 0) {
					console.log('  ⚠ No unlinked cuts found for ' + player.name + ' by ' + tradePartyNames + ' in ' + sleeperYear + ' (skipping)');
					continue;
				} else if (candidates.length === 1) {
					cut = candidates[0];
					// Save the fixupRef back for future runs
					if (link._sourceYear && sleeperFixupsByYear[link._sourceYear]) {
						sleeperFixupsByYear[link._sourceYear].data.sleeperCutTradeLinks[link._sourceIndex].fixupRef = cut.fixupRef;
						sleeperFixupsByYear[link._sourceYear].modified = true;
						console.log('    (saved fixupRef=' + cut.fixupRef + ')');
					}
				} else {
					// Ambiguous - need interactive resolution
					console.log('\n  ⚠️  Ambiguous: ' + candidates.length + ' cuts found for ' + player.name);
					console.log('      Trade #' + link.facilitatesTradeId + ' (' + tradePartyNames + ') at ' + link.timestamp);
					console.log('');
					candidates.forEach(function(c, idx) {
						var drop = c.drops && c.drops[0];
						var buyoutStr = drop && drop.buyOuts ? drop.buyOuts.map(function(b) { return b.season + ':$' + b.amount; }).join(', ') : '';
						var franchise = c.franchiseId ? c.franchiseId.displayName : '?';
						console.log('      ' + (idx + 1) + '. ' + franchise + ' cut on ' + c.timestamp.toISOString().slice(0, 10) +
							' (fixupRef=' + c.fixupRef + ', buyouts: ' + (buyoutStr || 'none') + ')');
					});
					console.log('      s. Skip this one');
					console.log('');
					
					var answer = await prompt('  Select (1-' + candidates.length + ' or s): ');
					
					if (answer.toLowerCase() === 's') {
						console.log('  → Skipped\n');
						continue;
					}
					
					var selection = parseInt(answer, 10);
					if (isNaN(selection) || selection < 1 || selection > candidates.length) {
						console.log('  → Invalid selection, skipping\n');
						continue;
					}
					
					cut = candidates[selection - 1];
					
					// Save the fixupRef back to the source file
					if (link._sourceYear && sleeperFixupsByYear[link._sourceYear]) {
						sleeperFixupsByYear[link._sourceYear].data.sleeperCutTradeLinks[link._sourceIndex].fixupRef = cut.fixupRef;
						sleeperFixupsByYear[link._sourceYear].modified = true;
						console.log('  → Selected fixupRef=' + cut.fixupRef + ' (saved to sleeper-fixups-' + link._sourceYear + '.json)\n');
					} else {
						fixups.sleeperCutTradeLinks[i].fixupRef = cut.fixupRef;
						fixupsModified = true;
						console.log('  → Selected fixupRef=' + cut.fixupRef + ' (saved to fixups.json)\n');
					}
				}
			}
			
			// Apply the update
			var cutPlayer = await Player.findById(cut.playerId);
			console.log('  Cut fixupRef=' + cut.fixupRef + ' (' + (cutPlayer ? cutPlayer.name : '?') + ') → Trade #' + link.facilitatesTradeId);
			
			if (!dryRun) {
				cut.facilitatedTradeId = trade._id;
				if (link.timestamp) {
					cut.timestamp = new Date(link.timestamp);
				}
				await cut.save();
				console.log('    ✓ Done');
			}
		}
		console.log('');
	}

	// =========================================================================
	// Sleeper Imports (FA transactions)
	// =========================================================================
	if (fixups.sleeperImports && fixups.sleeperImports.length > 0) {
		console.log('=== Sleeper Imports ===');
		
		// Load franchises with current regime display names
		var allFranchises = await Franchise.find({});
		var allRegimes = await Regime.find({}).populate('ownerIds', 'name');
		var franchiseByRosterId = {};
		
		allFranchises.forEach(function(f) {
			// Find current regime for this franchise (check tenures, not franchiseId on regime)
			var currentRegime = allRegimes.find(function(r) {
				return r.tenures && r.tenures.some(function(t) {
					return t.franchiseId && t.franchiseId.toString() === f._id.toString() && !t.endSeason;
				});
			});
			franchiseByRosterId[f.rosterId] = {
				_id: f._id,
				rosterId: f.rosterId,
				displayName: currentRegime ? currentRegime.displayName : ('Roster ' + f.rosterId)
			};
		});
		
		for (var i = 0; i < fixups.sleeperImports.length; i++) {
			var imp = fixups.sleeperImports[i];
			var timestamp = new Date(imp.timestamp);
			var season = timestamp.getFullYear();
			
			// Get franchise
			var franchise = franchiseByRosterId[imp.rosterId];
			if (!franchise) {
				console.log('  ✗ Roster ID ' + imp.rosterId + ' not found');
				errors.push('Roster ID ' + imp.rosterId + ' not found');
				continue;
			}
			
			if (imp.psoType === 'fa-cut') {
				// Drops only - find and update existing cut
				for (var d = 0; d < imp.drops.length; d++) {
					var drop = imp.drops[d];
					var player = await Player.findOne({ sleeperId: drop.sleeperId });
					if (!player) {
						console.log('  ✗ Player ' + drop.playerName + ' (sleeperId ' + drop.sleeperId + ') not found');
						errors.push('Player ' + drop.playerName + ' not found');
						continue;
					}
					
					// Find matching cut (same player, franchise, year, with placeholder timestamp)
					var yearStart = new Date(season, 0, 1);
					var yearEnd = new Date(season + 1, 0, 1);
					var cut = await Transaction.findOne({
						type: 'fa',
						'drops.playerId': player._id,
						franchiseId: franchise._id,
						timestamp: { $gte: yearStart, $lt: yearEnd }
					});
					
					if (!cut) {
						console.log('  ⚠ No cut found for ' + drop.playerName + ' by ' + franchise.displayName + ' in ' + season + ' (skipping)');
						continue;
					}
					
					console.log('  Cut: ' + drop.playerName + ' by ' + franchise.displayName + ' → ' + timestamp.toISOString().slice(0, 10));
					
					if (!dryRun) {
						cut.timestamp = timestamp;
						cut.source = 'sleeper';
						await cut.save();
						console.log('    ✓ Done');
					}
				}
				
			} else if (imp.psoType === 'fa-pickup') {
				// Adds only - create new FA transaction
				for (var a = 0; a < imp.adds.length; a++) {
					var add = imp.adds[a];
					var player = await Player.findOne({ sleeperId: add.sleeperId });
					if (!player) {
						console.log('  ✗ Player ' + add.playerName + ' (sleeperId ' + add.sleeperId + ') not found');
						errors.push('Player ' + add.playerName + ' not found');
						continue;
					}
					
					// Check if pickup already exists (idempotency)
					var existingPickup = await Transaction.findOne({
						type: 'fa',
						'adds.playerId': player._id,
						franchiseId: franchise._id,
						timestamp: timestamp
					});
					
					if (existingPickup) {
						console.log('  Pickup: ' + add.playerName + ' by ' + franchise.displayName + ' (already exists)');
					} else {
						console.log('  Pickup: ' + add.playerName + ' by ' + franchise.displayName + ' ($' + imp.salary + ' FA/' + (season % 100) + ')');
						
						if (!dryRun) {
							await Transaction.create({
								type: 'fa',
								timestamp: timestamp,
								source: 'sleeper',
								franchiseId: franchise._id,
								adds: [{
									playerId: player._id,
									salary: imp.salary,
									startYear: null,
									endYear: season
								}],
								drops: []
							});
							console.log('    ✓ Done');
						}
					}
				}
				
			} else if (imp.psoType === 'fa-swap') {
				// Add + drop - find the cut, delete it, create unified FA transaction
				if (imp.adds.length !== 1 || imp.drops.length !== 1) {
					console.log('  ✗ Swap with multiple adds/drops not supported: ' + imp.adds.length + ' adds, ' + imp.drops.length + ' drops');
					errors.push('Multi-player swap not supported');
					continue;
				}
				
				var add = imp.adds[0];
				var drop = imp.drops[0];
				
				var addPlayer = await Player.findOne({ sleeperId: add.sleeperId });
				var dropPlayer = await Player.findOne({ sleeperId: drop.sleeperId });
				
				if (!addPlayer) {
					console.log('  ✗ Player ' + add.playerName + ' (sleeperId ' + add.sleeperId + ') not found');
					errors.push('Player ' + add.playerName + ' not found');
					continue;
				}
				if (!dropPlayer) {
					console.log('  ✗ Player ' + drop.playerName + ' (sleeperId ' + drop.sleeperId + ') not found');
					errors.push('Player ' + drop.playerName + ' not found');
					continue;
				}
				
				// Find the existing cut for the dropped player
				var yearStart = new Date(season, 0, 1);
				var yearEnd = new Date(season + 1, 0, 1);
				var existingCut = await Transaction.findOne({
					type: 'fa',
					'drops.playerId': dropPlayer._id,
					franchiseId: franchise._id,
					timestamp: { $gte: yearStart, $lt: yearEnd }
				});
				
				if (!existingCut) {
					console.log('  ⚠ No cut found for ' + drop.playerName + ' by ' + franchise.displayName + ' in ' + season + ' (skipping swap)');
					continue;
				}
				
				// Get the drop info from the existing cut
				var existingDropInfo = existingCut.drops && existingCut.drops[0];
				
				// Check if swap already exists (idempotency)
				var existingSwap = await Transaction.findOne({
					type: 'fa',
					'adds.playerId': addPlayer._id,
					franchiseId: franchise._id,
					timestamp: timestamp
				});
				
				if (existingSwap) {
					console.log('  Swap: ' + franchise.displayName + ' adds ' + add.playerName + ', drops ' + drop.playerName + ' (already exists)');
				} else {
					console.log('  Swap: ' + franchise.displayName + ' adds ' + add.playerName + ' ($' + imp.salary + '), drops ' + drop.playerName);
					
					if (!dryRun) {
						// Delete the standalone cut
						await Transaction.deleteOne({ _id: existingCut._id });
						
						// Create unified FA transaction with add and drop
						await Transaction.create({
							type: 'fa',
							timestamp: timestamp,
							source: 'sleeper',
							franchiseId: franchise._id,
							adds: [{
								playerId: addPlayer._id,
								salary: imp.salary,
								startYear: null,
								endYear: season
							}],
							drops: [{
								playerId: dropPlayer._id,
								salary: existingDropInfo ? existingDropInfo.salary : null,
								startYear: existingDropInfo ? existingDropInfo.startYear : null,
								endYear: existingDropInfo ? existingDropInfo.endYear : null,
								buyOuts: existingDropInfo ? (existingDropInfo.buyOuts || []) : []
							}]
						});
						console.log('    ✓ Done');
					}
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
			console.log('Updated fixups.json with resolved fixupRefs\n');
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
