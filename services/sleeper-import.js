var fs = require('fs');
var path = require('path');
var Player = require('../models/Player');
var Franchise = require('../models/Franchise');
var Transaction = require('../models/Transaction');

var SLEEPER_DATA_DIR = path.join(__dirname, '../data/sleeper');

// Get list of available transaction files
function getAvailableYears() {
	if (!fs.existsSync(SLEEPER_DATA_DIR)) {
		return [];
	}
	
	var files = fs.readdirSync(SLEEPER_DATA_DIR);
	var years = [];
	
	files.forEach(function(file) {
		var match = file.match(/^transactions-(\d{4})\.json$/);
		if (match) {
			years.push(parseInt(match[1]));
		}
	});
	
	return years.sort(function(a, b) { return b - a; }); // Newest first
}

// Load transactions from file
function loadTransactionsFromFile(year) {
	var filePath = path.join(SLEEPER_DATA_DIR, 'transactions-' + year + '.json');
	
	if (!fs.existsSync(filePath)) {
		throw new Error('No transaction file found for ' + year);
	}
	
	var fileContent = fs.readFileSync(filePath, 'utf8');
	var jsonData = JSON.parse(fileContent);
	
	// Extract transactions array from various formats
	if (jsonData.data && jsonData.data.league_transactions_filtered) {
		return jsonData.data.league_transactions_filtered;
	} else if (Array.isArray(jsonData)) {
		return jsonData;
	} else {
		throw new Error('Could not find transactions array in file');
	}
}

// Map Sleeper transaction types to PSO types
function mapTransactionType(sleeperTx) {
	var type = sleeperTx.type;
	var hasAdds = sleeperTx.adds && Object.keys(sleeperTx.adds).length > 0;
	var hasDrops = sleeperTx.drops && Object.keys(sleeperTx.drops).length > 0;

	if (type === 'trade') {
		return 'trade';
	}

	if (type === 'commissioner') {
		return 'commissioner';
	}

	if (type === 'waiver' || type === 'free_agent') {
		if (hasAdds && hasDrops) {
			return 'fa-swap';
		}
		if (hasAdds) {
			return 'fa-pickup';
		}
		if (hasDrops) {
			return 'fa-cut';
		}
	}

	return 'unknown';
}

// Parse a single Sleeper transaction
function parseTransaction(sleeperTx, playerMap, franchiseMap) {
	var issues = [];
	var psoType = mapTransactionType(sleeperTx);

	var timestamp = new Date(sleeperTx.created);
	var statusUpdated = sleeperTx.status_updated ? new Date(sleeperTx.status_updated) : null;

	// Parse adds
	var adds = [];
	if (sleeperTx.adds) {
		for (var sleeperId in sleeperTx.adds) {
			var rosterId = sleeperTx.adds[sleeperId];
			var playerInfo = sleeperTx.player_map ? sleeperTx.player_map[sleeperId] : null;
			var psoPlayer = playerMap[sleeperId];
			var franchise = franchiseMap[rosterId];

			var add = {
				sleeperId: sleeperId,
				rosterId: rosterId,
				sleeperName: playerInfo ? playerInfo.first_name + ' ' + playerInfo.last_name : 'Unknown',
				sleeperPosition: playerInfo ? playerInfo.position : null,
				psoPlayer: psoPlayer || null,
				franchise: franchise || null
			};

			if (!psoPlayer) {
				issues.push('Player not found: ' + add.sleeperName + ' (Sleeper ID: ' + sleeperId + ')');
			}
			if (!franchise) {
				issues.push('Franchise not found for roster ID: ' + rosterId);
			}

			adds.push(add);
		}
	}

	// Parse drops
	var drops = [];
	if (sleeperTx.drops) {
		for (var sleeperId in sleeperTx.drops) {
			var rosterId = sleeperTx.drops[sleeperId];
			var playerInfo = sleeperTx.player_map ? sleeperTx.player_map[sleeperId] : null;
			var psoPlayer = playerMap[sleeperId];
			var franchise = franchiseMap[rosterId];

			var drop = {
				sleeperId: sleeperId,
				rosterId: rosterId,
				sleeperName: playerInfo ? playerInfo.first_name + ' ' + playerInfo.last_name : 'Unknown',
				sleeperPosition: playerInfo ? playerInfo.position : null,
				psoPlayer: psoPlayer || null,
				franchise: franchise || null
			};

			if (!psoPlayer) {
				issues.push('Player not found: ' + drop.sleeperName + ' (Sleeper ID: ' + sleeperId + ')');
			}
			if (!franchise) {
				issues.push('Franchise not found for roster ID: ' + rosterId);
			}

			drops.push(drop);
		}
	}

	// Parse waiver bid if present
	var waiverBid = null;
	if (sleeperTx.settings && sleeperTx.settings.waiver_bid !== undefined) {
		waiverBid = sleeperTx.settings.waiver_bid;
	}

	// Determine season from timestamp
	var seasonYear = timestamp.getFullYear();
	if (timestamp.getMonth() < 7) {
		seasonYear = seasonYear - 1;
	}

	return {
		sleeperTxId: sleeperTx.transaction_id,
		sleeperType: sleeperTx.type,
		psoType: psoType,
		timestamp: timestamp,
		statusUpdated: statusUpdated,
		leg: sleeperTx.leg,
		season: seasonYear,
		adds: adds,
		drops: drops,
		waiverBid: waiverBid,
		rosterIds: sleeperTx.roster_ids || [],
		issues: issues,
		hasIssues: issues.length > 0,
		raw: sleeperTx
	};
}

