/**
 * Seed transactions from player-history.dsl
 * 
 * This script reads the DSL file and creates Transaction records.
 * 
 * Usage:
 *   docker compose run --rm -it web node data/seed/from-dsl.js
 *   docker compose run --rm -it web node data/seed/from-dsl.js --dry-run
 *   docker compose run --rm -it web node data/seed/from-dsl.js --player="Josh Allen"
 */

require('dotenv').config();

var mongoose = require('mongoose');
var fs = require('fs');
var path = require('path');

var Franchise = require('../../models/Franchise');
var Pick = require('../../models/Pick');
var Player = require('../../models/Player');
var Regime = require('../../models/Regime');
var Transaction = require('../../models/Transaction');

mongoose.connect(process.env.MONGODB_URI);

var DSL_FILE = path.join(__dirname, '../dsl/player-history.dsl');
var TRADES_FILE = path.join(__dirname, '../trades/trades.json');

// Cache maps
var playersBySleeperId = {};
var playersByName = {};
var franchiseByOwnerAndYear = {};  // "owner|year" -> franchiseId
var tradesById = {};

var dryRun = false;
var singlePlayer = null;
var stats = {
	players: 0,
	transactions: 0,
	errors: []
};

// =============================================================================
// DSL Parsing (simplified version of parse.js)
// =============================================================================

var PATTERNS = {
	auction: /^(\d{2})\s+auction\s+(\S+)\s+\$(\d+)(?:\s+(\d{2}|\w+)\/(\d{2}))?$/,
	auctionRfaMatched: /^(\d{2})\s+auction-rfa-matched\s+(\S+)\s+\$(\d+)\s+(\d{2}|\w+)\/(\d{2})$/,
	auctionRfaUnmatched: /^(\d{2})\s+auction-rfa-unmatched\s+(\S+)\s+\$(\d+)\s+(\d{2}|\w+)\/(\d{2})$/,
	draft: /^(\d{2})\s+draft\s+(\S+)\s+(\d+|\?)\.(\d+|\?\?)$/,
	fa: /^(\d{2})\s+fa\s+(\S+)(?:\s+\$(\d+))?(?:\s+(\d{2}|\w+)\/(\d{2}))?$/,
	trade: /^(\d{2})\s+trade\s+(\d+)\s+->\s+(\S+)$/,
	expansion: /^(\d{2})\s+expansion\s+(\S+)\s+from\s+(\S+)$/,
	protect: /^(\d{2})\s+protect\s+(\S+)(?:\s+\(RFA\))?$/,
	cut: /^(\d{2})\s+cut$/,
	contract: /^(\d{2})\s+contract(?:\s+\$(\d+))?\s+(\d{2}|\w+)\/(\d{2})$/,
	rfa: /^(\d{2})\s+rfa$/,
	lapsed: /^(\d{2})\s+lapsed$/,
	unknown: /^(\d{2})\s+unknown\s+(\S+)/
};

function toFullYear(yy) {
	var year = parseInt(yy);
	return year < 50 ? 2000 + year : 1900 + year;
}

function parseHeader(line) {
	var parts = line.split('|').map(function(p) { return p.trim(); });
	if (parts.length < 2) return null;
	
	var result = {
		name: parts[0],
		positions: parts[1].split('/').map(function(p) { return p.trim(); }),
		sleeperId: null,
		historical: false
	};
	
	for (var i = 2; i < parts.length; i++) {
		var part = parts[i];
		if (part.startsWith('sleeper:')) {
			result.sleeperId = part.replace('sleeper:', '');
		} else if (part === 'historical') {
			result.historical = true;
		}
	}
	
	return result;
}

