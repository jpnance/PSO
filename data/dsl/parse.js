#!/usr/bin/env node
/**
 * Player History DSL Parser
 * 
 * Parses the player-history.dsl file and validates regime names.
 * 
 * Usage:
 *   node data/dsl/parse.js [--validate] [--seed] [--dry-run]
 * 
 * Options:
 *   --validate   Check regime names against database (requires DB connection)
 *   --seed       Seed transactions to database
 *   --dry-run    With --seed, show what would be seeded without doing it
 */

var fs = require('fs');
var path = require('path');

var DSL_FILE = path.join(__dirname, 'player-history.dsl');

// Transaction type patterns
var PATTERNS = {
	// Header: Name | Position(s) | [sleeper:ID] [| espn:ID] [| historical]
	// Parsed manually due to optional fields
	
	// YY auction-ufa OWNER $SALARY [YY/YY]
	auctionUfa: /^(\d{2})\s+auction-ufa\s+(\S+)\s+\$(\d+)(?:\s+(\d{2}|\w+)\/(\d{2}))?$/,
	
	// YY auction-rfa-matched OWNER $SALARY [YY/YY]
	auctionRfaMatched: /^(\d{2})\s+auction-rfa-matched\s+(\S+)\s+\$(\d+)(?:\s+(\d{2}|\w+)\/(\d{2}))?$/,
	
	// YY auction-rfa-unmatched OWNER $SALARY [YY/YY]
	auctionRfaUnmatched: /^(\d{2})\s+auction-rfa-unmatched\s+(\S+)\s+\$(\d+)(?:\s+(\d{2}|\w+)\/(\d{2}))?$/,
	
	// YY auction OWNER $SALARY [YY/YY] (legacy, maps to auction-ufa)
	auction: /^(\d{2})\s+auction\s+(\S+)\s+\$(\d+)(?:\s+(\d{2}|\w+)\/(\d{2}))?$/,
	
	// YY draft OWNER RD.PICK (or ?.?? for unknown)
	draft: /^(\d{2})\s+draft\s+(\S+)\s+(\d+|\?)\.(\d+|\?\?)$/,
	
	// YY fa OWNER [$SALARY] [YY/YY]
	fa: /^(\d{2})\s+fa\s+(\S+)(?:\s+\$(\d+))?(?:\s+(\d{2}|\w+)\/(\d{2}))?$/,
	
	// YY trade NUMBER -> OWNER
	trade: /^(\d{2})\s+trade\s+(\d+)\s+->\s+(\S+)$/,
	
	// YY expansion OWNER from ORIGINAL_OWNER
	expansion: /^(\d{2})\s+expansion\s+(\S+)\s+from\s+(\S+)$/,
	
	// YY protect OWNER [(RFA)]
	protect: /^(\d{2})\s+protect\s+(\S+)(?:\s+\(RFA\))?$/,
	
	// YY cut
	cut: /^(\d{2})\s+cut$/,
	
	// YY contract [$SALARY] YY/YY
	contract: /^(\d{2})\s+contract(?:\s+\$(\d+))?\s+(\d{2}|\w+)\/(\d{2})$/,
	
	// YY rfa
	rfa: /^(\d{2})\s+rfa$/,
	
	// YY lapsed
	lapsed: /^(\d{2})\s+lapsed$/,
	
	// YY unknown OWNER
	unknown: /^(\d{2})\s+unknown\s+(\S+)$/
};

/**
 * Parse a header line
 * Format: Name | Position(s) | [sleeper:ID] [| espn:ID] [| historical]
 */
function parseHeader(line) {
	var parts = line.split('|').map(function(p) { return p.trim(); });
	
	if (parts.length < 2) return null;
	
	var result = {
		name: parts[0],
		positions: parts[1].split('/').map(function(p) { return p.trim(); }),
		sleeperId: null,
		espnId: null,
		historical: false
	};
	
	// Parse remaining parts (order-independent)
	for (var i = 2; i < parts.length; i++) {
		var part = parts[i].toLowerCase();
		
		if (part === 'historical') {
			result.historical = true;
		} else if (part.startsWith('sleeper:')) {
			result.sleeperId = parts[i].substring(8);
		} else if (part.startsWith('espn:')) {
			result.espnId = parts[i].substring(5);
		}
	}
	
	return result;
}

/**
 * Convert 2-digit year to 4-digit year
 */
function toFullYear(yy) {
	if (yy === 'FA' || yy === 'fa') return null;
	var num = parseInt(yy);
	return num < 50 ? 2000 + num : 1900 + num;
}

/**
 * Parse a single transaction line
 */
