var mongoose = require('mongoose');
var LeagueConfig = require('../models/LeagueConfig');
var Franchise = require('../models/Franchise');
var Regime = require('../models/Regime');
var Contract = require('../models/Contract');
var Budget = require('../models/Budget');
var Pick = require('../models/Pick');
var Player = require('../models/Player');
var Transaction = require('../models/Transaction');
var Proposal = require('../models/Proposal');
var transactionService = require('./transaction');
var budgetHelper = require('../helpers/budget');
var { formatMoney, formatContractYears, formatContractDisplay, ordinal, getPositionIndex } = require('../helpers/view');

var computeBuyOutIfCut = budgetHelper.computeBuyOutIfCut;

// Cached player names for slug generation
var cachedFirstNames = null;
var cachedLastNames = null;

// Load and cache player names for slug generation
async function loadPlayerNames() {
	if (cachedFirstNames && cachedLastNames) {
		return { firstNames: cachedFirstNames, lastNames: cachedLastNames };
	}
	
	var players = await Player.find({}).select('name').lean();
	
	var firstNames = [];
	var lastNames = [];
	
	players.forEach(function(p) {
		if (!p.name) return;
		var parts = p.name.split(' ');
		if (parts.length >= 1) {
			var first = parts[0].toLowerCase().replace(/[^a-z-]/g, '');
			if (first) firstNames.push(first);
		}
		if (parts.length >= 2) {
			var last = parts[parts.length - 1].toLowerCase().replace(/[^a-z-]/g, '');
			if (last) lastNames.push(last);
		}
	});
	
	// Dedupe
	cachedFirstNames = Array.from(new Set(firstNames));
	cachedLastNames = Array.from(new Set(lastNames));
	
	return { firstNames: cachedFirstNames, lastNames: cachedLastNames };
}

// Generate a fun slug like "lamar-kelce-for-tom-jefferson"
async function generateTradeSlug() {
	var names = await loadPlayerNames();
	
	function pick(arr) {
		return arr[Math.floor(Math.random() * arr.length)];
	}
	
	var first1 = pick(names.firstNames);
	var last1 = pick(names.lastNames);
	var first2 = pick(names.firstNames);
	var last2 = pick(names.lastNames);
	
	return first1 + '-' + last1 + '-for-' + first2 + '-' + last2;
}

// Get all data needed for the trade machine
async function getTradeData(currentSeason) {
	// Get all franchises and their current regimes
	var franchises = await Franchise.find({}).lean();
	var regimes = await Regime.find({
		$or: [
			{ endSeason: null },
			{ endSeason: { $gte: currentSeason } }
		]
	}).lean();
	
	// Get all contracts with player data
	var contracts = await Contract.find({})
		.populate('playerId')
		.lean();
	
	// Get all available picks for upcoming seasons
	var picks = await Pick.find({
		status: 'available',
		season: { $gte: currentSeason }
	})
		.populate('originalFranchiseId')
		.populate('currentFranchiseId')
		.sort({ season: 1, round: 1 })
		.lean();
	
	// Get budgets for current season
	var budgets = await Budget.find({ season: currentSeason }).lean();
	var budgetByFranchise = {};
	budgets.forEach(function(b) {
		budgetByFranchise[b.franchiseId.toString()] = b;
	});
	
	// Build franchise list with display names and budget info
	var franchiseList = franchises.map(function(f) {
		var regime = regimes.find(function(r) {
			return r.franchiseId.equals(f._id) &&
				r.startSeason <= currentSeason &&
				(r.endSeason === null || r.endSeason >= currentSeason);
		});
		
		// Get active contracts (with salary, for current season)
		var activeContracts = contracts.filter(function(c) {
			return c.franchiseId.equals(f._id) && 
				c.salary !== null &&
				c.endYear && c.endYear >= currentSeason;
		});
		
		// Get available and recoverable from Budget document
		var budget = budgetByFranchise[f._id.toString()];
		var available = budget ? budget.available : 1000;
		var recoverable = budget ? budget.recoverable : 0;
		
		return {
			_id: f._id,
			displayName: regime ? regime.displayName : 'Unknown',
			rosterCount: activeContracts.length,
			available: available,
			recoverable: recoverable
		};
	}).sort(function(a, b) {
		return a.displayName.localeCompare(b.displayName);
	});
	
	// Helper to get franchise name by ID
	function getFranchiseName(franchiseId, season) {
		var regime = regimes.find(function(r) {
			return r.franchiseId.equals(franchiseId) &&
				r.startSeason <= (season || currentSeason) &&
				(r.endSeason === null || r.endSeason >= (season || currentSeason));
		});
		return regime ? regime.displayName : 'Unknown';
	}
	
	// Build teams object: { franchiseId: [players] }
	var teams = {};
	franchiseList.forEach(function(f) {
		teams[f._id.toString()] = [];
	});
	
	contracts.forEach(function(c) {
		if (!c.playerId) return;
		
		var franchiseId = c.franchiseId.toString();
		if (!teams[franchiseId]) return;
		
		var terms, contract;
		
		if (c.salary === null) {
			// RFA rights
			terms = 'rfa-rights';
			contract = null;
		} else if (!c.endYear) {
			// Unsigned (shouldn't really happen in normal flow)
			terms = 'unsigned';
			contract = null;
		} else {
			terms = 'signed';
			contract = formatContractYears(c.startYear, c.endYear);
		}
		
		// Calculate this player's recoverable (salary - buyout)
		var playerRecoverable = 0;
		if (c.salary !== null && c.endYear && c.endYear >= currentSeason) {
			var buyOut = computeBuyOutIfCut(c.salary, c.startYear, c.endYear, currentSeason);
			playerRecoverable = c.salary - buyOut;
		}
		
		// Pre-compute the contract display for client-side use
		var contractDisplay = null;
		if (c.salary === null) {
			contractDisplay = 'RFA rights';
		} else if (!c.endYear) {
			contractDisplay = formatContractDisplay(c.salary, null, null);
		} else {
			contractDisplay = formatContractDisplay(c.salary, c.startYear, c.endYear);
		}
		
		teams[franchiseId].push({
			id: c.playerId._id.toString(),
			name: c.playerId.name,
			positions: c.playerId.positions || [],
			salary: c.salary,
			terms: terms,
			contract: contract,
			contractDisplay: contractDisplay,
			recoverable: playerRecoverable
		});
	});
	
	// Sort each team's roster
	Object.keys(teams).forEach(function(franchiseId) {
		teams[franchiseId].sort(function(a, b) {
			return a.name.localeCompare(b.name);
		});
	});
	
	// Build picks list with origin info
	var pickList = picks.map(function(p) {
		var owner = getFranchiseName(p.currentFranchiseId._id || p.currentFranchiseId, p.season);
		var origin = getFranchiseName(p.originalFranchiseId._id || p.originalFranchiseId, p.season);
		
		return {
			id: p._id.toString(),
			season: p.season,
			round: p.round,
			pickNumber: p.pickNumber || null,
			owner: owner,
			ownerId: (p.currentFranchiseId._id || p.currentFranchiseId).toString(),
			origin: origin
		};
	});
	
	// Sort picks by season, then by pick number (or round + origin if no pick number)
	pickList.sort(function(a, b) {
		// First by season
		if (a.season !== b.season) return a.season - b.season;
		// Then by pick number if both have one
		if (a.pickNumber && b.pickNumber) return a.pickNumber - b.pickNumber;
		// If only one has a pick number, numbered picks first
		if (a.pickNumber && !b.pickNumber) return -1;
		if (!a.pickNumber && b.pickNumber) return 1;
		// Neither has pick number: sort by round, then origin
		if (a.round !== b.round) return a.round - b.round;
		return a.origin.localeCompare(b.origin);
	});
	
	return {
		franchises: franchiseList,
		teams: teams,
		picks: pickList,
		currentSeason: currentSeason
	};
}