function parseTransaction(line, lineNum) {
	line = line.trim();
	var match;
	
	// auction
	if ((match = line.match(PATTERNS.auction))) {
		return {
			type: 'auction',
			season: toFullYear(match[1]),
			owner: match[2],
			salary: parseInt(match[3]),
			startYear: match[4] ? (match[4] === 'FA' ? null : toFullYear(match[4])) : null,
			endYear: match[5] ? toFullYear(match[5]) : null,
			hasContract: !!match[4]
		};
	}
	
	// auction-rfa-matched
	if ((match = line.match(PATTERNS.auctionRfaMatched))) {
		return {
			type: 'auction-rfa-matched',
			season: toFullYear(match[1]),
			owner: match[2],
			salary: parseInt(match[3]),
			startYear: match[4] === 'FA' ? null : toFullYear(match[4]),
			endYear: toFullYear(match[5])
		};
	}
	
	// auction-rfa-unmatched
	if ((match = line.match(PATTERNS.auctionRfaUnmatched))) {
		return {
			type: 'auction-rfa-unmatched',
			season: toFullYear(match[1]),
			owner: match[2],
			salary: parseInt(match[3]),
			startYear: match[4] === 'FA' ? null : toFullYear(match[4]),
			endYear: toFullYear(match[5])
		};
	}
	
	// draft
	if ((match = line.match(PATTERNS.draft))) {
		return {
			type: 'draft',
			season: toFullYear(match[1]),
			owner: match[2],
			round: match[3] === '?' ? null : parseInt(match[3]),
			pick: match[4] === '??' ? null : parseInt(match[4])
		};
	}
	
	// fa
	if ((match = line.match(PATTERNS.fa))) {
		return {
			type: 'fa',
			season: toFullYear(match[1]),
			owner: match[2],
			salary: match[3] ? parseInt(match[3]) : null,
			startYear: match[4] ? (match[4] === 'FA' ? null : toFullYear(match[4])) : null,
			endYear: match[5] ? toFullYear(match[5]) : null
		};
	}
	
	// trade
	if ((match = line.match(PATTERNS.trade))) {
		return {
			type: 'trade',
			season: toFullYear(match[1]),
			tradeId: parseInt(match[2]),
			toOwner: match[3]
		};
	}
	
	// expansion
	if ((match = line.match(PATTERNS.expansion))) {
		return {
			type: 'expansion',
			season: toFullYear(match[1]),
			toOwner: match[2],
			fromOwner: match[3]
		};
	}
	
	// protect
	if ((match = line.match(PATTERNS.protect))) {
		return {
			type: 'protect',
			season: toFullYear(match[1]),
			owner: match[2],
			isRfa: line.includes('(RFA)')
		};
	}
	
	// cut
	if ((match = line.match(PATTERNS.cut))) {
		return {
			type: 'cut',
			season: toFullYear(match[1])
		};
	}
	
	// contract
	if ((match = line.match(PATTERNS.contract))) {
		return {
			type: 'contract',
			season: toFullYear(match[1]),
			salary: match[2] ? parseInt(match[2]) : null,
			startYear: match[3] === 'FA' ? null : toFullYear(match[3]),
			endYear: toFullYear(match[4])
		};
	}
	
	// rfa
	if ((match = line.match(PATTERNS.rfa))) {
		return {
			type: 'rfa',
			season: toFullYear(match[1])
		};
	}
	
	// lapsed
	if ((match = line.match(PATTERNS.lapsed))) {
		return {
			type: 'lapsed',
			season: toFullYear(match[1])
		};
	}
	
	// unknown
	if ((match = line.match(PATTERNS.unknown))) {
		return {
			type: 'unknown',
			season: toFullYear(match[1]),
			owner: match[2]
		};
	}
	
	return null;
}

function parseDSL() {
	var content = fs.readFileSync(DSL_FILE, 'utf8');
	var lines = content.split('\n');
	var players = [];
	var currentPlayer = null;
	
	for (var i = 0; i < lines.length; i++) {
		var line = lines[i];
		var lineNum = i + 1;
		
		// Skip comments and empty lines
		if (line.startsWith('#') || line.trim() === '') {
			if (currentPlayer && currentPlayer.transactions.length > 0) {
				players.push(currentPlayer);
				currentPlayer = null;
			}
			continue;
		}
		
		// Header line (not indented)
		if (!line.startsWith('  ')) {
			if (currentPlayer && currentPlayer.transactions.length > 0) {
				players.push(currentPlayer);
			}
			var header = parseHeader(line);
			if (header) {
				currentPlayer = {
					name: header.name,
					positions: header.positions,
					sleeperId: header.sleeperId,
					historical: header.historical,
					transactions: []
				};
			} else {
				currentPlayer = null;
			}
			continue;
		}
		
		// Transaction line (indented)
		if (currentPlayer) {
			var tx = parseTransaction(line, lineNum);
			if (tx) {
				tx.line = lineNum;
				currentPlayer.transactions.push(tx);
			}
		}
	}
	
	// Don't forget the last player
	if (currentPlayer && currentPlayer.transactions.length > 0) {
		players.push(currentPlayer);
	}
	
	return players;
}

