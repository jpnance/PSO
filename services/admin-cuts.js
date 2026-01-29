var Transaction = require('../models/Transaction');
var Player = require('../models/Player');
var Franchise = require('../models/Franchise');
var Regime = require('../models/Regime');

// Get display name for a franchise at a given season
async function getDisplayName(franchiseId, season) {
	if (!franchiseId) return 'Unknown';
	return await Regime.getDisplayName(franchiseId, season);
}

// Analyze a cut to determine if it has ordering issues
async function analyzeCut(cut, playerTxns) {
	var cutYear = cut.timestamp.getFullYear();
	var cutTime = cut.timestamp.getTime();
	
	// Find transactions that come after this cut in the same year
	var laterSameYear = playerTxns.filter(function(t) {
		return t._id.toString() !== cut._id.toString() &&
			t.timestamp.getFullYear() === cutYear &&
			t.timestamp.getTime() > cutTime;
	});
	
	// Check for specific impossible orderings
	var hasDraftAfter = laterSameYear.some(function(t) { return t.type === 'draft-select'; });
	var hasTradeAfter = laterSameYear.some(function(t) { return t.type === 'trade'; });
	var hasPickupAfter = laterSameYear.some(function(t) { return t.type === 'fa' && t.adds && t.adds.length > 0; });
	var hasAuctionAfter = laterSameYear.some(function(t) { 
		return t.type === 'auction-ufa' || t.type === 'auction-rfa-matched' || t.type === 'auction-rfa-unmatched';
	});
	
	// A cut before a draft in the same year is definitively wrong
	var isImpossible = hasDraftAfter;
	
	// A cut before trade/pickup/auction is suspicious but not always wrong
	var isSuspicious = hasTradeAfter || hasPickupAfter || hasAuctionAfter;
	
	return {
		isImpossible: isImpossible,
		isSuspicious: isSuspicious,
		hasDraftAfter: hasDraftAfter,
		hasTradeAfter: hasTradeAfter,
		hasPickupAfter: hasPickupAfter,
		hasAuctionAfter: hasAuctionAfter,
		laterSameYear: laterSameYear
	};
}

// GET /admin/cuts - list cuts needing review
async function listCuts(request, response) {
	var filter = request.query.filter || 'impossible'; // impossible, suspicious, all
	var yearFilter = request.query.year ? parseInt(request.query.year, 10) : null;
	var page = Math.max(1, parseInt(request.query.page, 10) || 1);
	var perPage = 50;
	
	// Build query for snapshot-sourced cuts (FA transactions with drops but no adds)
	var query = { type: 'fa', source: 'snapshot', adds: { $size: 0 } };
	if (yearFilter) {
		var startOfYear = new Date(yearFilter, 0, 1);
		var endOfYear = new Date(yearFilter + 1, 0, 1);
		query.timestamp = { $gte: startOfYear, $lt: endOfYear };
	}
	
	// Get all cuts matching the basic filter
	var allCuts = await Transaction.find(query)
		.populate('drops.playerId', 'name positions')
		.populate('franchiseId', 'rosterId')
		.sort({ timestamp: -1 })
		.lean();
	
	// Get unique years for filter dropdown
	var yearsSet = new Set();
	allCuts.forEach(function(c) {
		yearsSet.add(c.timestamp.getFullYear());
	});
	var years = Array.from(yearsSet).sort(function(a, b) { return b - a; });
	
	// Analyze each cut for ordering issues
	var analyzedCuts = [];
	
	for (var i = 0; i < allCuts.length; i++) {
		var cut = allCuts[i];
		var dropInfo = cut.drops && cut.drops[0];
		if (!dropInfo || !dropInfo.playerId) continue;
		
		// For compatibility, set cut.playerId to the dropped player
		cut.playerId = dropInfo.playerId;
		
		// Get all transactions for this player
		var playerTxns = await Transaction.find({
			$or: [
				{ playerId: dropInfo.playerId._id },
				{ 'parties.receives.players.playerId': dropInfo.playerId._id },
				{ 'parties.receives.rfaRights.playerId': dropInfo.playerId._id },
				{ 'adds.playerId': dropInfo.playerId._id },
				{ 'drops.playerId': dropInfo.playerId._id }
			]
		}).sort({ timestamp: 1 }).lean();
		
		var analysis = await analyzeCut(cut, playerTxns);
		
		// Apply filter
		if (filter === 'impossible' && !analysis.isImpossible) continue;
		if (filter === 'suspicious' && !analysis.isSuspicious && !analysis.isImpossible) continue;
		
		var franchiseName = await getDisplayName(cut.franchiseId._id, cut.timestamp.getFullYear());
		
		var dropInfo = cut.drops && cut.drops[0];
		analyzedCuts.push({
			_id: cut._id,
			player: cut.playerId,
			franchiseName: franchiseName,
			timestamp: cut.timestamp,
			cutYear: cut.timestamp.getFullYear(),
			buyOuts: dropInfo ? dropInfo.buyOuts : [],
			analysis: analysis
		});
	}
	
	// Stats
	var stats = {
		total: allCuts.length,
		showing: analyzedCuts.length
	};
	
	// Paginate
	var totalPages = Math.ceil(analyzedCuts.length / perPage);
	var paginatedCuts = analyzedCuts.slice((page - 1) * perPage, page * perPage);
	
	response.render('admin-cuts', {
		cuts: paginatedCuts,
		stats: stats,
		filter: filter,
		yearFilter: yearFilter,
		years: years,
		page: page,
		totalPages: totalPages,
		activePage: 'admin-cuts'
	});
}