// Find the trade that matches a commissioner action based on players involved
// Requires EXACT bidirectional match: all Sleeper players in trade AND all trade players in Sleeper
// Also requires trade to be within the same season (Aug year N to Jul year N+1)
function findMatchingTrade(commissionerTx, trades, playerMap) {
	// Get all player ObjectIds from the commissioner action
	var sleeperPlayerIds = new Set();
	var sleeperPlayerNames = [];
	
	commissionerTx.adds.forEach(function(add) {
		if (add.psoPlayer && add.psoPlayer._id) {
			sleeperPlayerIds.add(add.psoPlayer._id.toString());
			sleeperPlayerNames.push(add.psoPlayer.name);
		}
	});
	
	commissionerTx.drops.forEach(function(drop) {
		if (drop.psoPlayer && drop.psoPlayer._id) {
			sleeperPlayerIds.add(drop.psoPlayer._id.toString());
			sleeperPlayerNames.push(drop.psoPlayer.name);
		}
	});
	
	// Store debug info
	commissionerTx.debugPlayerNames = sleeperPlayerNames;
	commissionerTx.debugPlayerCount = sleeperPlayerIds.size;
	
	// Need at least one player to match
	if (sleeperPlayerIds.size === 0) {
		return null;
	}
	
	// Determine the season of the Sleeper transaction
	var txDate = commissionerTx.timestamp;
	var txSeason = txDate.getFullYear();
	if (txDate.getMonth() < 7) { // Before August = previous season
		txSeason = txSeason - 1;
	}
	
	// Sort trades by timestamp descending (most recent first)
	var sortedTrades = trades.slice().sort(function(a, b) {
		return new Date(b.timestamp) - new Date(a.timestamp);
	});
	
	// Find the most recent trade with EXACT bidirectional player match within same season
	for (var i = 0; i < sortedTrades.length; i++) {
		var trade = sortedTrades[i];
		var tradeDate = new Date(trade.timestamp);
		
		// Determine trade season
		var tradeSeason = tradeDate.getFullYear();
		if (tradeDate.getMonth() < 7) {
			tradeSeason = tradeSeason - 1;
		}
		
		// Must be same season
		if (tradeSeason !== txSeason) {
			continue;
		}
		
		// Collect all player IDs in this trade
		var tradePlayerIds = new Set();
		trade.parties.forEach(function(party) {
			if (party.receives && party.receives.players) {
				party.receives.players.forEach(function(p) {
					if (p.playerId) {
						tradePlayerIds.add(p.playerId.toString());
					}
				});
			}
		});
		
		// Skip if no players in trade
		if (tradePlayerIds.size === 0) {
			continue;
		}
		
		// Bidirectional check: sets must be identical
		if (sleeperPlayerIds.size !== tradePlayerIds.size) {
			continue;
		}
		
		var allSleeperInTrade = Array.from(sleeperPlayerIds).every(function(pid) {
			return tradePlayerIds.has(pid);
		});
		
		var allTradeInSleeper = Array.from(tradePlayerIds).every(function(pid) {
			return sleeperPlayerIds.has(pid);
		});
		
		if (allSleeperInTrade && allTradeInSleeper) {
			return {
				tradeId: trade.tradeId,
				timestamp: tradeDate,
				playerCount: tradePlayerIds.size
			};
		}
	}
	
	return null;
}