// Determine if a franchise name is plural (for grammar)
function isPlural(name) {
	return name === 'Schexes' || name.includes('/');
}

// Route handler for the trade machine page (owner mode)
async function tradeMachinePage(request, response) {
	try {
		var config = await LeagueConfig.findById('pso');
		var currentSeason = config ? config.season : new Date().getFullYear();
		
		var data = await getTradeData(currentSeason);
		
		// Determine if we're before cut day
		var today = new Date();
		var cutDay = config && config.cutDay ? new Date(config.cutDay) : null;
		var isBeforeCutDay = !cutDay || today < cutDay;
		
		// Check if user is logged in and owns any franchise
		var user = request.user;
		var userFranchiseIds = [];
		if (user) {
			var franchises = await getUserFranchises(user);
			userFranchiseIds = franchises.map(function(f) { return f.toString(); });
		}
		
		// Check if trades are currently enabled
		var tradesCheck = await checkTradesEnabled();
		var tradesEnabled = tradesCheck.enabled;
		
		// Check for pre-population from an existing proposal
		var initialDeal = null;
		if (request.query.from) {
			var sourceProposal = await Proposal.findOne({ publicId: request.query.from });
			if (sourceProposal) {
				// Build initialDeal structure: { franchiseId: { players: [id, ...], picks: [id, ...], cash: [...] } }
				initialDeal = {};
				for (var i = 0; i < sourceProposal.parties.length; i++) {
					var party = sourceProposal.parties[i];
					var franchiseId = party.franchiseId.toString();
					
					initialDeal[franchiseId] = {
						players: party.receives.players.map(function(p) { return p.playerId.toString(); }),
						picks: party.receives.picks.map(function(p) { return p.pickId.toString(); }),
						cash: party.receives.cash.map(function(c) {
							return {
								amount: c.amount,
								from: c.fromFranchiseId.toString(),
								season: c.season
							};
						})
					};
				}
			}
		}
		
		response.render('trade', {
			franchises: data.franchises,
			teams: data.teams,
			picks: data.picks,
			season: currentSeason,
			isPlural: isPlural,
			isBeforeCutDay: isBeforeCutDay,
			rosterLimit: LeagueConfig.ROSTER_LIMIT,
			isLoggedIn: !!user,
			userFranchiseIds: userFranchiseIds,
			tradesEnabled: tradesEnabled,
			initialDeal: initialDeal,
			activePage: 'trade-machine'
		});
	} catch (err) {
		console.error(err);
		response.status(500).send('Error loading trade data');
	}
}

// Route handler for processing trades (commissioner mode)
async function processPage(request, response) {
	try {
		var config = await LeagueConfig.findById('pso');
		var currentSeason = config ? config.season : new Date().getFullYear();
		
		var data = await getTradeData(currentSeason);
		
		// Determine if we're before cut day
		var today = new Date();
		var cutDay = config && config.cutDay ? new Date(config.cutDay) : null;
		var isBeforeCutDay = !cutDay || today < cutDay;
		
		// Get a random player not on an NFL team for the confirmation prompt
		var teamlessPlayers = await Player.find({ team: null }).select('name').lean();
		var randomPlayer = teamlessPlayers.length > 0 
			? teamlessPlayers[Math.floor(Math.random() * teamlessPlayers.length)]
			: { name: 'EXECUTE' };
		
		response.render('trade', {
			franchises: data.franchises,
			teams: data.teams,
			picks: data.picks,
			season: currentSeason,
			isPlural: isPlural,
			isBeforeCutDay: isBeforeCutDay,
			rosterLimit: LeagueConfig.ROSTER_LIMIT,
			isProcessingMode: true,
			confirmName: randomPlayer.name,
			activePage: 'admin'
		});
	} catch (err) {
		console.error(err);
		response.status(500).send('Error loading trade data');
	}
}

