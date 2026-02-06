/**
 * Seed 2008 initial auction transactions.
 * 
 * Uses two sources:
 * - results.html: who won each player at auction (auction-ufa transactions)
 * - contracts-2008.txt: who signed each player (contract transactions)
 * 
 * These differ for players traded before contracts were due (e.g., McGee).
 * 
 * Usage:
 *   docker compose run --rm -it web node data/seed/auction-2008.js
 *   docker compose run --rm -it web node data/seed/auction-2008.js --dry-run
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
var RosterState = require('../utils/roster-state');

mongoose.connect(process.env.MONGODB_URI);

var rosterState = new RosterState();

// 2008 auction was August 18, 2008 (9:00 AM ET = 13:00 UTC)
var AUCTION_TIMESTAMP = new Date(Date.UTC(2008, 7, 18, 13, 0, 0));

// Contract due date was August 24, 2008
// Use end of day to ensure auction-period trades (which have real timestamps) come before contracts
var CONTRACT_TIMESTAMP = new Date(Date.UTC(2008, 7, 24, 23, 59, 59));

var RESULTS_PATH = path.join(__dirname, '../archive/sources/html/results.html');
var SNAPSHOT_PATH = path.join(__dirname, '../archive/snapshots/contracts-2008.txt');

var rl = null;
var playersByNormalizedName = {};
var franchiseByOwnerName = {};
var dryRun = false;

/**
 * Normalize name for matching auction to contract.
 * Unlike resolver.normalizePlayerName, this KEEPS team suffixes like (CAR), (NYG)
 * since they're used for disambiguation.
 */
