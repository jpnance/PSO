/**
 * Seed 2008 midseason FA transactions.
 * 
 * Infers cuts and pickups by comparing:
 * - Auction results (who was rostered after auction)
 * - teams.xls postseason 2008 snapshot (who was rostered at end of season)
 * 
 * Players in auction but not in postseason = cut
 * Players in postseason with FA/2008 contract = FA pickup
 * 
 * Usage:
 *   docker compose run --rm web node data/seed/fa-2008.js
 *   docker compose run --rm web node data/seed/fa-2008.js --dry-run
 */

var dotenv = require('dotenv').config({ path: __dirname + '/../../.env' });
var mongoose = require('mongoose');
var fs = require('fs');
var path = require('path');
var readline = require('readline');

var Franchise = require('../../models/Franchise');
var Player = require('../../models/Player');
var Regime = require('../../models/Regime');
var Transaction = require('../../models/Transaction');
var resolver = require('../utils/player-resolver');

mongoose.connect(process.env.MONGODB_URI);

// First Thursday of October 2008, 12:00:33 ET (EDT = UTC-4)
var MIDSEASON_TIMESTAMP = new Date(Date.UTC(2008, 9, 2, 16, 0, 33));

// Drops happen 1 second before pickups to ensure correct ordering
var DROP_TIMESTAMP = new Date(MIDSEASON_TIMESTAMP.getTime() - 1000);
var PICKUP_TIMESTAMP = MIDSEASON_TIMESTAMP;

var RESULTS_PATH = path.join(__dirname, '../archive/sources/html/results.html');
var EXTRACTED_PATH = path.join(__dirname, '../archive/snapshots/extracted-all.csv');
var TRADES_PATH = path.join(__dirname, '../trades/trades.json');

var rl = null;
var playersByNormalizedName = {};
var franchiseByOwnerName = {};
var dryRun = false;

/**
 * Normalize a name for matching (lowercase, alphanumeric only).
 */
function normalizeName(name) {
	return name.toLowerCase().replace(/[^a-z]/g, '');
}

/**
 * Load 2008 trades and build a map of players received via trade.
 * Returns { normalizedName: { receivedBy: owner, tradedFrom: owner } }
 */
function loadTradeRecipients() {
	var content = fs.readFileSync(TRADES_PATH, 'utf8');
	var allTrades = JSON.parse(content);
	var recipients = {};
	
	var trades2008 = allTrades.filter(function(t) {
		return t.date && t.date.startsWith('2008');
	});
	
	trades2008.forEach(function(trade) {
		trade.parties.forEach(function(party) {
			// Find the other party (the sender)
			var otherParty = trade.parties.find(function(p) {
				return p.owner !== party.owner;
			});
			
			party.players.forEach(function(player) {
				var normalized = normalizeName(player.name);
				recipients[normalized] = {
					receivedBy: party.owner,
					tradedFrom: otherParty ? otherParty.owner : null
				};
			});
		});
	});
	
	return recipients;
}

/**
 * Parse auction results to get original owners.
 */
function loadAuctionResults() {
	var html = fs.readFileSync(RESULTS_PATH, 'utf8');
	var rows = html.match(/<tr>[\s\S]*?<\/tr>/g) || [];
	var results = {};
	
	for (var i = 0; i < rows.length; i++) {
		var row = rows[i];
		var cells = row.match(/<td>([\s\S]*?)<\/td>/g) || [];
		if (cells.length < 6) continue;
		
		var name = cells[1].replace(/<[^>]*>/g, '').trim();
		var position = cells[2].replace(/<[^>]*>/g, '').trim();
		var owner = cells[4].replace(/<[^>]*>/g, '').trim();
		var price = parseInt(cells[5].replace(/<[^>]*>/g, '').replace('$', '').trim()) || 0;
		
		if (name && owner && price > 0) {
			results[normalizeName(name)] = { name: name, position: position, owner: owner, price: price };
		}
	}
	
	return results;
}

/**
 * Parse postseason 2008 state from teams.xls rows in extracted-all.csv.
 */
