#!/usr/bin/env node
/**
 * DSL State Machine Validator
 *
 * Validates player-history.dsl for logical consistency.
 *
 * Usage:
 *   node data/dsl/validate.js
 */

var fs = require('fs');
var path = require('path');

var PSO = require('../../config/pso.js');

var DSL_FILE = path.join(__dirname, 'player-history.dsl');

// Build owner name -> Set of franchiseIds (a name like "Schexes" can map to
// multiple franchises across different eras)
var ownerToFranchiseIds = {};
function addOwnerMapping(name, id) {
	if (!ownerToFranchiseIds[name]) ownerToFranchiseIds[name] = new Set();
	ownerToFranchiseIds[name].add(id);
}
Object.keys(PSO.franchiseNames).forEach(function(rosterId) {
	var yearMap = PSO.franchiseNames[rosterId];
	Object.keys(yearMap).forEach(function(year) {
		addOwnerMapping(yearMap[year], parseInt(rosterId));
	});
});
Object.keys(PSO.franchiseIds).forEach(function(name) {
	addOwnerMapping(name, PSO.franchiseIds[name]);
});

function sameOwner(a, b) {
	if (a === b) return true;
	var setA = ownerToFranchiseIds[a];
	var setB = ownerToFranchiseIds[b];
	if (!setA || !setB) return false;
	// Check for any overlapping franchise ID
	for (var id of setA) {
		if (setB.has(id)) return true;
	}
	return false;
}

// Resolve an owner name in a specific season to a rosterId.
// RFA rights belong to the franchise (slot), not the person,
// so comparisons must use the rosterId at the relevant season.
function ownerToRosterIdInSeason(name, season) {
	var names = PSO.franchiseNames;
	var rosterIds = Object.keys(names);
	for (var i = 0; i < rosterIds.length; i++) {
		var rid = parseInt(rosterIds[i]);
		if (names[rid] && names[rid][season] === name) return rid;
	}
	// Fallback: use the static franchiseIds map (no season awareness)
	if (PSO.franchiseIds[name] !== undefined) return PSO.franchiseIds[name];
	return null;
}

// Check if two owner names at given seasons refer to the same franchise slot.
function sameFranchise(ownerA, seasonA, ownerB, seasonB) {
	var ridA = ownerToRosterIdInSeason(ownerA, seasonA);
	var ridB = ownerToRosterIdInSeason(ownerB, seasonB);
	if (ridA === null || ridB === null) return sameOwner(ownerA, ownerB);
	return ridA === ridB;
}

// =============================================================================
// Parsing
// =============================================================================

/**
 * Parse a DSL event line into a structured object.
 * Returns null for non-event lines (comments, blanks, headers).
 */
