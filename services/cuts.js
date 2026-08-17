var Transaction = require('../models/Transaction');
var Player = require('../models/Player');
var Franchise = require('../models/Franchise');
var Regime = require('../models/Regime');
var LeagueConfig = require('../models/LeagueConfig');
var { formatMoney, formatContractYears } = require('../helpers/view');

// Fisher-Yates shuffle
function shuffle(array) {
	var result = array.slice();
	for (var i = result.length - 1; i > 0; i--) {
		var j = Math.floor(Math.random() * (i + 1));
		var temp = result[i];
		result[i] = result[j];
		result[j] = temp;
	}
	return result;
}

/**
 * Get all offseason cuts for a season, grouped by franchise
 * @param {number} season - The season year
 * @param {Object} options
 * @param {boolean} options.shouldAnimate - If true, shuffle franchise order; if false, sort alphabetically
 */
async function getCutsForSeason(season, options) {
	options = options || {};
	var shouldAnimate = options.shouldAnimate || false;

	// Find all FA transactions with offseason drops in this season's window
	// Season window: March of season year through February of next year
	var seasonStart = new Date(season, 2, 1); // March 1
	var seasonEnd = new Date(season + 1, 2, 1); // March 1 next year

	var transactions = await Transaction.find({
		type: 'fa',
		timestamp: { $gte: seasonStart, $lt: seasonEnd },
		'drops.isOffseason': true
	}).sort({ timestamp: 1 }).lean();

	// Filter to only include drops that are actually offseason cuts
	var cutsByFranchise = {};
	var playerIds = new Set();

	transactions.forEach(function(tx) {
		var franchiseId = tx.franchiseId.toString();
		if (!cutsByFranchise[franchiseId]) {
			cutsByFranchise[franchiseId] = [];
		}

		(tx.drops || []).forEach(function(drop) {
			if (drop.isOffseason) {
				playerIds.add(drop.playerId.toString());
				cutsByFranchise[franchiseId].push({
					playerId: drop.playerId,
					salary: drop.salary,
					startYear: drop.startYear,
					endYear: drop.endYear,
					buyOuts: drop.buyOuts || [],
					timestamp: tx.timestamp
				});
			}
		});
	});

	// Load player info
	var players = playerIds.size > 0
		? await Player.find({ _id: { $in: Array.from(playerIds) } }).select('name slugs positions').lean()
		: [];
	var playerMap = {};
	players.forEach(function(p) {
		playerMap[p._id.toString()] = p;
	});

	// Load ALL franchises and regimes
	var franchises = await Franchise.find({}).lean();
	var franchiseMap = {};
	franchises.forEach(function(f) {
		franchiseMap[f._id.toString()] = f;
	});

	var regimes = await Regime.find({}).lean();

	function getRegimeName(franchiseId) {
		var fid = franchiseId.toString();
		for (var i = 0; i < regimes.length; i++) {
			var r = regimes[i];
			if (!r.tenures) continue;
			for (var j = 0; j < r.tenures.length; j++) {
				var t = r.tenures[j];
				if (t.franchiseId.toString() === fid &&
					t.startSeason <= season &&
					(t.endSeason === null || t.endSeason >= season)) {
					return r.displayName;
				}
			}
		}
		return 'Unknown';
	}

	// Calculate buyout for this season from buyOuts array
	function getBuyoutForSeason(buyOuts, targetSeason) {
		if (!buyOuts || buyOuts.length === 0) return 0;
		var entry = buyOuts.find(function(bo) { return bo.season === targetSeason; });
		return entry ? entry.amount : 0;
	}

	// Build result for ALL franchises
	var result = [];
	var totalCuts = 0;
	var totalRecovered = 0;

	franchises.forEach(function(franchise) {
		var franchiseId = franchise._id.toString();
		var cuts = cutsByFranchise[franchiseId] || [];
		var regimeName = getRegimeName(franchiseId);

		var franchiseCuts = cuts.map(function(cut) {
			var player = playerMap[cut.playerId.toString()] || {};
			var buyout = getBuyoutForSeason(cut.buyOuts, season);
			var recovered = (cut.salary || 0) - buyout;
			
			totalCuts++;
			totalRecovered += recovered;

			return {
				player: {
					_id: cut.playerId,
					name: player.name || 'Unknown',
					slug: player.slugs && player.slugs[0],
					positions: player.positions || []
				},
				salary: cut.salary,
				buyout: buyout,
				recovered: recovered,
				startYear: cut.startYear,
				endYear: cut.endYear,
				contract: formatContractYears(cut.startYear, cut.endYear),
				timestamp: cut.timestamp
			};
		});

		// Sort cuts by recovered amount descending
		franchiseCuts.sort(function(a, b) {
			return (b.recovered || 0) - (a.recovered || 0);
		});

		var franchiseRecovered = franchiseCuts.reduce(function(sum, c) {
			return sum + (c.recovered || 0);
		}, 0);

		result.push({
			franchiseId: franchiseId,
			rosterId: franchise.rosterId,
			regimeName: regimeName,
			cuts: franchiseCuts,
			totalRecovered: franchiseRecovered
		});
	});

	// Sort franchises: random if animating, alphabetical if not
	if (shouldAnimate) {
		result = shuffle(result);
	} else {
		result.sort(function(a, b) {
			return a.regimeName.localeCompare(b.regimeName);
		});
	}

	return {
		season: season,
		franchises: result,
		totalCuts: totalCuts,
		totalRecovered: totalRecovered
	};
}