// Submit a trade (admin only)
async function submitTrade(request, response) {
	try {
		var deal = request.body.deal;
		
		if (!deal || typeof deal !== 'object') {
			return response.status(400).json({ success: false, errors: ['Invalid trade data'] });
		}
		
		var franchiseIds = Object.keys(deal);
		
		if (franchiseIds.length < 2) {
			return response.status(400).json({ success: false, errors: ['Trade must have at least 2 parties'] });
		}
		
		// Check for duplicate players across parties (server-side validation)
		var allPlayerIds = [];
		var duplicatePlayers = [];
		
		for (var i = 0; i < franchiseIds.length; i++) {
			var bucket = deal[franchiseIds[i]];
			var players = bucket.players || [];
			
			for (var j = 0; j < players.length; j++) {
				var playerId = players[j].id;
				if (allPlayerIds.includes(playerId)) {
					duplicatePlayers.push(players[j].name || playerId);
				} else {
					allPlayerIds.push(playerId);
				}
			}
		}
		
		if (duplicatePlayers.length > 0) {
			return response.status(400).json({ 
				success: false, 
				errors: ['Duplicate player(s) in trade: ' + duplicatePlayers.join(', ')] 
			});
		}
		
		// Transform client deal format to processTrade format
		var parties = [];
		
		for (var i = 0; i < franchiseIds.length; i++) {
			var franchiseId = franchiseIds[i];
			var bucket = deal[franchiseId];
			
			var receives = {
				players: [],
				picks: [],
				cash: []
			};
			
			// Transform players
			for (var j = 0; j < (bucket.players || []).length; j++) {
				var player = bucket.players[j];
				
				// Look up the contract to get salary/terms
				var contract = await Contract.findOne({ playerId: player.id });
				if (!contract) {
					return response.status(400).json({ 
						success: false, 
						errors: ['Contract not found for player: ' + (player.name || player.id)] 
					});
				}
				
				receives.players.push({
					playerId: contract.playerId,
					salary: contract.salary,
					startYear: contract.startYear,
					endYear: contract.endYear
				});
			}
			
			// Transform picks
			for (var j = 0; j < (bucket.picks || []).length; j++) {
				var pick = bucket.picks[j];
				receives.picks.push({
					pickId: pick.id
				});
			}
			
			// Transform cash
			for (var j = 0; j < (bucket.cash || []).length; j++) {
				var cash = bucket.cash[j];
				receives.cash.push({
					amount: cash.amount,
					season: cash.season,
					fromFranchiseId: cash.from
				});
			}
			
			// franchiseId needs to be ObjectId because processTrade() uses .equals() on it
			parties.push({
				franchiseId: new mongoose.Types.ObjectId(franchiseId),
				receives: receives
			});
		}
		
		// Call processTrade (with validateOnly flag if set)
		var validateOnly = request.body.validateOnly === true;
		
		var result = await transactionService.processTrade({
			timestamp: new Date(),
			source: 'manual',
			notes: request.body.notes || null,
			parties: parties,
			validateOnly: validateOnly
		});
		
		if (result.success) {
			if (result.validated) {
				// Validation only - no transaction created yet
				response.json({
					success: true,
					validated: true,
					warnings: result.warnings || []
				});
			} else {
				// Trade executed
				response.json({
					success: true,
					tradeId: result.transaction.tradeId,
					warnings: result.warnings || []
				});
			}
		} else {
			response.status(400).json({
				success: false,
				errors: result.errors || ['Unknown error processing trade']
			});
		}
	} catch (err) {
		console.error('submitTrade error:', err);
		response.status(500).json({ success: false, errors: ['Server error: ' + err.message] });
	}
}

// ========== Trade Proposal Functions ==========

// Create a proposal with retry logic for publicId collisions
async function createProposalWithRetry(data, maxRetries) {
	maxRetries = maxRetries || 5;
	
	// Generate a fun slug for this proposal
	data.publicId = await generateTradeSlug();
	
	for (var attempt = 0; attempt < maxRetries; attempt++) {
		try {
			return await Proposal.create(data);
		} catch (err) {
			// Check if it's a duplicate key error on publicId
			if (err.code === 11000 && err.keyPattern && err.keyPattern.publicId) {
				// Regenerate slug and retry
				data.publicId = await generateTradeSlug();
				continue;
			}
			// Some other error, rethrow
			throw err;
		}
	}
	
	throw new Error('Failed to generate unique publicId after ' + maxRetries + ' attempts');
}

// Compute expiration date: 7 days from now or trade deadline, whichever is first
async function computeExpiresAt() {
	var sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
	
	var config = await LeagueConfig.findById('pso');
	if (config && config.tradeDeadline) {
		var deadline = new Date(config.tradeDeadline);
		if (deadline < sevenDaysFromNow) {
			return deadline;
		}
	}
	
	return sevenDaysFromNow;
}

// Get display name for a franchise in current season
async function getFranchiseDisplayName(franchiseId) {
	var config = await LeagueConfig.findById('pso');
	var season = config ? config.season : new Date().getFullYear();
	
	var regime = await Regime.findOne({
		franchiseId: franchiseId,
		startSeason: { $lte: season },
		$or: [{ endSeason: null }, { endSeason: { $gte: season } }]
	});
	
	return regime ? regime.displayName : 'Unknown';
}

// Get regime with owner first names populated
// Find which franchise(s) the current user owns
async function getUserFranchises(user) {
	if (!user) return [];
	
	var config = await LeagueConfig.findById('pso');
	var season = config ? config.season : new Date().getFullYear();
	
	var regimes = await Regime.find({
		ownerIds: user._id,
		startSeason: { $lte: season },
		$or: [{ endSeason: null }, { endSeason: { $gte: season } }]
	});
	
	return regimes.map(function(r) { return r.franchiseId; });
}

// Check if user owns a specific franchise
async function userOwnsFranchise(user, franchiseId) {
	var userFranchises = await getUserFranchises(user);
	return userFranchises.some(function(fid) {
		return fid.equals(franchiseId);
	});
}

// Check if trades are currently allowed
async function checkTradesEnabled() {
	var config = await LeagueConfig.findById('pso');
	if (!config) return { enabled: true };
	
	if (!config.areTradesEnabled()) {
		var phase = config.getPhase().replace(/-/g, ' ');
		return { 
			enabled: false, 
			error: 'Trades are not allowed during the ' + phase + ' phase.'
		};
	}
	
	return { enabled: true };
}