// Main parsing function
async function parseSleeperTransactions(year) {
	var transactions = loadTransactionsFromFile(year);

	// Load all players with sleeper IDs
	var players = await Player.find({ sleeperId: { $ne: null } }).lean();
	var playerMap = {};
	players.forEach(function(p) {
		playerMap[p.sleeperId] = p;
	});

	// Load all franchises
	var franchises = await Franchise.find({}).lean();
	var franchiseMap = {};
	franchises.forEach(function(f) {
		if (f.rosterId) {
			franchiseMap[f.rosterId] = f;
		}
	});

	// Parse each transaction
	var parsed = transactions.map(function(tx) {
		return parseTransaction(tx, playerMap, franchiseMap);
	});

	// Sort by timestamp (newest first)
	parsed.sort(function(a, b) {
		return b.timestamp - a.timestamp;
	});

	// Assign cluster IDs to transactions within 60s of each other
	var clusterId = 0;
	for (var i = 0; i < parsed.length; i++) {
		var tx = parsed[i];
		
		if (tx.clusterId === undefined) {
			// Start a new cluster
			tx.clusterId = clusterId;
			tx.clusterStart = true;
			
			// Find all transactions within 60s (looking forward since sorted newest first)
			for (var j = i + 1; j < parsed.length; j++) {
				var other = parsed[j];
				var timeDiff = Math.abs(tx.timestamp - other.timestamp);
				
				if (timeDiff <= 120000) { // 120 seconds
					other.clusterId = clusterId;
					other.clusterStart = false;
				} else {
					break; // No need to check further since sorted by time
				}
			}
			
			clusterId++;
		}
	}
	
	// Mark clusters with multiple transactions
	var clusterCounts = {};
	parsed.forEach(function(tx) {
		clusterCounts[tx.clusterId] = (clusterCounts[tx.clusterId] || 0) + 1;
	});
	parsed.forEach(function(tx) {
		tx.clusterSize = clusterCounts[tx.clusterId];
		tx.isMultiCluster = tx.clusterSize > 1;
	});

	// Load trades for commissioner action matching
	var trades = await Transaction.find({ type: 'trade' }).lean();
	
	// Match commissioner actions to trades based on players
	var commissionerTxs = parsed.filter(function(tx) { return tx.psoType === 'commissioner'; });
	for (var i = 0; i < commissionerTxs.length; i++) {
		var ctx = commissionerTxs[i];
		ctx.matchedTrade = findMatchingTrade(ctx, trades, playerMap);
		ctx.likelyTradeExecution = ctx.matchedTrade !== null;
	}

	// Compute stats
	var stats = {
		total: parsed.length,
		byType: {},
		bySeason: {},
		withIssues: 0,
		missingPlayers: new Set(),
		missingFranchises: new Set(),
		commissionerMatched: 0,
		commissionerUnmatched: 0
	};

	parsed.forEach(function(tx) {
		stats.byType[tx.psoType] = (stats.byType[tx.psoType] || 0) + 1;
		stats.bySeason[tx.season] = (stats.bySeason[tx.season] || 0) + 1;

		if (tx.hasIssues) {
			stats.withIssues++;
			tx.adds.concat(tx.drops).forEach(function(item) {
				if (!item.psoPlayer) {
					stats.missingPlayers.add(item.sleeperId + ':' + item.sleeperName);
				}
				if (!item.franchise) {
					stats.missingFranchises.add(item.rosterId);
				}
			});
		}
		
		if (tx.psoType === 'commissioner') {
			if (tx.likelyTradeExecution) {
				stats.commissionerMatched++;
			} else {
				stats.commissionerUnmatched++;
			}
		}
	});

	stats.missingPlayers = Array.from(stats.missingPlayers);
	stats.missingFranchises = Array.from(stats.missingFranchises);

	return {
		year: year,
		transactions: parsed,
		stats: stats,
		playerMapSize: Object.keys(playerMap).length,
		franchiseMapSize: Object.keys(franchiseMap).length
	};
}