function normalizeForMatching(name) {
	if (!name) return '';
	return name
		.replace(/&#8217;/g, "'")
		.replace(/\s+(III|II|IV|V|Jr\.|Jr|Sr\.)$/i, '')
		.replace(/[^\w\s()]/g, '')
		.replace(/\s+/g, ' ')
		.trim()
		.toLowerCase();
}

/**
 * Parse auction results from results.html.
 * Returns array of { name, position, owner, price }
 */
function loadAuctionResults() {
	var html = fs.readFileSync(RESULTS_PATH, 'utf8');
	var rows = html.match(/<tr>[\s\S]*?<\/tr>/g) || [];
	var results = [];
	
	for (var i = 0; i < rows.length; i++) {
		var row = rows[i];
		var cells = row.match(/<td>([\s\S]*?)<\/td>/g) || [];
		if (cells.length < 6) continue;
		
		// Extract cell contents, stripping HTML tags
		var name = cells[1].replace(/<[^>]*>/g, '').trim();
		var position = cells[2].replace(/<[^>]*>/g, '').trim();
		var owner = cells[4].replace(/<[^>]*>/g, '').trim();
		var price = parseInt(cells[5].replace(/<[^>]*>/g, '').replace('$', '').trim()) || 0;
		
		if (name && owner && price > 0) {
			results.push({ name: name, position: position, owner: owner, price: price });
		}
	}
	
	return results;
}

/**
 * Parse contract snapshot from contracts-2008.txt.
 * Returns map of normalized name -> { owner, startYear, endYear, salary }
 */
function loadContracts() {
	var content = fs.readFileSync(SNAPSHOT_PATH, 'utf8');
	var lines = content.trim().split('\n');
	var contracts = {};
	
	for (var i = 1; i < lines.length; i++) {
		var parts = lines[i].split(',');
		if (parts.length < 7) continue;
		
		var name = parts[2].trim();
		var normalized = normalizeForMatching(name);
		
		contracts[normalized] = {
			name: name,
			owner: parts[1].trim(),
			startYear: parseInt(parts[4]) || 2008,
			endYear: parseInt(parts[5]) || 2008,
			salary: parseInt(parts[6].replace('$', '')) || 0
		};
	}
	
	return contracts;
}

/**
 * Resolve a player to a database Player document.
 */
async function resolvePlayer(entry) {
	var context = {
		year: 2008,
		type: 'auction',
		franchise: entry.owner,
		position: entry.position
	};
	
	var normalizedName = resolver.normalizePlayerName(entry.name);
	var candidates = playersByNormalizedName[normalizedName] || [];
	
	// Check cache first
	var cached = resolver.lookup(entry.name, context);
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
	
	// Filter by position if we have multiple candidates
	if (candidates.length > 1 && entry.position) {
		var positionFiltered = candidates.filter(function(c) {
			return c.positions && c.positions.some(function(p) {
				return p === entry.position || 
					(entry.position === 'DL' && (p === 'DE' || p === 'DT')) ||
					(entry.position === 'DB' && (p === 'CB' || p === 'S' || p === 'FS' || p === 'SS'));
			});
		});
		if (positionFiltered.length === 1) {
			return positionFiltered[0];
		}
	}
	
	// No candidates - create historical player
	if (candidates.length === 0) {
		console.log('  Creating historical player: ' + entry.name + ' (' + entry.position + ')');
		
		if (dryRun) {
			return { _id: 'dry-run-id', name: entry.name, positions: [entry.position] };
		}
		
		var player = await Player.create({
			name: entry.name,
			positions: entry.position ? [entry.position] : [],
			sleeperId: null
		});
		
		if (!playersByNormalizedName[normalizedName]) {
			playersByNormalizedName[normalizedName] = [];
		}
		playersByNormalizedName[normalizedName].push(player);
		
		resolver.addResolution(entry.name, null, entry.name, context);
		return player;
	}
	
	// Multiple candidates - prompt
	var result = await resolver.promptForPlayer({
		name: entry.name,
		context: context,
		candidates: candidates,
		position: entry.position,
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
	
	console.log('=== 2008 Initial Auction Seeder ===');
	console.log('Auction date:', AUCTION_TIMESTAMP.toISOString());
	if (dryRun) console.log('[DRY RUN]');
	console.log('');
	
	console.log('Loaded', resolver.count(), 'cached player resolutions');
	
	rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout
	});
	
	// Load all players from database
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
	
	// Load auction results and contracts
	var auctionResults = loadAuctionResults();
	var contracts = loadContracts();
	console.log('Loaded', auctionResults.length, 'auction results from results.html');
	console.log('Loaded', Object.keys(contracts).length, 'contracts from snapshot');
	console.log('');
	
	// Check for existing transactions
	var existingAuction = await Transaction.countDocuments({
		type: 'auction-ufa',
		timestamp: AUCTION_TIMESTAMP
	});
	var existingContract = await Transaction.countDocuments({
		type: 'contract',
		timestamp: CONTRACT_TIMESTAMP
	});
	
	if (existingAuction + existingContract > 0) {
		console.log('Found', existingAuction, 'auction +', existingContract, 'contract transactions from 2008.');
		var answer = await new Promise(function(resolve) {
			rl.question('Clear them and re-seed? [y/N] ', resolve);
		});
		
		if (answer.toLowerCase() === 'y') {
			console.log('Clearing...');
			if (!dryRun) {
				await Transaction.deleteMany({
					$or: [
						{ type: 'auction-ufa', timestamp: AUCTION_TIMESTAMP },
						{ type: 'contract', timestamp: CONTRACT_TIMESTAMP }
					]
				});
			}
		} else {
			console.log('Aborting.');
			rl.close();
			process.exit(0);
		}
	}
	
	// Process each auction result
	var auctionCount = 0;
	var contractCount = 0;
	var errors = [];
	
	for (var i = 0; i < auctionResults.length; i++) {
		var auction = auctionResults[i];
		var matchingKey = normalizeForMatching(auction.name);
		
		// Get contract info (may be different owner if traded before deadline)
		var contract = contracts[matchingKey];
		if (!contract) {
			errors.push({ player: auction.name, reason: 'No contract found in snapshot' });
			continue;
		}
		
		// Resolve franchise for auction winner
		var auctionFranchiseId = franchiseByOwnerName[auction.owner];
		if (!auctionFranchiseId) {
			errors.push({ player: auction.name, reason: 'Unknown auction owner: ' + auction.owner });
			continue;
		}
		
		// Resolve franchise for contract holder
		var contractFranchiseId = franchiseByOwnerName[contract.owner];
		if (!contractFranchiseId) {
			errors.push({ player: auction.name, reason: 'Unknown contract owner: ' + contract.owner });
			continue;
		}
		
		// Resolve player
		var player;
		try {
			player = await resolvePlayer(auction);
		} catch (err) {
			if (err.message === 'User quit') {
				console.log('\nQuitting...');
				break;
			}
			throw err;
		}
		
		if (!player) {
			errors.push({ player: auction.name, reason: 'Could not resolve player' });
			continue;
		}
		
		// Log if auction winner differs from contract holder
		if (auction.owner !== contract.owner) {
			console.log('  ' + auction.name + ': auctioned to ' + auction.owner + ', signed by ' + contract.owner);
		}
		
		// Create auction-ufa transaction (to auction winner)
		if (!dryRun) {
			await Transaction.create({
				type: 'auction-ufa',
				timestamp: AUCTION_TIMESTAMP,
				source: 'snapshot',
				franchiseId: auctionFranchiseId,
				playerId: player._id,
				winningBid: auction.price
			});
		}
		auctionCount++;
		
		// Create contract transaction (to contract holder)
		if (!dryRun) {
			await Transaction.create({
				type: 'contract',
				timestamp: CONTRACT_TIMESTAMP,
				source: 'snapshot',
				franchiseId: contractFranchiseId,
				playerId: player._id,
				salary: contract.salary,
				startYear: contract.startYear,
				endYear: contract.endYear
			});
		}
		contractCount++;
		
		// Record in roster state (auction winner initially has player)
		rosterState.acquire(player._id, player.name, auctionFranchiseId);
		
		if ((i + 1) % 50 === 0) {
			console.log('  Processed', i + 1, '/', auctionResults.length, '...');
		}
	}
	
	resolver.save();
	
	console.log('');
	console.log('=== Done ===');
	console.log('Created:', auctionCount, 'auction-ufa transactions');
	console.log('Created:', contractCount, 'contract transactions');
	
	var stats = rosterState.getStats();
	console.log('');
	console.log('Roster state after 2008 auction:');
	console.log('  Total players tracked:', stats.total);
	console.log('  Rostered:', stats.rostered);
	
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