// Create a new trade proposal (hypothetical or pending)
async function createProposal(request, response) {
	try {
		var user = request.user;
		if (!user) {
			return response.status(401).json({ success: false, errors: ['Login required'] });
		}
		
		var deal = request.body.deal;
		if (!deal || typeof deal !== 'object') {
			return response.status(400).json({ success: false, errors: ['Invalid trade data'] });
		}
		
		var franchiseIds = Object.keys(deal);
		if (franchiseIds.length < 2) {
			return response.status(400).json({ success: false, errors: ['Trade must have at least 2 parties'] });
		}
		
		// Check if user owns any of the franchises in the trade
		var userFranchises = await getUserFranchises(user);
		var userFranchiseInTrade = franchiseIds.find(function(fid) {
			return userFranchises.some(function(uf) { return uf.equals(fid); });
		});
		
		var isHypothetical = request.body.isHypothetical === true;
		
		// For pending proposals, check if trades are enabled (hypothetical trades can be shared anytime)
		if (!isHypothetical) {
			var tradesCheck = await checkTradesEnabled();
			if (!tradesCheck.enabled) {
				return response.status(400).json({ success: false, errors: [tradesCheck.error] });
			}
		}
		
		// For pending proposals, user must be a party. For hypothetical trades, anyone with a franchise can share.
		if (!isHypothetical && !userFranchiseInTrade) {
			return response.status(403).json({ success: false, errors: ['You must be party to this trade to propose it'] });
		}
		
		if (!userFranchises.length) {
			return response.status(403).json({ success: false, errors: ['You must own a franchise to share trades'] });
		}
		
		// Build parties array (with full contract info for validation)
		var parties = [];
		var validationParties = [];
		
		for (var i = 0; i < franchiseIds.length; i++) {
			var franchiseId = franchiseIds[i];
			var bucket = deal[franchiseId];
			
			var receives = {
				players: [],
				picks: [],
				cash: []
			};
			
			var validationReceives = {
				players: [],
				picks: [],
				cash: []
			};
			
			// Players - store IDs for proposal, full contract info for validation
			for (var j = 0; j < (bucket.players || []).length; j++) {
				var playerData = bucket.players[j];
				receives.players.push({ playerId: playerData.id });
				
				// Look up contract for validation
				var contract = await Contract.findOne({ playerId: playerData.id });
				if (contract) {
					validationReceives.players.push({
						playerId: contract.playerId,
						salary: contract.salary,
						startYear: contract.startYear,
						endYear: contract.endYear
					});
				}
			}
			
			// Picks
			for (var j = 0; j < (bucket.picks || []).length; j++) {
				var pickData = { pickId: bucket.picks[j].id };
				receives.picks.push(pickData);
				validationReceives.picks.push(pickData);
			}
			
			// Cash
			for (var j = 0; j < (bucket.cash || []).length; j++) {
				var cash = bucket.cash[j];
				var cashData = {
					amount: cash.amount,
					season: cash.season,
					fromFranchiseId: cash.from
				};
				receives.cash.push(cashData);
				validationReceives.cash.push(cashData);
			}
			
			var franchiseOid = new mongoose.Types.ObjectId(franchiseId);
			
			parties.push({
				franchiseId: franchiseOid,
				receives: receives,
				accepted: false,
				acceptedAt: null,
				acceptedBy: null
			});
			
			validationParties.push({
				franchiseId: franchiseOid,
				receives: validationReceives
			});
		}
		
		// Validate the trade before creating proposal
		var validationResult = await transactionService.processTrade({
			timestamp: new Date(),
			source: 'manual',
			parties: validationParties,
			validateOnly: true
		});
		
		if (!validationResult.success) {
			return response.status(400).json({
				success: false,
				errors: validationResult.errors || ['Trade validation failed']
			});
		}
		
		var expiresAt = await computeExpiresAt();
		var now = new Date();
		
		// For pending proposals (not hypothetical), mark the proposer's party as accepted
		if (!isHypothetical) {
			for (var i = 0; i < parties.length; i++) {
				if (parties[i].franchiseId.equals(userFranchiseInTrade)) {
					parties[i].accepted = true;
					parties[i].acceptedAt = now;
					parties[i].acceptedBy = user._id;
				}
			}
		}
		
		// For hypothetical trades where user isn't a party, use their first franchise as creator
		var creatorFranchiseId = userFranchiseInTrade || userFranchises[0];
		
		var proposal = await createProposalWithRetry({
			status: isHypothetical ? 'hypothetical' : 'pending',
			createdByFranchiseId: creatorFranchiseId,
			createdByPersonId: user._id,
			createdAt: now,
			expiresAt: expiresAt,
			acceptanceWindowStart: isHypothetical ? null : now,  // Proposer accepting starts the clock
			parties: parties,
			notes: request.body.notes || null
		});
		
		response.json({
			success: true,
			proposalId: proposal.publicId
		});
	} catch (err) {
		console.error('createProposal error:', err);
		response.status(500).json({ success: false, errors: ['Server error: ' + err.message] });
	}
}