// =============================================================================
// Database Operations
// =============================================================================

async function loadCaches() {
	// Load players
	var allPlayers = await Player.find({});
	allPlayers.forEach(function(p) {
		if (p.sleeperId) {
			playersBySleeperId[p.sleeperId] = p;
		}
		var key = p.name.toLowerCase();
		if (!playersByName[key]) {
			playersByName[key] = [];
		}
		playersByName[key].push(p);
	});
	console.log('Loaded', allPlayers.length, 'players');
	
	// Load regimes for owner->franchise mapping
	var regimes = await Regime.find({}).populate('tenures.franchiseId');
	regimes.forEach(function(r) {
		r.tenures.forEach(function(t) {
			for (var year = t.startSeason; year <= (t.endSeason || 2025); year++) {
				var key = r.displayName + '|' + year;
				franchiseByOwnerAndYear[key] = t.franchiseId._id;
			}
		});
	});
	console.log('Loaded', Object.keys(franchiseByOwnerAndYear).length, 'owner-year mappings');
	
	// Load trades
	var trades = JSON.parse(fs.readFileSync(TRADES_FILE, 'utf8'));
	trades.forEach(function(t) {
		tradesById[t.tradeId] = t;
	});
	console.log('Loaded', trades.length, 'trades');
}

async function resolvePlayer(dslPlayer) {
	// Try by sleeperId first
	if (dslPlayer.sleeperId && playersBySleeperId[dslPlayer.sleeperId]) {
		return playersBySleeperId[dslPlayer.sleeperId];
	}
	
	// Try by name (historical player)
	var key = dslPlayer.name.toLowerCase();
	var candidates = playersByName[key] || [];
	var historical = candidates.filter(function(p) { return !p.sleeperId; });
	
	if (historical.length === 1) {
		return historical[0];
	}
	
	// Create historical player
	if (dslPlayer.historical || !dslPlayer.sleeperId) {
		if (dryRun) {
			return { _id: 'dry-run-' + dslPlayer.name, name: dslPlayer.name };
		}
		
		console.log('  Creating historical player:', dslPlayer.name);
		var player = await Player.create({
			name: dslPlayer.name,
			positions: dslPlayer.positions,
			sleeperId: null
		});
		
		if (!playersByName[key]) {
			playersByName[key] = [];
		}
		playersByName[key].push(player);
		
		return player;
	}
	
	// Sleeper player not in database - create it (likely retired/historical)
	if (dryRun) {
		return { _id: 'dry-run-' + dslPlayer.name, name: dslPlayer.name };
	}
	
	console.log('  Creating retired Sleeper player:', dslPlayer.name, 'sleeperId:', dslPlayer.sleeperId);
	var player = await Player.create({
		name: dslPlayer.name,
		positions: dslPlayer.positions,
		sleeperId: dslPlayer.sleeperId
	});
	
	playersBySleeperId[dslPlayer.sleeperId] = player;
	if (!playersByName[key]) {
		playersByName[key] = [];
	}
	playersByName[key].push(player);
	
	return player;
}

function resolveFranchise(ownerName, year) {
	// Try exact year first
	var key = ownerName + '|' + year;
	if (franchiseByOwnerAndYear[key]) {
		return franchiseByOwnerAndYear[key];
	}
	
	// Try nearby years (for regime transitions, source data using old names, etc.)
	for (var offset = 1; offset <= 3; offset++) {
		var prevKey = ownerName + '|' + (year - offset);
		if (franchiseByOwnerAndYear[prevKey]) {
			return franchiseByOwnerAndYear[prevKey];
		}
		
		var nextKey = ownerName + '|' + (year + offset);
		if (franchiseByOwnerAndYear[nextKey]) {
			return franchiseByOwnerAndYear[nextKey];
		}
	}
	
	return null;
}