function parseTransaction(line, lineNum) {
	// Remove comments
	var commentIdx = line.indexOf('#');
	if (commentIdx !== -1) {
		line = line.substring(0, commentIdx);
	}
	line = line.trim();
	
	if (!line) return null;
	
	var match;
	
	// auction-ufa
	if ((match = line.match(PATTERNS.auctionUfa))) {
		return {
			type: 'auction-ufa',
			season: toFullYear(match[1]),
			owner: match[2],
			salary: parseInt(match[3]),
			startYear: toFullYear(match[4]),
			endYear: toFullYear(match[5]),
			line: lineNum
		};
	}
	
	// auction-rfa-matched
	if ((match = line.match(PATTERNS.auctionRfaMatched))) {
		return {
			type: 'auction-rfa-matched',
			season: toFullYear(match[1]),
			owner: match[2],
			salary: parseInt(match[3]),
			startYear: toFullYear(match[4]),
			endYear: toFullYear(match[5]),
			line: lineNum
		};
	}
	
	// auction-rfa-unmatched
	if ((match = line.match(PATTERNS.auctionRfaUnmatched))) {
		return {
			type: 'auction-rfa-unmatched',
			season: toFullYear(match[1]),
			owner: match[2],
			salary: parseInt(match[3]),
			startYear: toFullYear(match[4]),
			endYear: toFullYear(match[5]),
			line: lineNum
		};
	}
	
	// legacy auction (maps to auction-ufa)
	if ((match = line.match(PATTERNS.auction))) {
		return {
			type: 'auction-ufa',
			season: toFullYear(match[1]),
			owner: match[2],
			salary: parseInt(match[3]),
			startYear: toFullYear(match[4]),
			endYear: toFullYear(match[5]),
			line: lineNum
		};
	}
	
	// draft
	if ((match = line.match(PATTERNS.draft))) {
		return {
			type: 'draft',
			season: toFullYear(match[1]),
			owner: match[2],
			round: match[3] === '?' ? null : parseInt(match[3]),
			pick: match[4] === '??' ? null : parseInt(match[4]),
			line: lineNum
		};
	}
	
	// fa
	if ((match = line.match(PATTERNS.fa))) {
		return {
			type: 'fa',
			season: toFullYear(match[1]),
			owner: match[2],
			salary: match[3] ? parseInt(match[3]) : 1,
			startYear: match[4] ? toFullYear(match[4]) : null,
			endYear: match[5] ? toFullYear(match[5]) : toFullYear(match[1]),
			line: lineNum
		};
	}
	
	// trade
	if ((match = line.match(PATTERNS.trade))) {
		return {
			type: 'trade',
			season: toFullYear(match[1]),
			tradeId: parseInt(match[2]),
			owner: match[3],
			line: lineNum
		};
	}
	
	// expansion
	if ((match = line.match(PATTERNS.expansion))) {
		return {
			type: 'expansion',
			season: toFullYear(match[1]),
			owner: match[2],
			fromOwner: match[3],
			line: lineNum
		};
	}
	
	// protect
	if ((match = line.match(PATTERNS.protect))) {
		return {
			type: 'protect',
			season: toFullYear(match[1]),
			owner: match[2],
			line: lineNum
		};
	}
	
	// cut
	if ((match = line.match(PATTERNS.cut))) {
		return {
			type: 'cut',
			season: toFullYear(match[1]),
			line: lineNum
		};
	}
	
	// contract
	if ((match = line.match(PATTERNS.contract))) {
		return {
			type: 'contract',
			season: toFullYear(match[1]),
			salary: match[2] ? parseInt(match[2]) : null,
			startYear: toFullYear(match[3]),
			endYear: toFullYear(match[4]),
			line: lineNum
		};
	}
	
	// rfa
	if ((match = line.match(PATTERNS.rfa))) {
		return {
			type: 'rfa',
			season: toFullYear(match[1]),
			line: lineNum
		};
	}
	
	// lapsed
	if ((match = line.match(PATTERNS.lapsed))) {
		return {
			type: 'lapsed',
			season: toFullYear(match[1]),
			line: lineNum
		};
	}
	
	// unknown
	if ((match = line.match(PATTERNS.unknown))) {
		return {
			type: 'unknown',
			season: toFullYear(match[1]),
			owner: match[2],
			line: lineNum
		};
	}
	
	return { type: 'error', message: 'Unrecognized transaction format', line: lineNum, raw: line };
}

/**
 * Parse the DSL file
 * Returns array of player objects with transactions
 */
function parseDSL(filepath) {
	var content = fs.readFileSync(filepath, 'utf8');
	var lines = content.split('\n');
	
	var players = [];
	var currentPlayer = null;
	var errors = [];
	
	for (var i = 0; i < lines.length; i++) {
		var lineNum = i + 1;
		var line = lines[i];
		
		// Remove end-of-line comments
		var commentIdx = line.indexOf('#');
		if (commentIdx !== -1) {
			line = line.substring(0, commentIdx);
		}
		
		var trimmed = line.trim();
		
		// Skip empty lines (but they end the current player block)
		if (!trimmed) {
			if (currentPlayer && currentPlayer.transactions.length > 0) {
				players.push(currentPlayer);
				currentPlayer = null;
			}
			continue;
		}
		
		// Check if it's a header line (not indented, contains |)
		if (!line.match(/^\s/) && line.includes('|')) {
			// Save previous player if exists
			if (currentPlayer && currentPlayer.transactions.length > 0) {
				players.push(currentPlayer);
			}
			
			var header = parseHeader(trimmed);
			if (header) {
				currentPlayer = {
					name: header.name,
					positions: header.positions,
					sleeperId: header.sleeperId,
					espnId: header.espnId,
					historical: header.historical,
					transactions: [],
					line: lineNum
				};
			} else {
				errors.push({ line: lineNum, message: 'Invalid header format', raw: trimmed });
			}
			continue;
		}
		
		// Must be a transaction line (indented)
		if (line.match(/^\s/) && currentPlayer) {
			var tx = parseTransaction(trimmed, lineNum);
			if (tx) {
				if (tx.type === 'error') {
					errors.push(tx);
				} else {
					currentPlayer.transactions.push(tx);
				}
			}
		} else if (line.match(/^\s/) && !currentPlayer) {
			errors.push({ line: lineNum, message: 'Transaction without player header', raw: trimmed });
		}
	}
	
	// Don't forget the last player
	if (currentPlayer && currentPlayer.transactions.length > 0) {
		players.push(currentPlayer);
	}
	
	return { players: players, errors: errors };
}