// GET /admin/cuts/:id - edit form for a single cut
async function editCutForm(request, response) {
	var cut = await Transaction.findById(request.params.id)
		.populate('drops.playerId', 'name positions')
		.populate('franchiseId', 'rosterId')
		.lean();
	
	if (!cut || cut.type !== 'fa') {
		return response.status(404).send('Cut not found');
	}
	
	// Get the dropped player info
	var dropInfo = cut.drops && cut.drops[0];
	if (!dropInfo || !dropInfo.playerId) {
		return response.status(404).send('Cut has no drop info');
	}
	
	// For compatibility with templates that expect cut.playerId
	cut.playerId = dropInfo.playerId;
	
	var cutYear = cut.timestamp.getFullYear();
	var franchiseName = await getDisplayName(cut.franchiseId._id, cutYear);
	
	// Get all transactions for this player for context
	var playerTxns = await Transaction.find({
		$or: [
			{ playerId: dropInfo.playerId._id },
			{ 'parties.receives.players.playerId': dropInfo.playerId._id },
			{ 'parties.receives.rfaRights.playerId': dropInfo.playerId._id },
			{ 'adds.playerId': dropInfo.playerId._id },
			{ 'drops.playerId': dropInfo.playerId._id }
		]
	}).populate('franchiseId', 'rosterId').sort({ timestamp: 1 }).lean();
	
	// Build timeline entries
	var timeline = [];
	for (var i = 0; i < playerTxns.length; i++) {
		var t = playerTxns[i];
		var tYear = t.timestamp.getFullYear();
		var tFranchiseName = t.franchiseId ? await getDisplayName(t.franchiseId._id, tYear) : null;
		
		var description = t.type;
		switch (t.type) {
			case 'draft-select':
				description = 'Drafted by ' + tFranchiseName;
				break;
			case 'fa':
				// Check if this is an add or drop (or both)
				var hasAdds = t.adds && t.adds.length > 0;
				var hasDrops = t.drops && t.drops.length > 0;
				if (hasAdds && hasDrops) {
					description = 'Swap by ' + tFranchiseName;
				} else if (hasAdds) {
					description = 'Signed by ' + tFranchiseName;
				} else if (hasDrops) {
					description = 'Cut by ' + tFranchiseName;
				}
				break;
			case 'trade':
				description = 'Traded';
				break;
			case 'auction-ufa':
			case 'auction-rfa-matched':
			case 'auction-rfa-unmatched':
				description = 'Auctioned to ' + tFranchiseName;
				break;
			case 'contract':
				description = 'Contract set';
				break;
		}
		
		timeline.push({
			_id: t._id,
			type: t.type,
			timestamp: t.timestamp,
			description: description,
			source: t.source,
			isCurrent: t._id.toString() === cut._id.toString(),
			isJan1: t.timestamp.getDate() === 1 && t.timestamp.getMonth() === 0
		});
	}
	
	// Analyze for issues
	var analysis = await analyzeCut(cut, playerTxns);
	
	response.render('admin-cut-edit', {
		cut: cut,
		franchiseName: franchiseName,
		timeline: timeline,
		analysis: analysis,
		query: request.query,
		activePage: 'admin-cuts'
	});
}

// POST /admin/cuts/:id - update cut timestamp
async function editCut(request, response) {
	var cutId = request.params.id;
	var body = request.body;
	
	var cut = await Transaction.findById(cutId);
	if (!cut || cut.type !== 'fa') {
		return response.status(404).send('Cut not found');
	}
	
	// Update timestamp if provided
	if (body.timestamp) {
		var parts = body.timestamp.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
		if (parts) {
			var year = parseInt(parts[1], 10);
			var month = parseInt(parts[2], 10) - 1;
			var day = parseInt(parts[3], 10);
			var hours = parseInt(parts[4], 10);
			var mins = parseInt(parts[5], 10);
			
			cut.timestamp = new Date(year, month, day, hours, mins, 0);
		}
	}
	
	// Update notes if provided
	if (body.notes !== undefined) {
		cut.notes = body.notes.trim() || null;
	}
	
	await cut.save();
	
	response.redirect('/admin/cuts/' + cutId + '?saved=1');
}

// POST /admin/cuts/:id/auto-fix - automatically fix cut that precedes draft
async function autoFixCut(request, response) {
	var cutId = request.params.id;
	
	var cut = await Transaction.findById(cutId).populate('drops.playerId');
	if (!cut || cut.type !== 'fa') {
		return response.status(404).send('Cut not found');
	}
	
	var dropInfo = cut.drops && cut.drops[0];
	if (!dropInfo || !dropInfo.playerId) {
		return response.status(404).send('Cut has no drop info');
	}
	
	var cutYear = cut.timestamp.getFullYear();
	
	// Find draft transaction for this player in the same year
	var draft = await Transaction.findOne({
		$or: [
			{ playerId: dropInfo.playerId._id, type: 'draft-select' }
		],
		timestamp: {
			$gte: new Date(cutYear, 0, 1),
			$lt: new Date(cutYear + 1, 0, 1)
		}
	});
	
	if (!draft) {
		return response.redirect('/admin/cuts/' + cutId + '?error=no-draft');
	}
	
	// Set cut to one day after draft
	var newTimestamp = new Date(draft.timestamp.getTime() + 24 * 60 * 60 * 1000);
	cut.timestamp = newTimestamp;
	cut.notes = (cut.notes ? cut.notes + ' ' : '') + '[Auto-fixed: moved after draft]';
	
	await cut.save();
	
	response.redirect('/admin/cuts/' + cutId + '?saved=1&auto-fixed=1');
}

module.exports = {
	listCuts: listCuts,
	editCutForm: editCutForm,
	editCut: editCut,
	autoFixCut: autoFixCut
};
