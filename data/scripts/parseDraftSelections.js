var request = require('superagent');
var fs = require('fs');
var PSO = require('../../pso.js');
var sleeperData = Object.values(require('../../public/data/sleeper-data.json'));

// Past Drafts spreadsheet (tabs named by year: "2024", "2023", etc.)
var pastDraftsSheetBaseUrl = 'https://sheets.googleapis.com/v4/spreadsheets/1O0iyyKdniwP-oVvBTwlgxJRYs_WhMsypHGBDB8AO2lM/values/';

// Main PSO spreadsheet (for current year draft like "2025 Draft")
var mainSheetBaseUrl = 'https://sheets.googleapis.com/v4/spreadsheets/1nas3AqWZtCu_UZIV77Jgxd9oriF1NQjzSjFWW86eong/values/';

// Decode HTML entities
function decodeHtmlEntities(str) {
	if (!str) return str;
	return str
		.replace(/&#8217;/g, "'")
		.replace(/&#8216;/g, "'")
		.replace(/&#8220;/g, '"')
		.replace(/&#8221;/g, '"')
		.replace(/&#038;/g, '&')
		.replace(/&#39;/g, "'");
}

// Normalize player name for matching
function normalizePlayerName(name) {
	if (!name) return '';
	var decoded = decodeHtmlEntities(name);
	return decoded
		.replace(/\s+(III|II|IV|V|Jr\.|Sr\.)$/i, '')
		.replace(/\s+/g, ' ')
		.trim();
}

// Build reverse lookup for owner names
var ownerToFranchiseByYear = {};
Object.keys(PSO.franchiseNames).forEach(function(franchiseId) {
	var yearMap = PSO.franchiseNames[franchiseId];
	Object.keys(yearMap).forEach(function(year) {
		var ownerName = yearMap[year];
		if (!ownerToFranchiseByYear[year]) {
			ownerToFranchiseByYear[year] = {};
		}
		ownerToFranchiseByYear[year][ownerName] = parseInt(franchiseId);
	});
});

var ownerAliases = {
	'Koci': 2, 'John': 4, 'James': 9, 'Schex': 10, 'Daniel': 8,
	'Syed': 3, 'Trevor': 5, 'Terence': 8, 'Charles': 11,
	'Syed/Terence': 3, 'Syed/Kuan': 3, 'Brett/Luke': 7, 'John/Zach': 4,
	'Mitch/Mike': 12, 'James/Charles': 9, 'Schex/Jeff': 10, 'Jake/Luke': 7, 'Pat/Quinn': 1
};

function getSleeperRosterId(ownerName, season) {
	if (!ownerName) return null;
	var name = ownerName.trim();
	if (ownerToFranchiseByYear[season] && ownerToFranchiseByYear[season][name]) {
		return ownerToFranchiseByYear[season][name];
	}
	if (PSO.franchiseIds[name]) {
		return PSO.franchiseIds[name];
	}
	return ownerAliases[name] || null;
}

// Strip punctuation for fuzzy comparison
function stripPunctuation(str) {
	return str.replace(/['\-\.]/g, '');
}

// Parse name into first/last parts
function parseNameParts(name) {
	var normalized = normalizePlayerName(name);
	var parts = normalized.split(' ');
	if (parts.length < 2) return { first: parts[0] || '', last: '' };
	return {
		first: parts[0],
		last: parts.slice(1).join(' '),
		lastBase: parts[parts.length - 1].split('-')[0] // "Tryon-Shoyinka" -> "Tryon"
	};
}

// Find player in Sleeper data by name
function findSleeperMatch(playerName, draftYear) {
	var normalized = normalizePlayerName(playerName).toLowerCase();
	var nameParts = parseNameParts(playerName);
	var currentYear = new Date().getFullYear();
	var expectedYearsExp = currentYear - draftYear;
	
	// Try exact match first
	var exactMatches = sleeperData.filter(function(p) {
		if (!p.full_name) return false;
		var sleeperNormalized = normalizePlayerName(p.full_name).toLowerCase();
		return sleeperNormalized === normalized;
	});
	
	if (exactMatches.length === 1) {
		return {
			status: 'matched',
			sleeperId: exactMatches[0].player_id,
			sleeperName: exactMatches[0].full_name,
			team: exactMatches[0].team || 'FA',
			positions: exactMatches[0].fantasy_positions || []
		};
	}
	
	if (exactMatches.length > 1) {
		// Try to narrow down by years_exp
		var expFiltered = exactMatches.filter(function(m) {
			var exp = m.years_exp;
			return exp !== undefined && Math.abs(exp - expectedYearsExp) <= 1;
		});
		
		if (expFiltered.length === 1) {
			return {
				status: 'matched',
				sleeperId: expFiltered[0].player_id,
				sleeperName: expFiltered[0].full_name,
				team: expFiltered[0].team || 'FA',
				positions: expFiltered[0].fantasy_positions || []
			};
		}
		
		var candidates = (expFiltered.length > 0 ? expFiltered : exactMatches);
		return {
			status: 'multiple',
			candidates: candidates.map(function(m) {
				return {
					sleeperId: m.player_id,
					name: m.full_name,
					team: m.team || 'FA',
					positions: m.fantasy_positions || [],
					years_exp: m.years_exp
				};
			}),
			expectedYearsExp: expectedYearsExp
		};
	}
	
	// No exact match - try fuzzy matching
	var fuzzyMatches = [];
	
	// Also try punctuation-stripped exact match
	var strippedNormalized = stripPunctuation(normalized);
	
	sleeperData.forEach(function(p) {
		if (!p.full_name) return;
		var sleeperNormalized = normalizePlayerName(p.full_name).toLowerCase();
		var sleeperParts = parseNameParts(p.full_name);
		
		// Strategy 0: Punctuation-stripped exact match
		// "Trevon Moehrig" matches "Tre'von Moehrig"
		if (stripPunctuation(sleeperNormalized) === strippedNormalized) {
			fuzzyMatches.push({ player: p, reason: 'punctuation variant' });
			return;
		}
		
		// Strategy 1: Same first name + last name is prefix of Sleeper last name
		// "Joe Tryon" matches "Joe Tryon-Shoyinka"
		if (nameParts.first.toLowerCase() === sleeperParts.first.toLowerCase() &&
			sleeperParts.last.toLowerCase().startsWith(nameParts.last.toLowerCase()) &&
			nameParts.last.length >= 3) {
			fuzzyMatches.push({ player: p, reason: 'name prefix' });
			return;
		}
		
		// Strategy 2: Same last name + first initial matches
		// "D. Smith" or variant first names
		if (nameParts.last.toLowerCase() === sleeperParts.last.toLowerCase() &&
			nameParts.first.charAt(0).toLowerCase() === sleeperParts.first.charAt(0).toLowerCase()) {
			fuzzyMatches.push({ player: p, reason: 'last name + initial' });
			return;
		}
		
		// Strategy 3: Sleeper last name starts with our last name (hyphenated addition)
		// "Tryon" matches "Tryon-Shoyinka"
		if (sleeperParts.lastBase && 
			sleeperParts.lastBase.toLowerCase() === nameParts.last.toLowerCase() &&
			nameParts.first.toLowerCase() === sleeperParts.first.toLowerCase()) {
			fuzzyMatches.push({ player: p, reason: 'hyphenated name' });
			return;
		}
	});
	
	// Deduplicate by player_id
	var seen = {};
	fuzzyMatches = fuzzyMatches.filter(function(m) {
		if (seen[m.player.player_id]) return false;
		seen[m.player.player_id] = true;
		return true;
	});
	
	// If multiple fuzzy matches, try to narrow down by years_exp
	if (fuzzyMatches.length > 1) {
		// Filter to candidates with matching years_exp (within 1 year tolerance)
		var expFiltered = fuzzyMatches.filter(function(m) {
			var exp = m.player.years_exp;
			return exp !== undefined && Math.abs(exp - expectedYearsExp) <= 1;
		});
		
		if (expFiltered.length === 1) {
			fuzzyMatches = expFiltered;
		} else if (expFiltered.length > 1) {
			// Still multiple - prefer exact years_exp match
			var exactExp = expFiltered.filter(function(m) {
				return m.player.years_exp === expectedYearsExp;
			});
			if (exactExp.length === 1) {
				fuzzyMatches = exactExp;
			} else {
				fuzzyMatches = expFiltered; // Use filtered set
			}
		}
		// If no exp matches, keep original fuzzyMatches
	}
	
	if (fuzzyMatches.length === 1) {
		var m = fuzzyMatches[0];
		return {
			status: 'suggested',
			sleeperId: m.player.player_id,
			sleeperName: m.player.full_name,
			team: m.player.team || 'FA',
			positions: m.player.fantasy_positions || [],
			reason: m.reason + (m.player.years_exp !== undefined ? ' (exp:' + m.player.years_exp + ')' : '')
		};
	}
	
	if (fuzzyMatches.length > 1) {
		return {
			status: 'multiple',
			candidates: fuzzyMatches.map(function(m) {
				return {
					sleeperId: m.player.player_id,
					name: m.player.full_name,
					team: m.player.team || 'FA',
					positions: m.player.fantasy_positions || [],
					years_exp: m.player.years_exp,
					reason: m.reason
				};
			}),
			expectedYearsExp: expectedYearsExp
		};
	}
	
	return { status: 'unmatched' };
}

async function fetchDraftData(season, apiKey, useMainSheet) {
	// Past drafts: tab named just "{Year}" in Past Drafts sheet
	// Current year: tab named "{Year} Draft" in main PSO sheet
	var sheetName = useMainSheet ? (season + ' Draft') : String(season);
	var baseUrl = useMainSheet ? mainSheetBaseUrl : pastDraftsSheetBaseUrl;
	
	try {
		var response = await request
			.get(baseUrl + encodeURIComponent(sheetName))
			.query({ alt: 'json', key: apiKey });

		var dataJson = JSON.parse(response.text);
		var picks = [];

		dataJson.values.forEach(function(row, i) {
			if (i === 0) return;

			var offset = (season === 2020) ? 1 : 0;

			var pickNumber = parseInt(row[0 + offset]);
			var round = parseInt(row[1 + offset]);
			var currentOwner = row[2 + offset];
			var player = row[3 + offset];
			var originRaw = row[4 + offset];

			if (isNaN(round)) return;

			var originalOwner = currentOwner;
			if (originRaw) {
				var cleaned = originRaw.trim();
				var fromMatch = cleaned.match(/^From\s+(.+?)(?:\s+\(via|$)/i);
				if (fromMatch) {
					originalOwner = fromMatch[1].trim();
				} else {
					var stripped = cleaned.split(/\s*[\(\[]/).shift().trim();
					originalOwner = stripped || cleaned;
				}
			}

			if (player && player.toLowerCase() !== 'pass') {
				picks.push({
					season: season,
					pickNumber: pickNumber,
					round: round,
					currentOwner: currentOwner,
					originalOwner: originalOwner,
					playerNameRaw: player
				});
			}
		});

		return picks;
	}
	catch (err) {
		console.log('Could not fetch ' + season + ':', err.message);
		return [];
	}
}

async function main() {
	var apiKey = process.env.GOOGLE_API_KEY;
	if (!apiKey) {
		// Try loading from .env
		require('dotenv').config({ path: __dirname + '/../../.env' });
		apiKey = process.env.GOOGLE_API_KEY;
	}
	
	if (!apiKey) {
		console.error('GOOGLE_API_KEY required');
		process.exit(1);
	}

	var currentYear = new Date().getFullYear();
	var startYear = 2010;
	
	var allSelections = [];
	var stats = { matched: 0, suggested: 0, multiple: 0, unmatched: 0 };

	// Fetch past drafts (2010 through currentYear-1) from Past Drafts sheet
	for (var year = startYear; year < currentYear; year++) {
		console.log('Fetching ' + year + ' (past drafts sheet)...');
		var picks = await fetchDraftData(year, apiKey, false);
		
		picks.forEach(function(p) {
			var normalized = normalizePlayerName(p.playerNameRaw);
			var match = findSleeperMatch(p.playerNameRaw, p.season);
			
			var selection = {
				season: p.season,
				round: p.round,
				pickNumber: p.pickNumber,
				currentOwner: p.currentOwner,
				originalOwner: p.originalOwner,
				currentOwnerId: getSleeperRosterId(p.currentOwner, p.season),
				originalOwnerId: getSleeperRosterId(p.originalOwner, p.season),
				playerNameRaw: p.playerNameRaw,
				playerNameNormalized: normalized,
				match: match
			};
			
			// For easy editing: add a sleeperId field that user can fill in
			if (match.status === 'matched') {
				selection.sleeperId = match.sleeperId;
				stats.matched++;
			} else if (match.status === 'suggested') {
				selection.sleeperId = match.sleeperId; // Pre-filled but needs verification
				selection.suggestedName = match.sleeperName;
				selection.suggestReason = match.reason;
				stats.suggested++;
			} else if (match.status === 'multiple') {
				selection.sleeperId = null; // User picks one
				stats.multiple++;
			} else {
				selection.sleeperId = null; // User can add ID or mark as historical
				stats.unmatched++;
			}
			
			allSelections.push(selection);
		});
	}

	// Fetch current year from main sheet ("{Year} Draft" tab)
	console.log('Fetching ' + currentYear + ' (main sheet)...');
	var currentYearPicks = await fetchDraftData(currentYear, apiKey, true);
	
	currentYearPicks.forEach(function(p) {
		var normalized = normalizePlayerName(p.playerNameRaw);
		var match = findSleeperMatch(p.playerNameRaw, p.season);
		
		var selection = {
			season: p.season,
			round: p.round,
			pickNumber: p.pickNumber,
			currentOwner: p.currentOwner,
			originalOwner: p.originalOwner,
			currentOwnerId: getSleeperRosterId(p.currentOwner, p.season),
			originalOwnerId: getSleeperRosterId(p.originalOwner, p.season),
			playerNameRaw: p.playerNameRaw,
			playerNameNormalized: normalized,
			match: match
		};
		
		if (match.status === 'matched') {
			selection.sleeperId = match.sleeperId;
			stats.matched++;
		} else if (match.status === 'suggested') {
			selection.sleeperId = match.sleeperId;
			selection.suggestedName = match.sleeperName;
			selection.suggestReason = match.reason;
			stats.suggested++;
		} else if (match.status === 'multiple') {
			selection.sleeperId = null;
			stats.multiple++;
		} else {
			selection.sleeperId = null;
			stats.unmatched++;
		}
		
		allSelections.push(selection);
	});

	// Sort by year desc, then pick number
	allSelections.sort(function(a, b) {
		if (a.season !== b.season) return b.season - a.season;
		return a.pickNumber - b.pickNumber;
	});

	// Write full output
	var outputPath = __dirname + '/draft-selections.json';
	fs.writeFileSync(outputPath, JSON.stringify(allSelections, null, 2));
	
	console.log('\n=== Summary ===');
	console.log('Total selections:', allSelections.length);
	console.log('  Matched:', stats.matched);
	console.log('  Suggested (verify these):', stats.suggested);
	console.log('  Multiple matches:', stats.multiple);
	console.log('  Unmatched:', stats.unmatched);
	
	// Write suggested/unmatched/multiple for easy review
	var needsReview = allSelections.filter(function(s) {
		return s.match.status !== 'matched';
	});
	
	var reviewPath = __dirname + '/draft-selections-review.json';
	fs.writeFileSync(reviewPath, JSON.stringify(needsReview, null, 2));
	
	console.log('\nFull data written to: data/scripts/draft-selections.json');
	console.log('Needs review written to: data/scripts/draft-selections-review.json');
	console.log('\nEdit draft-selections.json to:');
	console.log('  - Fill in sleeperId for unmatched players (if they exist in Sleeper)');
	console.log('  - Set sleeperId to "historical" for truly historical players');
	console.log('  - Pick one sleeperId for multiple-match cases');
}

main().catch(console.error);