// View a proposal
async function viewProposal(request, response) {
	try {
		var publicId = request.params.slug;
		
		var proposal = await Proposal.findOne({ publicId: publicId })
			.populate('createdByPersonId', 'name')
			.populate('parties.franchiseId');
		
		if (!proposal) {
			return response.status(404).render('proposal-not-found');
		}
		
		var config = await LeagueConfig.findById('pso');
		var currentSeason = config ? config.season : new Date().getFullYear();
		var auctionSeason = computeAuctionSeason(config);
		
		// Check and handle expiration
		if (proposal.status === 'hypothetical' || proposal.status === 'pending') {
			if (proposal.isExpired()) {
				proposal.status = 'expired';
				await proposal.save();
			} else if (proposal.status === 'pending' && proposal.isAcceptanceWindowExpired()) {
				// Reset acceptances if 10-minute window expired
				proposal.resetAcceptances();
				await proposal.save();
			}
		}
		
		// Get display data for parties (matching trade history format)
		var partiesDisplay = [];
		for (var i = 0; i < proposal.parties.length; i++) {
			var party = proposal.parties[i];
			var displayName = await getFranchiseDisplayName(party.franchiseId);
			var usePlural = displayName === 'Schexes' || displayName.includes('/');
			
			// Build unified assets array (same format as trade history)
			var assets = [];
			
			// Players first, sorted by salary desc
			var playerData = [];
			for (var j = 0; j < party.receives.players.length; j++) {
				var player = await Player.findById(party.receives.players[j].playerId);
				var contract = await Contract.findOne({ playerId: party.receives.players[j].playerId });
				playerData.push({ player: player, contract: contract });
			}
			playerData.sort(function(a, b) {
				return ((b.contract ? b.contract.salary : 0) || 0) - ((a.contract ? a.contract.salary : 0) || 0);
			});
			
			for (var j = 0; j < playerData.length; j++) {
				var player = playerData[j].player;
				var contract = playerData[j].contract;
				var playerName = player ? player.name : 'Unknown';
				var positions = player ? player.positions : [];
				
				if (contract && contract.salary === null) {
					// RFA rights
					assets.push({
						type: 'rfa',
						playerName: playerName,
						contractInfo: 'RFA rights',
						positions: positions,
						salary: 0
					});
				} else if (contract) {
					// Regular player
					assets.push({
						type: 'player',
						playerName: playerName,
						contractInfo: formatContractDisplay(contract.salary || 0, contract.startYear, contract.endYear),
						positions: positions,
						salary: contract.salary || 0
					});
				} else {
					// No contract found
					assets.push({
						type: 'player',
						playerName: playerName,
						contractInfo: '(no contract)',
						positions: positions,
						salary: 0
					});
				}
			}
			
			// Picks - sorted by season then round
			var pickData = [];
			for (var j = 0; j < party.receives.picks.length; j++) {
				var pick = await Pick.findById(party.receives.picks[j].pickId);
				if (pick) {
					var origin = await getFranchiseDisplayName(pick.originalFranchiseId);
					pickData.push({ pick: pick, origin: origin });
				}
			}
			pickData.sort(function(a, b) {
				if (a.pick.season !== b.pick.season) return a.pick.season - b.pick.season;
				return a.pick.round - b.pick.round;
			});
			
			for (var j = 0; j < pickData.length; j++) {
				var pick = pickData[j].pick;
				var origin = pickData[j].origin;
				var pickMain = ordinal(pick.round) + ' round pick';
				var pickContext = 'in ' + pick.season + ' (' + origin + ')';
				assets.push({
					type: 'pick',
					pickMain: pickMain,
					pickContext: pickContext,
					round: pick.round,
					season: pick.season,
					pickNumber: pick.pickNumber || null
				});
			}
			
			// Cash - sorted by season
			var cashData = [];
			for (var j = 0; j < party.receives.cash.length; j++) {
				var c = party.receives.cash[j];
				var fromName = await getFranchiseDisplayName(c.fromFranchiseId);
				cashData.push({ cash: c, fromName: fromName });
			}
			cashData.sort(function(a, b) { return a.cash.season - b.cash.season; });
			
			for (var j = 0; j < cashData.length; j++) {
				var c = cashData[j].cash;
				var fromName = cashData[j].fromName;
				assets.push({
					type: 'cash',
					cashMain: formatMoney(c.amount),
					cashContext: 'from ' + fromName + ' in ' + c.season,
					amount: c.amount,
					season: c.season
				});
			}
			
			// Handle empty assets
			if (assets.length === 0) {
				assets.push({
					type: 'nothing',
					display: 'Nothing'
				});
			}
			
			partiesDisplay.push({
				franchiseId: party.franchiseId._id || party.franchiseId,
				franchiseName: displayName,
				usePlural: usePlural,
				accepted: party.accepted,
				acceptedAt: party.acceptedAt,
				assets: assets
			});
		}
		
		// Determine what the current user can do
		var user = request.user;
		var userFranchises = user ? await getUserFranchises(user) : [];
		var userParty = partiesDisplay.find(function(p) {
			return userFranchises.some(function(uf) { return uf.equals(p.franchiseId); });
		});
		var isCreator = user && proposal.createdByPersonId && 
			proposal.createdByPersonId._id.equals(user._id);
		var isParty = !!userParty;
		
		// Check if trades are currently enabled
		var tradesCheck = await checkTradesEnabled();
		var tradesEnabled = tradesCheck.enabled;
		var tradesDisabledReason = tradesCheck.error || null;
		
		// Compute acceptance window info
		var acceptanceWindowRemaining = proposal.getAcceptanceWindowRemaining();
		var acceptanceWindowActive = acceptanceWindowRemaining !== null && acceptanceWindowRemaining > 0;
		
		// Calculate budget impact using shared function
		// Convert proposal format to deal format: { franchiseId: { players: [{ id }], cash: [{ from, season, amount }] } }
		var deal = {};
		for (var i = 0; i < proposal.parties.length; i++) {
			var party = proposal.parties[i];
			var fId = (party.franchiseId._id || party.franchiseId).toString();
			deal[fId] = {
				players: party.receives.players.map(function(p) {
					return { id: p.playerId.toString() };
				}),
				picks: [],
				cash: party.receives.cash.map(function(c) {
					return {
						from: c.fromFranchiseId.toString(),
						season: c.season,
						amount: c.amount
					};
				})
			};
		}
		
		var hardCapActive = config ? config.isHardCapActive() : false;
		var budgetImpactData = await budgetHelper.calculateTradeImpact(deal, currentSeason, {
			hardCapActive: hardCapActive
		});
		
		response.render('proposal', {
			proposal: proposal,
			parties: partiesDisplay,
			isCreator: isCreator,
			isParty: isParty,
			userParty: userParty,
			userHasAccepted: userParty ? userParty.accepted : false,
			acceptanceWindowActive: acceptanceWindowActive,
			acceptanceWindowRemaining: acceptanceWindowRemaining,
			tradesEnabled: tradesEnabled,
			tradesDisabledReason: tradesDisabledReason,
			budgetImpact: budgetImpactData,
			isCashNeutral: budgetImpactData.isCashNeutral,
			currentSeason: currentSeason,
			auctionSeason: auctionSeason,
			tradeYear: new Date(proposal.createdAt).getFullYear(),
			activePage: 'proposals'
		});
	} catch (err) {
		console.error('viewProposal error:', err);
		response.status(500).send('Error loading proposal');
	}
}