/**
 * Get list of seasons that have cuts, always including the current season
 * @param {number} currentSeason - The current league season (always included even if no cuts)
 */
async function getSeasonsWithCuts(currentSeason) {
	var result = await Transaction.aggregate([
		{ $match: { type: 'fa', 'drops.isOffseason': true } },
		{ $project: {
			year: { $year: '$timestamp' },
			month: { $month: '$timestamp' }
		}},
		{ $project: {
			season: {
				$cond: {
					if: { $gte: ['$month', 3] },
					then: '$year',
					else: { $subtract: ['$year', 1] }
				}
			}
		}},
		{ $group: { _id: '$season' } },
		{ $sort: { _id: -1 } }
	]);

	var seasons = result.map(function(r) { return r._id; });
	
	// Always include current season
	if (currentSeason && seasons.indexOf(currentSeason) === -1) {
		seasons.push(currentSeason);
	}
	
	// Sort ascending (oldest first) for timeline nav
	seasons.sort(function(a, b) { return a - b; });
	
	return seasons;
}

/**
 * Determine if animation should play for the cuts page.
 * Animation plays when:
 * - Viewing the current season's cuts
 * - Within 48 hours after cut day
 */
function shouldAnimateCuts(config, requestedSeason) {
	if (!config || !config.cutDay) return false;
	
	var currentSeason = config.season;
	if (requestedSeason !== currentSeason) return false;
	
	var now = new Date();
	var cutDay = new Date(config.cutDay);
	
	// Animation window: from cut day until 48 hours after
	var windowEnd = new Date(cutDay.getTime() + 48 * 60 * 60 * 1000);
	
	return now >= cutDay && now <= windowEnd;
}

async function cutsPage(request, response) {
	var config = await LeagueConfig.findById('pso');
	var currentSeason = config ? config.season : new Date().getFullYear();

	var season = request.params.season ? parseInt(request.params.season, 10) : currentSeason;

	// Check if animation should play
	var shouldAnimate = shouldAnimateCuts(config, season);
	
	// Allow ?animate=1 query param to force animation (for testing)
	if (request.query.animate === '1') {
		shouldAnimate = true;
	}

	var seasonsWithCuts = await getSeasonsWithCuts(currentSeason);
	var cutsData = await getCutsForSeason(season, { shouldAnimate: shouldAnimate });

	response.render('cuts', {
		season: season,
		seasons: seasonsWithCuts,
		cuts: cutsData,
		shouldAnimate: shouldAnimate,
		activePage: 'cuts'
	});
}

module.exports = {
	cutsPage: cutsPage,
	getCutsForSeason: getCutsForSeason,
	getSeasonsWithCuts: getSeasonsWithCuts
};