// Generate timestamp for a transaction
// Auctions/drafts happen in August, trades use their actual date, etc.
function getTimestamp(tx, tradeData, txIndex) {
	var year = tx.season;
	
	// Use txIndex to ensure transactions within same event maintain DSL order
	var offsetMs = (txIndex || 0) * 1000;  // 1 second per transaction
	
	switch (tx.type) {
		case 'draft':
			// Rookie draft is typically late August
			return new Date(Date.UTC(year, 7, 25, 12, 0, 0) + offsetMs);
		
		case 'auction':
		case 'auction-rfa-matched':
		case 'auction-rfa-unmatched':
			// Auction is mid-August
			return new Date(Date.UTC(year, 7, 18, 12, 0, 0) + offsetMs);
		
		case 'contract':
			// Contract signing - use same base time as auction/draft but with offset
			// This ensures contract comes after auction/draft in same year
			return new Date(Date.UTC(year, 7, 26, 12, 0, 0) + offsetMs);
		
		case 'trade':
			// Use actual trade date if available
			if (tradeData && tradeData.date) {
				return new Date(tradeData.date);
			}
			return new Date(Date.UTC(year, 8, 1, 12, 0, 0));
		
		case 'fa':
			// FA pickup during season
			return new Date(Date.UTC(year, 9, 1, 12, 0, 0));
		
		case 'cut':
			// Cut at end of season
			return new Date(Date.UTC(year, 11, 31, 12, 0, 0));
		
		case 'expansion':
		case 'protect':
			// Expansion draft in August 2012
			return new Date(Date.UTC(2012, 7, 15, 12, 0, 0));
		
		case 'rfa':
		case 'lapsed':
			// End of season
			return new Date(Date.UTC(year, 11, 31, 23, 59, 59));
		
		default:
			return new Date(Date.UTC(year, 6, 1, 12, 0, 0));
	}
}

// Map DSL type to Transaction type
function mapTransactionType(dslType) {
	switch (dslType) {
		case 'auction': return 'auction-ufa';
		case 'auction-rfa-matched': return 'auction-rfa-matched';
		case 'auction-rfa-unmatched': return 'auction-rfa-unmatched';
		case 'draft': return 'draft-select';
		case 'fa': return 'fa';
		case 'trade': return 'trade';
		case 'expansion': return 'expansion-draft-select';
		case 'protect': return 'expansion-draft-protect';
		case 'cut': return 'fa';  // Cut is an FA transaction with drops
		case 'contract': return 'contract';
		case 'rfa': return 'rfa-rights-conversion';
		case 'lapsed': return 'rfa-rights-lapsed';
		case 'unknown': return 'unknown';
		default: return null;
	}
}

async function createTransaction(player, tx, currentOwner, txIndex) {
	var tradeData = tx.type === 'trade' ? tradesById[tx.tradeId] : null;
	var timestamp = getTimestamp(tx, tradeData, txIndex);
	var dbType = mapTransactionType(tx.type);
	
	if (!dbType) {
		stats.errors.push({ player: player.name, tx: tx, reason: 'Unknown transaction type' });
		return null;
	}
	
	var franchiseId = null;
	var ownerForResolution = null;
	
	// Determine franchise - use explicit owner if present, otherwise use current owner
	if (tx.owner) {
		ownerForResolution = tx.owner;
	} else if (tx.toOwner) {
		ownerForResolution = tx.toOwner;
	} else if (currentOwner) {
		// Transactions without explicit owner inherit from context
		ownerForResolution = currentOwner;
	}
	
	if (ownerForResolution) {
		franchiseId = resolveFranchise(ownerForResolution, tx.season);
	}
	
	// Some transactions require a franchise
	var requiresFranchise = ['auction', 'auction-rfa-matched', 'auction-rfa-unmatched', 
		'draft', 'fa', 'trade', 'expansion', 'protect', 'contract', 'unknown'].includes(tx.type);
	
	if (!franchiseId && requiresFranchise) {
		stats.errors.push({ 
			player: player.name, 
			tx: tx, 
			reason: 'Could not resolve franchise for ' + ownerForResolution + ' in ' + tx.season
		});
		return null;
	}
	
	var doc = {
		type: dbType,
		timestamp: timestamp,
		source: 'snapshot',
		playerId: player._id
	};
	
	if (franchiseId) {
		doc.franchiseId = franchiseId;
	}
	
	// Type-specific fields
	switch (tx.type) {
		case 'auction':
		case 'auction-rfa-matched':
		case 'auction-rfa-unmatched':
			doc.winningBid = tx.salary;
			if (tx.hasContract) {
				doc.startYear = tx.startYear;
				doc.endYear = tx.endYear;
				doc.salary = tx.salary;
			}
			break;
		
		case 'draft':
			// Link to Pick model
			if (tx.round && tx.pick) {
				// Calculate overall pick number
				// Pre-2012: 10 teams, 2012+: 12 teams
				var teamsCount = tx.season < 2012 ? 10 : 12;
				var overallPickNumber = (tx.round - 1) * teamsCount + tx.pick;
				
				var pick = await Pick.findOne({ 
					season: tx.season, 
					pickNumber: overallPickNumber 
				});
				
				if (pick) {
					doc.pickId = pick._id;
					// We'll update Pick.transactionId after saving the Transaction
				}
			}
			break;
		
		case 'fa':
			// FA pickup - add player to adds array
			doc.adds = [{
				playerId: player._id,
				salary: tx.salary,
				startYear: tx.startYear,
				endYear: tx.endYear
			}];
			break;
		
		case 'cut':
			// Cut - add player to drops array
			doc.drops = [{
				playerId: player._id
			}];
			break;
		
		case 'trade':
			doc.tradeId = tx.tradeId;
			// Note: Full trade details (parties, assets) should come from trades.json
			// This just records that this player was part of the trade
			break;
		
		case 'expansion':
			doc.fromFranchiseId = resolveFranchise(tx.fromOwner, tx.season);
			break;
		
		case 'protect':
			doc.rfaRights = tx.isRfa;
			break;
		
		case 'contract':
			doc.salary = tx.salary;
			doc.startYear = tx.startYear;
			doc.endYear = tx.endYear;
			break;
	}
	
	if (dryRun) {
		if (singlePlayer) {
			console.log('  Would create:', dbType, 'on', timestamp.toISOString().slice(0, 10));
		}
		stats.transactions++;
		return doc;
	}
	
	var created = await Transaction.create(doc);
	stats.transactions++;
	
	// Update Pick's transactionId if this is a draft transaction
	if (tx.type === 'draft' && doc.pickId) {
		await Pick.updateOne({ _id: doc.pickId }, { transactionId: created._id });
	}
	
	return created;
}