// Propose a hypothetical trade (convert to pending proposal)
async function proposeProposal(request, response) {
	try {
		var user = request.user;
		if (!user) {
			return response.status(401).json({ success: false, errors: ['Login required'] });
		}
		
		// Check if trades are enabled
		var tradesCheck = await checkTradesEnabled();
		if (!tradesCheck.enabled) {
			return response.status(400).json({ success: false, errors: [tradesCheck.error] });
		}
		
		var proposal = await Proposal.findOne({ publicId: request.params.slug });
		if (!proposal) {
			return response.status(404).json({ success: false, errors: ['Proposal not found'] });
		}
		
		if (proposal.status !== 'hypothetical') {
			return response.status(400).json({ success: false, errors: ['Only hypothetical trades can be proposed'] });
		}
		
		// Check user is a party to this proposal
		var userFranchises = await getUserFranchises(user);
		var isParty = proposal.parties.some(function(p) {
			return userFranchises.some(function(uf) { return uf.equals(p.franchiseId); });
		});
		
		if (!isParty) {
			return response.status(403).json({ success: false, errors: ['You must be party to this trade'] });
		}
		
		// Check expiration
		if (proposal.isExpired()) {
			proposal.status = 'expired';
			await proposal.save();
			return response.status(400).json({ success: false, errors: ['This proposal has expired'] });
		}
		
		// Validate the trade before formalizing (conditions may have changed since creation)
		var validationParties = [];
		for (var i = 0; i < proposal.parties.length; i++) {
			var party = proposal.parties[i];
			var validationReceives = {
				players: [],
				picks: [],
				cash: []
			};
			
			// Look up current contract info for each player
			for (var j = 0; j < (party.receives.players || []).length; j++) {
				var playerRef = party.receives.players[j];
				var contract = await Contract.findOne({ playerId: playerRef.playerId });
				if (contract) {
					validationReceives.players.push({
						playerId: contract.playerId,
						salary: contract.salary,
						startYear: contract.startYear,
						endYear: contract.endYear
					});
				}
			}
			
			// Picks
			for (var j = 0; j < (party.receives.picks || []).length; j++) {
				validationReceives.picks.push({ pickId: party.receives.picks[j].pickId });
			}
			
			// Cash
			for (var j = 0; j < (party.receives.cash || []).length; j++) {
				var cash = party.receives.cash[j];
				validationReceives.cash.push({
					amount: cash.amount,
					season: cash.season,
					fromFranchiseId: cash.fromFranchiseId
				});
			}
			
			validationParties.push({
				franchiseId: party.franchiseId,
				receives: validationReceives
			});
		}
		
		var validationResult = await transactionService.processTrade({
			timestamp: new Date(),
			source: 'manual',
			parties: validationParties,
			validateOnly: true
		});
		
		if (!validationResult.success) {
			return response.status(400).json({
				success: false,
				errors: validationResult.errors || ['Trade validation failed']
			});
		}
		
		// Find which party the user belongs to and auto-accept for them
		var userParty = proposal.parties.find(function(p) {
			return userFranchises.some(function(uf) { return uf.equals(p.franchiseId); });
		});
		
		proposal.status = 'pending';
		proposal.createdByFranchiseId = userParty.franchiseId;
		proposal.createdByPersonId = user._id;
		userParty.accepted = true;
		userParty.acceptedAt = new Date();
		userParty.acceptedBy = user._id;
		proposal.acceptanceWindowStart = new Date();
		
		await proposal.save();
		
		response.json({ success: true });
	} catch (err) {
		console.error('proposeProposal error:', err);
		response.status(500).json({ success: false, errors: ['Server error: ' + err.message] });
	}
}

// Accept a proposal (for one party)
async function acceptProposal(request, response) {
	try {
		var user = request.user;
		if (!user) {
			return response.status(401).json({ success: false, errors: ['Login required'] });
		}
		
		// Check if trades are enabled
		var tradesCheck = await checkTradesEnabled();
		if (!tradesCheck.enabled) {
			return response.status(400).json({ success: false, errors: [tradesCheck.error] });
		}
		
		var proposal = await Proposal.findOne({ publicId: request.params.slug });
		if (!proposal) {
			return response.status(404).json({ success: false, errors: ['Proposal not found'] });
		}
		
		if (proposal.status !== 'pending') {
			return response.status(400).json({ success: false, errors: ['Only pending proposals can be accepted'] });
		}
		
		// Check expiration
		if (proposal.isExpired()) {
			proposal.status = 'expired';
			await proposal.save();
			return response.status(400).json({ success: false, errors: ['This proposal has expired'] });
		}
		
		// Check acceptance window
		if (proposal.isAcceptanceWindowExpired()) {
			proposal.resetAcceptances();
			await proposal.save();
			return response.status(400).json({ 
				success: false, 
				errors: ['Acceptance window expired. Someone needs to accept again to restart the clock.'],
				windowReset: true
			});
		}
		
		// Find user's party
		var userFranchises = await getUserFranchises(user);
		var partyIndex = proposal.parties.findIndex(function(p) {
			return userFranchises.some(function(uf) { return uf.equals(p.franchiseId); });
		});
		
		if (partyIndex === -1) {
			return response.status(403).json({ success: false, errors: ['You are not a party to this trade'] });
		}
		
		var party = proposal.parties[partyIndex];
		if (party.accepted) {
			return response.status(400).json({ success: false, errors: ['You have already accepted'] });
		}
		
		// Accept
		party.accepted = true;
		party.acceptedAt = new Date();
		party.acceptedBy = user._id;
		
		// Start acceptance window if this is the first acceptance (or restart after reset)
		// Also update creator since whoever restarts the clock is now the proposer
		if (!proposal.acceptanceWindowStart) {
			proposal.acceptanceWindowStart = new Date();
			proposal.createdByPersonId = user._id;
			proposal.createdByFranchiseId = party.franchiseId;
		}
		
		// Check if all parties have now accepted
		if (proposal.allPartiesAccepted()) {
			proposal.status = 'accepted';
		}
		
		await proposal.save();
		
		response.json({ 
			success: true,
			allAccepted: proposal.status === 'accepted',
			acceptanceWindowRemaining: proposal.getAcceptanceWindowRemaining()
		});
	} catch (err) {
		console.error('acceptProposal error:', err);
		response.status(500).json({ success: false, errors: ['Server error: ' + err.message] });
	}
}

// Reject a proposal
async function rejectProposal(request, response) {
	try {
		var user = request.user;
		if (!user) {
			return response.status(401).json({ success: false, errors: ['Login required'] });
		}
		
		var proposal = await Proposal.findOne({ publicId: request.params.slug });
		if (!proposal) {
			return response.status(404).json({ success: false, errors: ['Proposal not found'] });
		}
		
		if (proposal.status !== 'pending' && proposal.status !== 'hypothetical') {
			return response.status(400).json({ success: false, errors: ['Cannot reject this proposal'] });
		}
		
		// Check user is a party
		var userFranchises = await getUserFranchises(user);
		var isParty = proposal.parties.some(function(p) {
			return userFranchises.some(function(uf) { return uf.equals(p.franchiseId); });
		});
		
		if (!isParty) {
			return response.status(403).json({ success: false, errors: ['You are not a party to this trade'] });
		}
		
		proposal.status = 'rejected';
		await proposal.save();
		
		response.json({ success: true });
	} catch (err) {
		console.error('rejectProposal error:', err);
		response.status(500).json({ success: false, errors: ['Server error: ' + err.message] });
	}
}