function loadPostseason() {
	var content = fs.readFileSync(EXTRACTED_PATH, 'utf8');
	var lines = content.split('\n');
	var postseason = {};
	
	for (var i = 0; i < lines.length; i++) {
		var line = lines[i];
		if (!line.startsWith('teams.xls,2008')) continue;
		
		var parts = line.split(',');
		var owner = parts[3];
		var name = parts[4];
		var position = parts[5];
		var startYear = parts[6];
		var endYear = parts[7];
		var salary = parseInt(parts[8]) || 1;
		
		var isFA = startYear === 'FA';
		
		postseason[normalizeName(name)] = {
			name: name,
			owner: owner,
			position: position,
			isFA: isFA,
			startYear: isFA ? null : parseInt(startYear),
			endYear: parseInt(endYear),
			salary: salary
		};
	}
	
	return postseason;
}

/**
 * Resolve a player to a database Player document.
 */
async function resolvePlayer(name, position, owner) {
	var context = {
		year: 2008,
		type: 'fa',
		franchise: owner,
		position: position
	};
	
	var normalizedName = resolver.normalizePlayerName(name);
	var candidates = playersByNormalizedName[normalizedName] || [];
	
	// Check cache first
	var cached = resolver.lookup(name, context);
	if (cached && cached.sleeperId) {
		var player = await Player.findOne({ sleeperId: cached.sleeperId });
		if (player) return player;
	}
	if (cached && cached.name) {
		var player = await Player.findOne({ name: cached.name, sleeperId: null });
		if (player) return player;
	}
	
	// Single non-ambiguous match
	if (candidates.length === 1 && !resolver.isAmbiguous(normalizedName)) {
		return candidates[0];
	}
	
	// Filter by position
	if (candidates.length > 1 && position) {
		var positionFiltered = candidates.filter(function(c) {
			return c.positions && c.positions.some(function(p) {
				return p === position || 
					(position === 'DL' && (p === 'DE' || p === 'DT')) ||
					(position === 'DB' && (p === 'CB' || p === 'S' || p === 'FS' || p === 'SS')) ||
					(position === 'DL/LB' && (p === 'DE' || p === 'DT' || p === 'LB'));
			});
		});
		if (positionFiltered.length === 1) {
			return positionFiltered[0];
		}
	}
	
	// No candidates - create historical player
	if (candidates.length === 0) {
		console.log('  Creating historical player: ' + name + ' (' + position + ')');
		
		if (dryRun) {
			return { _id: 'dry-run-id', name: name, positions: [position] };
		}
		
		var positions = position ? position.split('/') : [];
		var player = await Player.create({
			name: name,
			positions: positions,
			sleeperId: null
		});
		
		if (!playersByNormalizedName[normalizedName]) {
			playersByNormalizedName[normalizedName] = [];
		}
		playersByNormalizedName[normalizedName].push(player);
		
		resolver.addResolution(name, null, name, context);
		return player;
	}
	
	// Multiple candidates - prompt
	var result = await resolver.promptForPlayer({
		name: name,
		context: context,
		candidates: candidates,
		position: position,
		Player: Player,
		rl: rl,
		playerCache: playersByNormalizedName,
		autoHistorical: true
	});
	
	if (result.action === 'quit') {
		throw new Error('User quit');
	}
	
	return result.player;
}