/**
 * Validate regime names against database
 */
async function validateRegimes(players) {
	var mongoose = require('mongoose');
	var Regime = require('../../models/Regime');
	
	await mongoose.connect(process.env.MONGODB_URI || 'mongodb://mongo/pso');
	
	// Build map of displayName -> regime with tenures
	var regimes = await Regime.find({}).lean();
	var regimeMap = {};
	regimes.forEach(function(r) {
		regimeMap[r.displayName.toLowerCase()] = r;
	});
	
	var warnings = [];
	
	players.forEach(function(player) {
		player.transactions.forEach(function(tx) {
			if (!tx.owner) return;
			
			var key = tx.owner.toLowerCase();
			var regime = regimeMap[key];
			
			if (!regime) {
				warnings.push({
					player: player.name,
					line: tx.line,
					message: 'UNKNOWN REGIME: "' + tx.owner + '" does not exist in database'
				});
				return;
			}
			
			// Check if regime had a tenure that covers this season
			var season = tx.season;
			var validTenure = regime.tenures.some(function(t) {
				return t.startSeason <= season && (t.endSeason === null || t.endSeason >= season);
			});
			
			if (!validTenure) {
				var tenureStrs = regime.tenures.map(function(t) {
					return t.startSeason + '-' + (t.endSeason || 'present');
				}).join(', ');
				warnings.push({
					player: player.name,
					line: tx.line,
					message: 'IMPOSSIBLE REGIME: "' + tx.owner + '" was not active in ' + season + 
						' (tenures: ' + tenureStrs + ')'
				});
			}
		});
	});
	
	await mongoose.disconnect();
	
	return warnings;
}

/**
 * Main
 */
async function run() {
	var args = process.argv.slice(2);
	var doValidate = args.includes('--validate');
	var doSeed = args.includes('--seed');
	var dryRun = args.includes('--dry-run');
	
	console.log('=== Player History DSL Parser ===\n');
	
	// Parse
	console.log('Parsing ' + DSL_FILE + '...\n');
	var result = parseDSL(DSL_FILE);
	
	// Report parse errors
	if (result.errors.length > 0) {
		console.log('PARSE ERRORS:');
		result.errors.forEach(function(e) {
			console.log('  Line ' + e.line + ': ' + e.message);
			if (e.raw) console.log('    > ' + e.raw);
		});
		console.log('');
	}
	
	// Report parsed players
	console.log('Parsed ' + result.players.length + ' players');
	result.players.forEach(function(p) {
		var ids = [];
		if (p.sleeperId) ids.push('sleeper:' + p.sleeperId);
		if (p.espnId) ids.push('espn:' + p.espnId);
		if (p.historical) ids.push('historical');
		var idStr = ids.length > 0 ? ' [' + ids.join(', ') + ']' : '';
		console.log('  ' + p.name + ' (' + p.positions.join('/') + ')' + idStr + ' - ' + p.transactions.length + ' transactions');
	});
	console.log('');
	
	// Check for missing sleeper IDs on non-historical players
	var missingSleeper = result.players.filter(function(p) {
		return !p.historical && !p.sleeperId;
	});
	if (missingSleeper.length > 0) {
		console.log('WARNING: Non-historical players without sleeper ID:');
		missingSleeper.forEach(function(p) {
			console.log('  Line ' + p.line + ': ' + p.name);
		});
		console.log('');
	}
	
	// Validate regimes if requested
	if (doValidate) {
		console.log('Validating regime names...\n');
		var warnings = await validateRegimes(result.players);
		
		if (warnings.length > 0) {
			console.log('REGIME WARNINGS:');
			warnings.forEach(function(w) {
				console.log('  Line ' + w.line + ' [' + w.player + ']: ' + w.message);
			});
		} else {
			console.log('All regime names valid!');
		}
		console.log('');
	}
	
	// Seed if requested
	if (doSeed) {
		if (dryRun) {
			console.log('DRY RUN - would seed ' + result.players.length + ' players');
		} else {
			console.log('Seeding not yet implemented');
		}
	}
}

run().catch(function(err) {
	console.error(err);
	process.exit(1);
});