// Cancel a proposal (creator only)
async function cancelProposal(request, response) {
	try {
		var user = request.user;
		if (!user) {
			return response.status(401).json({ success: false, errors: ['Login required'] });
		}
		
		var proposal = await Proposal.findOne({ publicId: request.params.slug });
		if (!proposal) {
			return response.status(404).json({ success: false, errors: ['Proposal not found'] });
		}
		
		if (proposal.status !== 'pending' && proposal.status !== 'hypothetical') {
			return response.status(400).json({ success: false, errors: ['Cannot cancel this proposal'] });
		}
		
		// Only creator can cancel
		if (!proposal.createdByPersonId.equals(user._id)) {
			return response.status(403).json({ success: false, errors: ['Only the creator can cancel'] });
		}
		
		proposal.status = 'canceled';
		await proposal.save();
		
		response.json({ success: true });
	} catch (err) {
		console.error('cancelProposal error:', err);
		response.status(500).json({ success: false, errors: ['Server error: ' + err.message] });
	}
}

// Admin: List proposals ready for approval
async function listProposalsForApproval(request, response) {
	try {
		var config = await LeagueConfig.findById('pso');
		var currentSeason = config ? config.season : new Date().getFullYear();
		var hardCapActive = config ? config.isHardCapActive() : false;
		
		var proposals = await Proposal.find({ status: 'accepted' })
			.populate('createdByPersonId', 'name')
			.sort({ createdAt: -1 });
		
		// Build display data for each proposal (same format as viewProposal)
		var proposalsDisplay = [];
		for (var i = 0; i < proposals.length; i++) {
			var proposal = proposals[i];
			
			var partiesDisplay = [];
			for (var j = 0; j < proposal.parties.length; j++) {
				var party = proposal.parties[j];
				var displayName = await getFranchiseDisplayName(party.franchiseId);
				var usePlural = displayName === 'Schexes' || displayName.includes('/');
				
				// Build full asset list (same as viewProposal)
				var assets = [];
				
				// Players - sorted by salary desc
				var playerData = [];
				for (var k = 0; k < party.receives.players.length; k++) {
					var player = await Player.findById(party.receives.players[k].playerId);
					var contract = await Contract.findOne({ playerId: party.receives.players[k].playerId });
					playerData.push({ player: player, contract: contract });
				}
				playerData.sort(function(a, b) {
					return ((b.contract ? b.contract.salary : 0) || 0) - ((a.contract ? a.contract.salary : 0) || 0);
				});
				
				for (var k = 0; k < playerData.length; k++) {
					var player = playerData[k].player;
					var contract = playerData[k].contract;
					var playerName = player ? player.name : 'Unknown';
					var positions = player ? player.positions : [];
					
					if (contract && contract.salary === null) {
						assets.push({
							type: 'rfa',
							playerName: playerName,
							contractInfo: 'RFA rights',
							positions: positions
						});
					} else if (contract) {
						assets.push({
							type: 'player',
							playerName: playerName,
							contractInfo: formatContractDisplay(contract.salary || 0, contract.startYear, contract.endYear),
							positions: positions
						});
					} else {
						assets.push({
							type: 'player',
							playerName: playerName,
							contractInfo: '(no contract)',
							positions: positions
						});
					}
				}
				
				// Picks - sorted by season then round
				var pickData = [];
				for (var k = 0; k < party.receives.picks.length; k++) {
					var pick = await Pick.findById(party.receives.picks[k].pickId);
					if (pick) {
						var origin = await getFranchiseDisplayName(pick.originalFranchiseId);
						pickData.push({ pick: pick, origin: origin });
					}
				}
				pickData.sort(function(a, b) {
					if (a.pick.season !== b.pick.season) return a.pick.season - b.pick.season;
					return a.pick.round - b.pick.round;
				});
				
				for (var k = 0; k < pickData.length; k++) {
					var pick = pickData[k].pick;
					var origin = pickData[k].origin;
					assets.push({
						type: 'pick',
						pickMain: ordinal(pick.round) + ' round pick',
						pickContext: 'in ' + pick.season + ' (' + origin + ')'
					});
				}
				
				// Cash - sorted by season
				var cashData = [];
				for (var k = 0; k < party.receives.cash.length; k++) {
					var c = party.receives.cash[k];
					var fromName = await getFranchiseDisplayName(c.fromFranchiseId);
					cashData.push({ cash: c, fromName: fromName });
				}
				cashData.sort(function(a, b) { return a.cash.season - b.cash.season; });
				
				for (var k = 0; k < cashData.length; k++) {
					var c = cashData[k].cash;
					var fromName = cashData[k].fromName;
					assets.push({
						type: 'cash',
						cashMain: formatMoney(c.amount),
						cashContext: 'from ' + fromName + ' in ' + c.season
					});
				}
				
				// Handle empty assets
				if (assets.length === 0) {
					assets.push({ type: 'nothing', display: 'Nothing' });
				}
				
				partiesDisplay.push({
					franchiseName: displayName,
					usePlural: usePlural,
					assets: assets
				});
			}
			
			// Find when the final party accepted (latest acceptedAt)
			var finalAcceptedAt = null;
			for (var j = 0; j < proposal.parties.length; j++) {
				var partyAcceptedAt = proposal.parties[j].acceptedAt;
				if (partyAcceptedAt && (!finalAcceptedAt || partyAcceptedAt > finalAcceptedAt)) {
					finalAcceptedAt = partyAcceptedAt;
				}
			}
			
			// Calculate budget impact
			var deal = {};
			for (var j = 0; j < proposal.parties.length; j++) {
				var party = proposal.parties[j];
				var fId = (party.franchiseId._id || party.franchiseId).toString();
				deal[fId] = {
					players: party.receives.players.map(function(p) {
						return { id: p.playerId.toString() };
					}),
					picks: [],
					cash: party.receives.cash.map(function(c) {
						return {
							from: c.fromFranchiseId.toString(),
							season: c.season,
							amount: c.amount
						};
					})
				};
			}
			var budgetImpactData = await budgetHelper.calculateTradeImpact(deal, currentSeason, {
				hardCapActive: hardCapActive
			});
			
			proposalsDisplay.push({
				_id: proposal._id,
				publicId: proposal.publicId,
				finalAcceptedAt: finalAcceptedAt,
				parties: partiesDisplay,
				budgetImpact: budgetImpactData
			});
		}
		
		response.render('admin-proposals', {
			proposals: proposalsDisplay,
			activePage: 'admin-proposals'
		});
	} catch (err) {
		console.error('listProposalsForApproval error:', err);
		response.status(500).send('Error loading proposals');
	}
}