async function run() {
	dryRun = process.argv.includes('--dry-run');
	
	console.log('=== 2008 Midseason FA Seeder ===');
	console.log('Timestamp:', MIDSEASON_TIMESTAMP.toISOString());
	if (dryRun) console.log('[DRY RUN]');
	console.log('');
	
	console.log('Loaded', resolver.count(), 'cached player resolutions');
	
	rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout
	});
	
	// Load players from database
	var allPlayers = await Player.find({});
	allPlayers.forEach(function(p) {
		var normalized = resolver.normalizePlayerName(p.name);
		if (!playersByNormalizedName[normalized]) {
			playersByNormalizedName[normalized] = [];
		}
		playersByNormalizedName[normalized].push(p);
	});
	console.log('Loaded', allPlayers.length, 'players from database');
	
	// Load franchise mappings for 2008
	var regimes = await Regime.find({});
	regimes.forEach(function(r) {
		var tenure = r.tenures.find(function(t) {
			return t.startSeason <= 2008 && (t.endSeason === null || t.endSeason >= 2008);
		});
		if (tenure) {
			franchiseByOwnerName[r.displayName] = tenure.franchiseId;
		}
	});
	console.log('Loaded', Object.keys(franchiseByOwnerName).length, 'franchise mappings for 2008');
	
	// Load data
	var auctionResults = loadAuctionResults();
	var postseason = loadPostseason();
	console.log('Loaded', Object.keys(auctionResults).length, 'auction results');
	console.log('Loaded', Object.keys(postseason).length, 'postseason players');
	console.log('');
	
	// Check for existing FA transactions at these timestamps
	var existingFA = await Transaction.countDocuments({
		type: 'fa',
		timestamp: { $in: [DROP_TIMESTAMP, PICKUP_TIMESTAMP] }
	});
	
	if (existingFA > 0) {
		console.log('Found', existingFA, 'existing FA transactions at these timestamps.');
		var answer = await new Promise(function(resolve) {
			rl.question('Clear them and re-seed? [y/N] ', resolve);
		});
		
		if (answer.toLowerCase() === 'y') {
			console.log('Clearing...');
			if (!dryRun) {
				await Transaction.deleteMany({
					type: 'fa',
					timestamp: { $in: [DROP_TIMESTAMP, PICKUP_TIMESTAMP] }
				});
			}
		} else {
			console.log('Aborting.');
			rl.close();
			process.exit(0);
		}
	}
	
	// Find cuts: players in auction but not in postseason (or in postseason as FA with different owner)
	var cuts = [];
	var cutThenResigned = [];
	
	for (var key in auctionResults) {
		var auction = auctionResults[key];
		var post = postseason[key];
		
		if (!post) {
			// Not in postseason at all = cut
			cuts.push({
				name: auction.name,
				position: auction.position,
				fromOwner: auction.owner
			});
		} else if (post.isFA && post.owner !== auction.owner) {
			// In postseason as FA with different owner = cut then re-signed by someone else
			cutThenResigned.push({
				name: auction.name,
				position: auction.position,
				fromOwner: auction.owner,
				toOwner: post.owner,
				salary: post.salary
			});
		}
	}
	
	// Load trade recipients to attribute FA pickups correctly
	var tradeRecipients = loadTradeRecipients();
	
	// Find FA pickups: players in postseason with FA/2008 who weren't in auction
	var faPickups = [];
	
	for (var key in postseason) {
		var post = postseason[key];
		if (post.isFA) {
			var wasAuctioned = auctionResults[key];
			if (!wasAuctioned) {
				// Check if this player was received via trade
				var tradeInfo = tradeRecipients[key];
				var actualPickupOwner = post.owner;
				
				if (tradeInfo && tradeInfo.receivedBy === post.owner && tradeInfo.tradedFrom) {
					// Player was received via trade, so the FA pickup was by the trader
					actualPickupOwner = tradeInfo.tradedFrom;
					console.log('  ' + post.name + ': FA pickup attributed to ' + actualPickupOwner + ' (traded to ' + post.owner + ')');
				}
				
				faPickups.push({
					name: post.name,
					position: post.position,
					toOwner: actualPickupOwner,
					salary: post.salary
				});
			}
		}
	}
	
	console.log('Found', cuts.length, 'cuts (not re-signed)');
	console.log('Found', cutThenResigned.length, 'cut then re-signed by different owner');
	console.log('Found', faPickups.length, 'new FA pickups');
	console.log('');
	
	var created = 0;
	var errors = [];
	
	// Process cuts (drops only)
	console.log('Processing cuts...');
	for (var i = 0; i < cuts.length; i++) {
		var cut = cuts[i];
		
		var franchiseId = franchiseByOwnerName[cut.fromOwner];
		if (!franchiseId) {
			errors.push({ player: cut.name, reason: 'Unknown owner: ' + cut.fromOwner });
			continue;
		}
		
		var player;
		try {
			player = await resolvePlayer(cut.name, cut.position, cut.fromOwner);
		} catch (err) {
			if (err.message === 'User quit') {
				console.log('\nQuitting...');
				rl.close();
				process.exit(0);
			}
			throw err;
		}
		
		if (!player) {
			errors.push({ player: cut.name, reason: 'Could not resolve player' });
			continue;
		}
		
		if (!dryRun) {
			await Transaction.create({
				type: 'fa',
				timestamp: DROP_TIMESTAMP,
				source: 'snapshot',
				franchiseId: franchiseId,
				adds: [],
				drops: [{ playerId: player._id }]
			});
		}
		created++;
	}
	
	// Process cut-then-re-signed (drop from one, add to another)
	console.log('Processing cut then re-signed...');
	for (var i = 0; i < cutThenResigned.length; i++) {
		var ctr = cutThenResigned[i];
		
		var fromFranchiseId = franchiseByOwnerName[ctr.fromOwner];
		var toFranchiseId = franchiseByOwnerName[ctr.toOwner];
		
		if (!fromFranchiseId) {
			errors.push({ player: ctr.name, reason: 'Unknown from owner: ' + ctr.fromOwner });
			continue;
		}
		if (!toFranchiseId) {
			errors.push({ player: ctr.name, reason: 'Unknown to owner: ' + ctr.toOwner });
			continue;
		}
		
		var player;
		try {
			player = await resolvePlayer(ctr.name, ctr.position, ctr.toOwner);
		} catch (err) {
			if (err.message === 'User quit') {
				console.log('\nQuitting...');
				rl.close();
				process.exit(0);
			}
			throw err;
		}
		
		if (!player) {
			errors.push({ player: ctr.name, reason: 'Could not resolve player' });
			continue;
		}
		
		// Create drop transaction (1 second before pickup)
		if (!dryRun) {
			await Transaction.create({
				type: 'fa',
				timestamp: DROP_TIMESTAMP,
				source: 'snapshot',
				franchiseId: fromFranchiseId,
				adds: [],
				drops: [{ playerId: player._id }]
			});
		}
		created++;
		
		// Create add transaction
		if (!dryRun) {
			await Transaction.create({
				type: 'fa',
				timestamp: PICKUP_TIMESTAMP,
				source: 'snapshot',
				franchiseId: toFranchiseId,
				adds: [{ playerId: player._id, salary: ctr.salary, startYear: null, endYear: 2008 }],
				drops: []
			});
		}
		created++;
	}
	
	// Process new FA pickups
	console.log('Processing FA pickups...');
	for (var i = 0; i < faPickups.length; i++) {
		var pickup = faPickups[i];
		
		var franchiseId = franchiseByOwnerName[pickup.toOwner];
		if (!franchiseId) {
			errors.push({ player: pickup.name, reason: 'Unknown owner: ' + pickup.toOwner });
			continue;
		}
		
		var player;
		try {
			player = await resolvePlayer(pickup.name, pickup.position, pickup.toOwner);
		} catch (err) {
			if (err.message === 'User quit') {
				console.log('\nQuitting...');
				rl.close();
				process.exit(0);
			}
			throw err;
		}
		
		if (!player) {
			errors.push({ player: pickup.name, reason: 'Could not resolve player' });
			continue;
		}
		
		if (!dryRun) {
			await Transaction.create({
				type: 'fa',
				timestamp: PICKUP_TIMESTAMP,
				source: 'snapshot',
				franchiseId: franchiseId,
				adds: [{ playerId: player._id, salary: pickup.salary, startYear: null, endYear: 2008 }],
				drops: []
			});
		}
		created++;
	}
	
	resolver.save();
	
	console.log('');
	console.log('=== Done ===');
	console.log('Created:', created, 'FA transactions');
	
	if (errors.length > 0) {
		console.log('');
		console.log('Errors:', errors.length);
		errors.forEach(function(e) {
			console.log('  -', e.player + ':', e.reason);
		});
	}
	
	rl.close();
	process.exit(0);
}

run().catch(function(err) {
	console.error('Error:', err);
	if (rl) rl.close();
	process.exit(1);
});