// Main page - show available years
exports.importForm = async function(req, res) {
	var years = getAvailableYears();
	var selectedYear = req.query.year ? parseInt(req.query.year) : null;
	var result = null;
	var error = null;
	
	if (selectedYear) {
		try {
			result = await parseSleeperTransactions(selectedYear);
		} catch (err) {
			error = err.message;
		}
	}
	
	res.render('admin-sleeper-import', {
		years: years,
		selectedYear: selectedYear,
		result: result,
		error: error
	});
};

// Keep POST for backwards compatibility but redirect to GET
exports.parseTransactions = async function(req, res) {
	var year = req.body.year;
	res.redirect('/admin/sleeper-import?year=' + year);
};

// Save annotations back to the JSON file
exports.saveAnnotations = async function(req, res) {
	try {
		var year = req.body.year;
		var annotations = req.body.annotations; // { txId: disposition, ... }
		
		if (!year || !annotations) {
			return res.status(400).json({ success: false, error: 'Missing year or annotations' });
		}
		
		var filePath = path.join(SLEEPER_DATA_DIR, 'transactions-' + year + '.json');
		
		if (!fs.existsSync(filePath)) {
			return res.status(404).json({ success: false, error: 'File not found for year ' + year });
		}
		
		// Read current file
		var fileContent = fs.readFileSync(filePath, 'utf8');
		var jsonData = JSON.parse(fileContent);
		
		// Find transactions array
		var transactions;
		var isWrapped = false;
		if (jsonData.data && jsonData.data.league_transactions_filtered) {
			transactions = jsonData.data.league_transactions_filtered;
			isWrapped = true;
		} else if (Array.isArray(jsonData)) {
			transactions = jsonData;
		} else {
			return res.status(400).json({ success: false, error: 'Could not find transactions array' });
		}
		
		// Apply annotations
		var updated = 0;
		transactions.forEach(function(tx) {
			var txId = tx.transaction_id;
			if (annotations[txId] !== undefined) {
				var annotation = annotations[txId];
				
				if (!tx._pso) {
					tx._pso = {};
				}
				
				// Handle disposition
				if (annotation.disposition === '' || annotation.disposition === undefined) {
					delete tx._pso.disposition;
				} else {
					tx._pso.disposition = annotation.disposition;
				}
				
				// Handle facilitatesTradeId
				if (annotation.facilitatesTradeId) {
					tx._pso.facilitatesTradeId = annotation.facilitatesTradeId;
				} else {
					delete tx._pso.facilitatesTradeId;
				}
				
				// Clean up empty _pso object
				if (Object.keys(tx._pso).length === 0) {
					delete tx._pso;
				}
				
				updated++;
			}
		});
		
		// Write back
		fs.writeFileSync(filePath, JSON.stringify(jsonData, null, '\t'));
		
		res.json({ success: true, updated: updated });
	} catch (err) {
		res.status(500).json({ success: false, error: err.message });
	}
};