async function processPlayer(dslPlayer) {
	if (singlePlayer && dslPlayer.name.toLowerCase() !== singlePlayer.toLowerCase()) {
		return;
	}
	
	var player = await resolvePlayer(dslPlayer);
	if (!player) {
		stats.errors.push({ player: dslPlayer.name, reason: 'Could not resolve player' });
		return;
	}
	
	stats.players++;
	
	// Track owner for cut transactions
	var currentOwner = null;
	
	for (var i = 0; i < dslPlayer.transactions.length; i++) {
		var tx = dslPlayer.transactions[i];
		
		await createTransaction(player, tx, currentOwner, i);
		
		// Update current owner
		if (tx.owner) {
			currentOwner = tx.owner;
		} else if (tx.toOwner) {
			currentOwner = tx.toOwner;
		}
	}
}

async function run() {
	dryRun = process.argv.includes('--dry-run');
	
	// Check for single player mode
	process.argv.forEach(function(arg) {
		var match = arg.match(/^--player="?([^"]+)"?$/);
		if (match) {
			singlePlayer = match[1];
		}
	});
	
	console.log('=== DSL to Transactions Seeder ===');
	if (dryRun) console.log('[DRY RUN]');
	if (singlePlayer) console.log('[Single player:', singlePlayer + ']');
	console.log('');
	
	await loadCaches();
	console.log('');
	
	console.log('Parsing DSL...');
	var players = parseDSL();
	console.log('Found', players.length, 'players in DSL');
	console.log('');
	
	// Note: Clearing is handled by the main seeder (data/seed/index.js)
	// This script assumes a clean slate when run as part of the full seed process
	
	console.log('Processing players...');
	for (var i = 0; i < players.length; i++) {
		await processPlayer(players[i]);
		
		if ((i + 1) % 100 === 0) {
			console.log('  Processed', i + 1, '/', players.length, '...');
		}
	}
	
	console.log('');
	console.log('=== Done ===');
	console.log('Players processed:', stats.players);
	console.log('Transactions created:', stats.transactions);
	
	if (stats.errors.length > 0) {
		console.log('');
		console.log('Errors:', stats.errors.length);
		stats.errors.slice(0, 20).forEach(function(e) {
			console.log('  -', e.player + ':', e.reason);
		});
		if (stats.errors.length > 20) {
			console.log('  ... and', stats.errors.length - 20, 'more');
		}
	}
	
	process.exit(stats.errors.length > 0 ? 1 : 0);
}

run().catch(function(err) {
	console.error('Error:', err);
	process.exit(1);
});