// Admin: Approve a proposal (execute the trade)
async function approveProposal(request, response) {
	try {
		// Check if trades are enabled
		var tradesCheck = await checkTradesEnabled();
		if (!tradesCheck.enabled) {
			return response.status(400).json({ success: false, errors: [tradesCheck.error] });
		}
		
		var proposal = await Proposal.findById(request.params.id);
		if (!proposal) {
			return response.status(404).json({ success: false, errors: ['Proposal not found'] });
		}
		
		if (proposal.status !== 'accepted') {
			return response.status(400).json({ success: false, errors: ['Only fully-accepted proposals can be approved'] });
		}
		
		// Transform proposal to processTrade format
		var parties = [];
		for (var i = 0; i < proposal.parties.length; i++) {
			var party = proposal.parties[i];
			
			var receives = {
				players: [],
				picks: [],
				cash: []
			};
			
			// Look up current contract details for each player
			for (var j = 0; j < party.receives.players.length; j++) {
				var playerId = party.receives.players[j].playerId;
				var contract = await Contract.findOne({ playerId: playerId });
				if (!contract) {
					var player = await Player.findById(playerId);
					return response.status(400).json({ 
						success: false, 
						errors: ['Contract not found for player: ' + (player ? player.name : playerId)] 
					});
				}
				
				receives.players.push({
					playerId: contract.playerId,
					salary: contract.salary,
					startYear: contract.startYear,
					endYear: contract.endYear
				});
			}
			
			// Picks
			for (var j = 0; j < party.receives.picks.length; j++) {
				receives.picks.push({ pickId: party.receives.picks[j].pickId });
			}
			
			// Cash
			for (var j = 0; j < party.receives.cash.length; j++) {
				var c = party.receives.cash[j];
				receives.cash.push({
					amount: c.amount,
					season: c.season,
					fromFranchiseId: c.fromFranchiseId
				});
			}
			
			parties.push({
				franchiseId: party.franchiseId,
				receives: receives
			});
		}
		
		// Execute the trade
		var result = await transactionService.processTrade({
			timestamp: new Date(),
			source: 'manual',
			notes: request.body.notes || proposal.notes || null,
			parties: parties
		});
		
		if (result.success) {
			proposal.status = 'executed';
			proposal.executedTransactionId = result.transaction._id;
			await proposal.save();
			
			response.json({
				success: true,
				tradeId: result.transaction.tradeId
			});
		} else {
			response.status(400).json({
				success: false,
				errors: result.errors || ['Unknown error processing trade']
			});
		}
	} catch (err) {
		console.error('approveProposal error:', err);
		response.status(500).json({ success: false, errors: ['Server error: ' + err.message] });
	}
}

// Admin: Reject a proposal
async function adminRejectProposal(request, response) {
	try {
		var proposal = await Proposal.findById(request.params.id);
		if (!proposal) {
			return response.status(404).json({ success: false, errors: ['Proposal not found'] });
		}
		
		if (proposal.status !== 'accepted' && proposal.status !== 'pending') {
			return response.status(400).json({ success: false, errors: ['Cannot reject this proposal'] });
		}
		
		proposal.status = 'rejected';
		await proposal.save();
		
		response.json({ success: true });
	} catch (err) {
		console.error('adminRejectProposal error:', err);
		response.status(500).json({ success: false, errors: ['Server error: ' + err.message] });
	}
}

// Return rendered budget impact partial for XHR updates
async function budgetImpactPartial(request, response) {
	try {
		var deal = request.body.deal;
		
		if (!deal || typeof deal !== 'object') {
			return response.status(400).send('Invalid deal data');
		}
		
		var config = await LeagueConfig.findById('pso');
		var currentSeason = config ? config.season : new Date().getFullYear();
		var hardCapActive = config ? config.isHardCapActive() : false;
		
		var budgetImpact = await budgetHelper.calculateTradeImpact(deal, currentSeason, {
			hardCapActive: hardCapActive
		});
		
		// Use table partial for trade machine
		response.render('partials/budget-impact-table', {
			budgetImpact: budgetImpact,
			showCashNeutralButtons: true,
			layout: false
		});
	} catch (err) {
		console.error('budgetImpactPartial error:', err);
		response.status(500).send('Error calculating budget impact');
	}
}

// Compute auction season based on phase
// Pre-auction (early-offseason, pre-season): auction season = current season
// Post-auction (regular-season+): auction season = next season
function computeAuctionSeason(config) {
	var currentSeason = config ? config.season : new Date().getFullYear();
	if (!config) return currentSeason;
	
	var phase = config.getPhase();
	// Post-auction phases: regular-season, post-deadline, playoff-fa, dead-period
	var postAuctionPhases = ['regular-season', 'post-deadline', 'playoff-fa', 'dead-period'];
	if (postAuctionPhases.includes(phase)) {
		return currentSeason + 1;
	}
	return currentSeason;
}

module.exports = {
	getTradeData: getTradeData,
	// Trade Machine
	tradeMachinePage: tradeMachinePage,
	createProposal: createProposal,
	budgetImpactPartial: budgetImpactPartial,
	// Admin trade processing
	processPage: processPage,
	submitTrade: submitTrade,
	// Proposal actions
	viewProposal: viewProposal,
	proposeProposal: proposeProposal,
	acceptProposal: acceptProposal,
	rejectProposal: rejectProposal,
	cancelProposal: cancelProposal,
	// Admin proposal approval
	listProposalsForApproval: listProposalsForApproval,
	approveProposal: approveProposal,
	adminRejectProposal: adminRejectProposal,
	// Helper (exported for potential reuse)
	getUserFranchises: getUserFranchises
};