function parseEvent(line) {
	var m;

	m = line.match(/^\s+(\d+) draft (\S+(?:\/\S+)?) (\d+\.\d+)/);
	if (m) return { season: 2000 + parseInt(m[1]), type: 'draft', owner: m[2], detail: m[3] };

	m = line.match(/^\s+(\d+) (auction-ufa|auction-rfa-matched|auction-rfa-unmatched) (\S+(?:\/\S+)?) \$(\d+)/);
	if (m) return { season: 2000 + parseInt(m[1]), type: m[2], owner: m[3], salary: parseInt(m[4]), detail: '$' + m[4] };

	m = line.match(/^\s+(\d+) contract \$(\d+) (\S+)/);
	if (m) return { season: 2000 + parseInt(m[1]), type: 'contract', salary: parseInt(m[2]), detail: m[3] };

	m = line.match(/^\s+(\d+) fa (\S+(?:\/\S+)?) \$(\d+) (\S+)/);
	if (m) return { season: 2000 + parseInt(m[1]), type: 'fa', owner: m[2], detail: '$' + m[3] + ' ' + m[4] };

	m = line.match(/^\s+(\d+) trade (\d+) -> (\S+(?:\/\S+)?)/);
	if (m) return { season: 2000 + parseInt(m[1]), type: 'trade', tradeId: parseInt(m[2]), owner: m[3] };

	m = line.match(/^\s+(\d+) (drop|cut) # by (\S+(?:\/\S+)?)/);
	if (m) return { season: 2000 + parseInt(m[1]), type: m[2], owner: m[3] };

	m = line.match(/^\s+(\d+) expansion (\S+(?:\/\S+)?) from (\S+(?:\/\S+)?)/);
	if (m) return { season: 2000 + parseInt(m[1]), type: 'expansion', owner: m[2], fromOwner: m[3] };

	m = line.match(/^\s+(\d+) rfa (\S+(?:\/\S+)?)/);
	if (m) return { season: 2000 + parseInt(m[1]), type: 'rfa', owner: m[2] };

	m = line.match(/^\s+(\d+) rfa-lapsed # by (\S+(?:\/\S+)?)/);
	if (m) return { season: 2000 + parseInt(m[1]), type: 'rfa-lapsed', owner: m[2] };

	m = line.match(/^\s+(\d+) expiry # by (\S+(?:\/\S+)?)/);
	if (m) return { season: 2000 + parseInt(m[1]), type: 'expiry', owner: m[2] };

	m = line.match(/^\s+(\d+) protect (\S+(?:\/\S+)?)/);
	if (m) return { season: 2000 + parseInt(m[1]), type: 'protect', owner: m[2] };

	return null;
}

/**
 * Parse the DSL file into an array of player objects.
 * Each player has { header, events[] }.
 */
function parseDSL(filePath) {
	var content = fs.readFileSync(filePath, 'utf8');
	var lines = content.split('\n');
	var players = [];
	var current = null;

	for (var i = 0; i < lines.length; i++) {
		var line = lines[i];

		// Player header
		if (line.match(/^\S/) && line.indexOf('|') > 0) {
			if (current) players.push(current);
			current = { header: line.trim(), events: [], lineNumber: i + 1 };
			continue;
		}

		// Event line
		if (current) {
			var event = parseEvent(line);
			if (event) {
				event.lineNumber = i + 1;
				event.raw = line;
				current.events.push(event);
			}
		}
	}
	if (current) players.push(current);

	return players;
}

// =============================================================================
// Checks
// =============================================================================

// Events that set ownership (from unowned state)
var ACQUIRE_EVENTS = { draft: true, 'auction-ufa': true, 'auction-rfa-matched': true, 'auction-rfa-unmatched': true, fa: true };

// Auction-type events (for checks that treat all auction variants the same)
var AUCTION_EVENTS = { 'auction-ufa': true, 'auction-rfa-matched': true, 'auction-rfa-unmatched': true };

// Events that transfer ownership (from owned state) — handled separately
// trade, expansion

// Events that clear ownership
var RELEASE_EVENTS = { drop: true, cut: true, expiry: true, 'rfa-lapsed': true };

/**
 * Check 1: Owner consistency on cuts/drops.
 * The owner in "drop/cut # by OWNER" should match the current owner.
 */
function checkOwnerConsistency(player) {
	var issues = [];
	var owner = null;

	for (var i = 0; i < player.events.length; i++) {
		var e = player.events[i];

		if (ACQUIRE_EVENTS[e.type] || e.type === 'trade' || e.type === 'expansion') {
			owner = e.owner;
		} else if (e.type === 'rfa') {
			// RFA continues ownership — verify consistency
			if (owner && !sameOwner(e.owner, owner)) {
				issues.push({
					check: 'owner-mismatch',
					player: player.header,
					message: 'RFA rights to ' + e.owner + ' but owned by ' + owner,
					line: e.raw.trim(),
					lineNumber: e.lineNumber
				});
			}
			owner = e.owner;
		} else if (RELEASE_EVENTS[e.type]) {
			if (owner && !sameOwner(e.owner, owner)) {
				issues.push({
					check: 'owner-mismatch',
					player: player.header,
					message: 'Released by ' + e.owner + ' but owned by ' + owner,
					line: e.raw.trim(),
					lineNumber: e.lineNumber
				});
			}
			owner = null;
		}
		// contract and protect don't change ownership
	}

	return issues;
}

/**
 * Parse the end year from a contract detail string.
 * Examples: "08/10" -> 2010, "FA/09" -> 2009, "unsigned" -> null
 */
function parseContractEnd(detail) {
	if (!detail) return null;
	var m = detail.match(/(\d+)$/);
	if (m) return 2000 + parseInt(m[1]);
	return null;
}

/**
 * Check 2: Acquire/release state machine.
 * - Acquire events (draft, auction, fa, expansion) require unowned state.
 * - Trade requires owned state (transfers ownership).
 * - Release events (drop, cut) require owned state.
 * - Contract expiration is an implicit release (new season > contract end year).
 * - No double-acquires or double-releases.
 */
function checkAcquireRelease(player) {
	var issues = [];
	var owned = false;
	var owner = null;
	var contractEnd = null;

	for (var i = 0; i < player.events.length; i++) {
		var e = player.events[i];

		// Contract expiration: implicit release when the contract has ended.
		// Only triggers before acquire/transfer events — if the next event is
		// a cut/drop, that IS the explicit release and we shouldn't preempt it.
		//
		// Offseason events (auction, draft, expansion, cut) happen before the
		// season starts, so a contract ending in season N is expired by season N.
		// In-season events (fa, trade, drop) need the season to be strictly past.
		if (owned && contractEnd !== null && !RELEASE_EVENTS[e.type] && e.type !== 'rfa' && e.type !== 'expansion') {
			// Auction and draft happen after RFA rights expire in the offseason.
			// A contract/RFA ending in season N is expired by season N+1 auction (>=).
			// Expansion draft happens before auction — RFA rights are still valid,
			// so expansion is excluded from the implicit expiration check entirely.
			// In-season events (fa, trade, drop) use strictly past (>).
			var isAuctionOrDraft = (AUCTION_EVENTS[e.type] || e.type === 'draft');
			var expired = isAuctionOrDraft
				? e.season >= contractEnd
				: e.season > contractEnd;
			if (expired) {
				owned = false;
				owner = null;
				contractEnd = null;
			}
		}

		if (e.type === 'contract') {
			contractEnd = parseContractEnd(e.detail);
		} else if (e.type === 'trade' || e.type === 'expansion') {
			// Trades and expansion selections transfer ownership — player must be owned
			if (!owned) {
				issues.push({
					check: e.type + '-unowned',
					player: player.header,
					message: (e.type === 'trade' ? 'Traded to ' : 'Expansion selected by ') + e.owner + ' but player is not owned',
					line: e.raw.trim(),
					lineNumber: e.lineNumber
				});
			}
			owned = true;
			owner = e.owner;
		} else if (ACQUIRE_EVENTS[e.type]) {
			if (owned) {
				issues.push({
					check: 'double-acquire',
					player: player.header,
					message: 'Acquired by ' + e.owner + ' via ' + e.type + ' but already owned by ' + owner,
					line: e.raw.trim(),
					lineNumber: e.lineNumber
				});
			}
			owned = true;
			owner = e.owner;
			// FA events embed contract info (e.g. "$15 FA/18") — extract end year
			// For other acquire events, contractEnd will be set by a following contract event
			contractEnd = (e.type === 'fa') ? parseContractEnd(e.detail) : null;
		} else if (RELEASE_EVENTS[e.type]) {
			if (!owned) {
				issues.push({
					check: 'release-unowned',
					player: player.header,
					message: 'Released by ' + e.owner + ' but player is not owned',
					line: e.raw.trim(),
					lineNumber: e.lineNumber
				});
			}
			owned = false;
			owner = null;
			contractEnd = null;
		}
		else if (e.type === 'rfa') {
			// RFA rights conversion — ownership continues through the offseason.
			// Set contractEnd to the current season. The implicit expiration
			// check uses >= for auction/draft (releasing before re-auction) but
			// > for expansion (RFA rights still valid during expansion draft).
			if (!owned) {
				issues.push({
					check: 'rfa-unowned',
					player: player.header,
					message: 'RFA rights to ' + e.owner + ' but player is not owned',
					line: e.raw.trim(),
					lineNumber: e.lineNumber
				});
			}
			owned = true;
			owner = e.owner;
			contractEnd = e.season;
		}
		// protect doesn't change state
	}

	return issues;
}

/**
 * Parse the start and end year from a contract detail string.
 * "14/16" -> { start: 2014, end: 2016 }
 * "FA/16" -> { start: null, end: 2016 }
 */
function parseContractYears(detail) {
	if (!detail) return null;
	var m = detail.match(/^(FA|\d+)\/(\d+)$/);
	if (!m) return null;
	return {
		start: m[1] === 'FA' ? null : 2000 + parseInt(m[1]),
		end: 2000 + parseInt(m[2])
	};
}

/**
 * Check 3: Contract consistency.
 * After an auction or draft, the following contract event should have:
 *   - Matching salary (for auctions)
 *   - Start year matching the event season
 */
function checkContractConsistency(player) {
	var issues = [];

	for (var i = 0; i < player.events.length; i++) {
		var e = player.events[i];
		if (e.type !== 'contract') continue;

		var years = parseContractYears(e.detail);
		if (!years) continue;

		// Find the preceding acquisition event
		var prev = null;
		for (var j = i - 1; j >= 0; j--) {
			if (AUCTION_EVENTS[player.events[j].type] || player.events[j].type === 'draft') {
				prev = player.events[j];
				break;
			}
			// Stop searching if we hit a non-contract event that isn't the acquisition
			if (player.events[j].type !== 'contract') break;
		}

		if (!prev) continue;
		if (prev.season !== e.season) continue; // contract from a different context

		// Check start year matches season
		if (years.start !== null && years.start !== prev.season) {
			issues.push({
				check: 'contract-start-mismatch',
				player: player.header,
				message: 'Contract start ' + years.start + ' does not match ' + prev.type + ' season ' + prev.season,
				line: e.raw.trim(),
				lineNumber: e.lineNumber
			});
		}

		// Check salary matches (auctions only)
		if (AUCTION_EVENTS[prev.type] && prev.salary !== e.salary) {
			issues.push({
				check: 'contract-salary-mismatch',
				player: player.header,
				message: 'Contract salary $' + e.salary + ' does not match auction salary $' + prev.salary,
				line: e.raw.trim(),
				lineNumber: e.lineNumber
			});
		}
	}

	return issues;
}

/**
 * Check 4: Chronological ordering.
 * Event seasons should never decrease.
 */
function checkChronologicalOrder(player) {
	var issues = [];
	var prevSeason = 0;

	for (var i = 0; i < player.events.length; i++) {
		var e = player.events[i];
		if (e.season < prevSeason) {
			issues.push({
				check: 'out-of-order',
				player: player.header,
				message: 'Season ' + e.season + ' after season ' + prevSeason,
				line: e.raw.trim(),
				lineNumber: e.lineNumber
			});
		}
		prevSeason = e.season;
	}

	return issues;
}

/**
 * Check 5: RFA/expiry matches contract end year.
 * An rfa or expiry event in season N should only appear when the player's
 * last known contract ended in season N.
 */
function checkRfaExpiry(player) {
	var issues = [];
	var contractEnd = null;

	for (var i = 0; i < player.events.length; i++) {
		var e = player.events[i];

		if (e.type === 'contract') {
			contractEnd = parseContractEnd(e.detail);
		} else if (e.type === 'fa') {
			contractEnd = parseContractEnd(e.detail);
		} else if (e.type === 'rfa' || e.type === 'expiry') {
			if (contractEnd !== null && contractEnd !== e.season) {
				issues.push({
					check: e.type + '-season-mismatch',
					player: player.header,
					message: e.type.toUpperCase() + ' in season ' + e.season + ' but contract ends in ' + contractEnd,
					line: e.raw.trim(),
					lineNumber: e.lineNumber
				});
			}
			contractEnd = null; // reset after rfa/expiry
		} else if (e.type === 'drop' || e.type === 'cut') {
			contractEnd = null;
		}
	}

	return issues;
}

/**
 * Check 6: No duplicate events.
 * - Same trade ID should not appear twice for the same player.
 * - No two auctions in the same season for the same player.
 * - No two drafts in the same season for the same player.
 */
function checkDuplicateEvents(player) {
	var issues = [];
	var tradeIds = {};
	var auctionSeasons = {};
	var draftSeasons = {};

	for (var i = 0; i < player.events.length; i++) {
		var e = player.events[i];

		if (e.type === 'trade') {
			if (tradeIds[e.tradeId]) {
				issues.push({
					check: 'duplicate-trade',
					player: player.header,
					message: 'Trade ' + e.tradeId + ' appears multiple times',
					line: e.raw.trim(),
					lineNumber: e.lineNumber
				});
			}
			tradeIds[e.tradeId] = true;
		} else if (AUCTION_EVENTS[e.type]) {
			if (auctionSeasons[e.season]) {
				issues.push({
					check: 'duplicate-auction',
					player: player.header,
					message: 'Multiple auctions in season ' + e.season,
					line: e.raw.trim(),
					lineNumber: e.lineNumber
				});
			}
			auctionSeasons[e.season] = true;
		} else if (e.type === 'draft') {
			if (draftSeasons[e.season]) {
				issues.push({
					check: 'duplicate-draft',
					player: player.header,
					message: 'Multiple drafts in season ' + e.season,
					line: e.raw.trim(),
					lineNumber: e.lineNumber
				});
			}
			draftSeasons[e.season] = true;
		}
	}

	return issues;
}

/**
 * Check 7: Expansion from-owner consistency.
 * The fromOwner in "expansion OWNER from FROM" should match the current owner
 * tracked by the state machine.
 */
function checkExpansionFromOwner(player) {
	var issues = [];
	var owner = null;

	for (var i = 0; i < player.events.length; i++) {
		var e = player.events[i];

		if (ACQUIRE_EVENTS[e.type] || e.type === 'trade') {
			owner = e.owner;
		} else if (e.type === 'rfa') {
			owner = e.owner;
		} else if (RELEASE_EVENTS[e.type]) {
			owner = null;
		} else if (e.type === 'expansion') {
			if (owner && !sameOwner(e.fromOwner, owner)) {
				issues.push({
					check: 'expansion-from-mismatch',
					player: player.header,
					message: 'Expansion "from ' + e.fromOwner + '" but owned by ' + owner,
					line: e.raw.trim(),
					lineNumber: e.lineNumber
				});
			}
			owner = e.owner;
		}
	}

	return issues;
}

/**
 * Check 8: Contract end year >= start year.
 * Basic sanity check — no backwards contracts like 16/14.
 */
function checkContractYears(player) {
	var issues = [];

	for (var i = 0; i < player.events.length; i++) {
		var e = player.events[i];
		if (e.type !== 'contract') continue;

		var years = parseContractYears(e.detail);
		if (!years || years.start === null) continue; // FA contracts are fine

		if (years.end < years.start) {
			issues.push({
				check: 'contract-backwards',
				player: player.header,
				message: 'Contract end ' + years.end + ' is before start ' + years.start,
				line: e.raw.trim(),
				lineNumber: e.lineNumber
			});
		}
	}

	return issues;
}

/**
 * Check 9: FA contract format.
 * FA events should always have FA/YY style contracts (null start year).
 */
function checkFaContractFormat(player) {
	var issues = [];

	for (var i = 0; i < player.events.length; i++) {
		var e = player.events[i];
		if (e.type !== 'fa') continue;

		// detail is "$SALARY YY/YY" — extract the contract part
		var parts = e.detail.split(' ');
		if (parts.length < 2) continue;
		var contractPart = parts[1];

		if (!contractPart.match(/^FA\/\d+$/)) {
			issues.push({
				check: 'fa-contract-format',
				player: player.header,
				message: 'FA event has non-FA contract: ' + contractPart,
				line: e.raw.trim(),
				lineNumber: e.lineNumber
			});
		}
	}

	return issues;
}

/**
 * Check 10: Auction-RFA consistency.
 * auction-rfa-matched should be preceded by an rfa event for the same owner.
 * auction-rfa-unmatched should be preceded by an rfa event for a different owner.
 * auction-ufa should NOT be preceded by an rfa event (without an intervening release/acquire).
 */
function checkAuctionRfaConsistency(player) {
	var issues = [];
	var lastRfaOwner = null;
	var lastRfaSeason = null;

	for (var i = 0; i < player.events.length; i++) {
		var e = player.events[i];

		if (e.type === 'rfa') {
			lastRfaOwner = e.owner;
			lastRfaSeason = e.season;
		} else if (e.type === 'expiry' || RELEASE_EVENTS[e.type]) {
			lastRfaOwner = null;
			lastRfaSeason = null;
		} else if (e.type === 'auction-rfa-matched') {
			if (!lastRfaOwner) {
				issues.push({
					check: 'rfa-matched-no-rfa',
					player: player.header,
					message: 'auction-rfa-matched by ' + e.owner + ' but no preceding RFA rights',
					line: e.raw.trim(),
					lineNumber: e.lineNumber
				});
			} else if (!sameFranchise(lastRfaOwner, lastRfaSeason, e.owner, e.season)) {
				issues.push({
					check: 'rfa-matched-wrong-owner',
					player: player.header,
					message: 'auction-rfa-matched by ' + e.owner + ' but RFA rights held by ' + lastRfaOwner,
					line: e.raw.trim(),
					lineNumber: e.lineNumber
				});
			}
			lastRfaOwner = null;
			lastRfaSeason = null;
		} else if (e.type === 'auction-rfa-unmatched') {
			if (!lastRfaOwner) {
				issues.push({
					check: 'rfa-unmatched-no-rfa',
					player: player.header,
					message: 'auction-rfa-unmatched by ' + e.owner + ' but no preceding RFA rights',
					line: e.raw.trim(),
					lineNumber: e.lineNumber
				});
			} else if (sameFranchise(lastRfaOwner, lastRfaSeason, e.owner, e.season)) {
				issues.push({
					check: 'rfa-unmatched-same-owner',
					player: player.header,
					message: 'auction-rfa-unmatched by ' + e.owner + ' but they held the RFA rights',
					line: e.raw.trim(),
					lineNumber: e.lineNumber
				});
			}
			lastRfaOwner = null;
			lastRfaSeason = null;
		} else if (e.type === 'auction-ufa') {
			if (lastRfaOwner) {
				issues.push({
					check: 'ufa-after-rfa',
					player: player.header,
					message: 'auction-ufa by ' + e.owner + ' but RFA rights held by ' + lastRfaOwner,
					line: e.raw.trim(),
					lineNumber: e.lineNumber
				});
			}
			lastRfaOwner = null;
			lastRfaSeason = null;
		}
	}

	return issues;
}

/**
 * Check 11: Contract follows every acquisition.
 * Every auction-* or draft event should be followed by a contract event
 * in the same season before any other non-contract event.
 */
function checkContractFollowsAcquisition(player) {
	var issues = [];

	for (var i = 0; i < player.events.length; i++) {
		var e = player.events[i];
		if (!AUCTION_EVENTS[e.type] && e.type !== 'draft') continue;

		// Look for a contract in the same season
		var foundContract = false;
		for (var j = i + 1; j < player.events.length; j++) {
			var next = player.events[j];
			if (next.type === 'contract' && next.season === e.season) {
				foundContract = true;
				break;
			}
			// Stop if we hit a non-contract event in the same or later season
			if (next.type !== 'contract') break;
		}

		if (!foundContract) {
			issues.push({
				check: 'missing-contract',
				player: player.header,
				message: e.type + ' in ' + e.season + ' not followed by a contract',
				line: e.raw.trim(),
				lineNumber: e.lineNumber
			});
		}
	}

	return issues;
}

/**
 * Check 12: No orphan contracts.
 * A contract event should be preceded by an acquisition (auction-*, draft)
 * in the same season. Contracts from FA events are excluded (FA embeds its own contract).
 */
function checkNoOrphanContracts(player) {
	var issues = [];

	for (var i = 0; i < player.events.length; i++) {
		var e = player.events[i];
		if (e.type !== 'contract') continue;

		// Look back for a preceding acquisition in the same season
		var foundAcquisition = false;
		for (var j = i - 1; j >= 0; j--) {
			var prev = player.events[j];
			if (prev.season !== e.season) break;
			if (AUCTION_EVENTS[prev.type] || prev.type === 'draft') {
				foundAcquisition = true;
				break;
			}
			// Another contract in the same season is fine (chained after auction)
			if (prev.type === 'contract') continue;
			// Any other event type means this contract is orphaned
			break;
		}

		if (!foundAcquisition) {
			issues.push({
				check: 'orphan-contract',
				player: player.header,
				message: 'Contract in ' + e.season + ' not preceded by auction or draft',
				line: e.raw.trim(),
				lineNumber: e.lineNumber
			});
		}
	}

	return issues;
}

/**
 * Check 13: Trade continuity.
 * After a trade, the player should remain owned — no implicit contract
 * expiration in the same season as a trade. This catches trades of players
 * whose contracts have already expired.
 */
function checkTradeContinuity(player) {
	var issues = [];
	var contractEnd = null;

	for (var i = 0; i < player.events.length; i++) {
		var e = player.events[i];

		if (e.type === 'contract') {
			contractEnd = parseContractEnd(e.detail);
		} else if (e.type === 'fa') {
			contractEnd = parseContractEnd(e.detail);
		} else if (e.type === 'rfa') {
			contractEnd = e.season;
		} else if (RELEASE_EVENTS[e.type]) {
			contractEnd = null;
		} else if (e.type === 'trade') {
			if (contractEnd !== null && e.season > contractEnd) {
				issues.push({
					check: 'trade-expired-contract',
					player: player.header,
					message: 'Trade in ' + e.season + ' but contract ended in ' + contractEnd,
					line: e.raw.trim(),
					lineNumber: e.lineNumber
				});
			}
		}
	}

	return issues;
}

/**
 * Check 14: First event is an acquisition.
 * Every player's history should start with an acquire event (draft, auction-*,
 * fa, or expansion), not a release, contract, or trade.
 */
function checkFirstEventIsAcquisition(player) {
	var issues = [];

	if (player.events.length === 0) return issues;

	var first = player.events[0];
	var validFirstTypes = {
		draft: true, fa: true, expansion: true,
		'auction-ufa': true, 'auction-rfa-matched': true, 'auction-rfa-unmatched': true
	};

	if (!validFirstTypes[first.type]) {
		issues.push({
			check: 'bad-first-event',
			player: player.header,
			message: 'First event is ' + first.type + ', expected an acquisition',
			line: first.raw.trim(),
			lineNumber: first.lineNumber
		});
	}

	return issues;
}

// =============================================================================
// Main
// =============================================================================

var checks = [
	{ name: 'Owner consistency on cuts/drops', fn: checkOwnerConsistency },
	{ name: 'Acquire/release state machine', fn: checkAcquireRelease },
	{ name: 'Contract consistency', fn: checkContractConsistency },
	{ name: 'Chronological ordering', fn: checkChronologicalOrder },
	{ name: 'RFA/expiry matches contract end', fn: checkRfaExpiry },
	{ name: 'No duplicate events', fn: checkDuplicateEvents },
	{ name: 'Expansion from-owner consistency', fn: checkExpansionFromOwner },
	{ name: 'Contract end >= start', fn: checkContractYears },
	{ name: 'FA contract format', fn: checkFaContractFormat },
	{ name: 'Auction-RFA consistency', fn: checkAuctionRfaConsistency },
	{ name: 'Contract follows acquisition', fn: checkContractFollowsAcquisition },
	{ name: 'No orphan contracts', fn: checkNoOrphanContracts },
	{ name: 'Trade continuity', fn: checkTradeContinuity },
	{ name: 'First event is acquisition', fn: checkFirstEventIsAcquisition }
];

function main() {
	var players = parseDSL(DSL_FILE);
	console.log('Parsed ' + players.length + ' players from ' + DSL_FILE);
	console.log('');

	var totalIssues = 0;

	checks.forEach(function(check) {
		var issues = [];
		players.forEach(function(player) {
			issues = issues.concat(check.fn(player));
		});

		console.log('Check: ' + check.name);
		if (issues.length === 0) {
			console.log('  PASS (' + players.length + ' players)');
		} else {
			console.log('  FAIL (' + issues.length + ' issues)');
			issues.forEach(function(issue) {
				console.log('  ' + issue.player);
				console.log('    ' + issue.message);
				console.log('    ' + issue.line);
			});
		}
		console.log('');
		totalIssues += issues.length;
	});

	console.log('Total: ' + totalIssues + ' issues');
	process.exit(totalIssues > 0 ? 1 : 0);
}

main();
