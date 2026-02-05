var Player = require('../models/Player');
var Contract = require('../models/Contract');
var Transaction = require('../models/Transaction');
var Regime = require('../models/Regime');
var LeagueConfig = require('../models/LeagueConfig');
var Season = require('../models/Season');
var transactionService = require('./transaction');

exports.playerDetail = async function(request, response) {
	try {
		var slug = request.params.slug;
		var players = await Player.findBySlug(slug);
		
		if (players.length === 0) {
			return response.status(404).render('player-not-found');
		}
		
		if (players.length > 1) {
			return renderDisambiguation(request, response, slug, players);
		}
		
		var player = players[0];
		var canonicalSlug = player.slugs && player.slugs[0];
		
		// If this was a prefix match (not exact), redirect to canonical slug
		if (canonicalSlug && !player.slugs.includes(slug)) {
			return response.redirect('/players/' + canonicalSlug);
		}
		
		var playerId = player._id.toString();
		
		var config = await LeagueConfig.findById('pso');
		var currentSeason = config ? config.season : new Date().getFullYear();
		var phase = config ? config.getPhase() : 'dead-period';
		
		// Get current contract (if any)
		var contract = await Contract.findOne({ playerId: playerId })
			.populate('franchiseId')
			.lean();
		
		var contractInfo = null;
		var isOwner = false;
		var canCut = false;
		var canTrade = false;
		
		if (contract) {
			// Look up regime display name and owner IDs
			var regime = await Regime.findOne({
				'tenures': {
					$elemMatch: {
						franchiseId: contract.franchiseId._id,
						endSeason: null
					}
				}
			}).populate('ownerIds', '_id').lean();
			
			// Check if current user owns this franchise
			if (request.user && regime && regime.ownerIds) {
				isOwner = regime.ownerIds.some(function(owner) {
					return owner._id.toString() === request.user._id.toString();
				});
			}
			
			// Calculate buyout info for cuts
			var salary = contract.salary || 0;
			var buyout = null;
			if (contract.salary !== null && contract.startYear && contract.endYear) {
				buyout = transactionService.computeBuyOutForSeason(
					salary, contract.startYear, contract.endYear, currentSeason, currentSeason
				);
			}
			
			contractInfo = {
				salary: contract.salary,
				startYear: contract.startYear,
				endYear: contract.endYear,
				isRfa: contract.salary === null,
				franchiseId: contract.franchiseId._id,
				franchiseRosterId: contract.franchiseId.rosterId,
				franchiseName: regime ? regime.displayName : 'Unknown',
				buyout: buyout,
				recoverable: buyout !== null ? salary - buyout : null
			};
			
			// Determine if cuts are allowed
			if (isOwner && config && config.areCutsEnabled() && contract.salary !== null) {
				if (phase === 'playoff-fa') {
					// Only playoff teams can cut during playoff FA
					var isPlayoffTeam = await Season.exists({
						season: currentSeason,
						'standings': {
							$elemMatch: {
								franchiseId: contract.franchiseId._id,
								madePlayoffs: true
							}
						}
					});
					canCut = !!isPlayoffTeam;
				} else {
					canCut = true;
				}
			}
			
			// Determine if trades are allowed
			var tradePhases = ['early-offseason', 'pre-season', 'regular-season'];
			canTrade = tradePhases.includes(phase) && contract.salary !== null;
		}
		
		// Get transaction history for this player
		// Players can appear in: playerId field, parties.receives.players, parties.receives.rfaRights, adds, drops
		var transactions = await Transaction.find({
			$or: [
				{ playerId: playerId },
				{ 'parties.receives.players.playerId': playerId },
				{ 'parties.receives.rfaRights.playerId': playerId },
				{ 'adds.playerId': playerId },
				{ 'drops.playerId': playerId }
			]
		})
			.populate('franchiseId')
			.populate('fromFranchiseId')
			.populate('playerId', 'name')
			.populate('facilitatedTradeId', 'tradeId')
			.populate('pickId', 'pickNumber round season originalFranchiseId')
			.sort({ timestamp: -1 })
			.lean();
		
		// Get all franchise IDs from transactions for regime lookups
		var franchiseIds = new Set();
		transactions.forEach(function(t) {
			if (t.franchiseId) franchiseIds.add(t.franchiseId._id.toString());
			if (t.parties) {
				t.parties.forEach(function(p) {
					if (p.franchiseId) franchiseIds.add(p.franchiseId.toString());
				});
			}
		});
		
		// Look up all regimes for these franchises
		var regimes = await Regime.find({}).populate('ownerIds', 'name').lean();
		
		// Build franchise name lookup (franchiseId -> displayName at time)
		function getRegimeForFranchise(franchiseId, timestamp) {
			var year = new Date(timestamp).getFullYear();
			for (var i = 0; i < regimes.length; i++) {
				var regime = regimes[i];
				for (var j = 0; j < regime.tenures.length; j++) {
					var tenure = regime.tenures[j];
					if (tenure.franchiseId.toString() === franchiseId.toString()) {
						if (tenure.startSeason <= year && (tenure.endSeason === null || tenure.endSeason >= year)) {
							return regime.displayName;
						}
					}
				}
			}
			return 'Unknown';
		}
		
		// Build structured transaction list (templates handle display)
		var history = transactions.map(function(t, index, arr) {
			// Get year for this entry and check if it differs from previous
			var entryYear = t.timestamp ? new Date(t.timestamp).getFullYear() : null;
			var prevYear = (index > 0 && arr[index - 1].timestamp) 
				? new Date(arr[index - 1].timestamp).getFullYear() 
				: null;
			var showYearDivider = (index === 0) || (entryYear !== prevYear);
			var entry = {
				type: t.type,
				timestamp: t.timestamp,
				notes: t.notes,
				year: entryYear,
				showYearDivider: showYearDivider
			};
			
			switch (t.type) {
				case 'trade':
					// Find which party received this player
					var receivingParty = null;
					var sendingParty = null;
					if (t.parties) {
						t.parties.forEach(function(p) {
							var receivedPlayer = (p.receives.players || []).some(function(pl) {
								return pl.playerId.toString() === playerId;
							});
							var receivedRfa = (p.receives.rfaRights || []).some(function(r) {
								return r.playerId.toString() === playerId;
							});
							if (receivedPlayer || receivedRfa) {
								receivingParty = p;
							} else {
								sendingParty = p;
							}
						});
					}
					if (sendingParty && receivingParty) {
						entry.fromRegime = getRegimeForFranchise(sendingParty.franchiseId, t.timestamp);
						entry.toRegime = getRegimeForFranchise(receivingParty.franchiseId, t.timestamp);
					}
					entry.tradeId = t.tradeId;
					break;
					
				case 'fa':
					// Check if this player is in adds or drops
					var playerInAdds = t.adds && t.adds.some(function(a) {
						return a.playerId && a.playerId.toString() === playerId;
					});
					var playerInDrops = t.drops && t.drops.some(function(d) {
						return d.playerId && d.playerId.toString() === playerId;
					});
					
					if (playerInDrops) {
						// This player was cut/dropped
						var dropEntry = t.drops.find(function(d) {
							return d.playerId && d.playerId.toString() === playerId;
						});
						entry.type = 'fa-cut';  // Display type for UI
						entry.regime = getRegimeForFranchise(t.franchiseId._id, t.timestamp);
						if (t.facilitatedTradeId) {
							entry.facilitatedTradeId = t.facilitatedTradeId.tradeId;
						}
						if (dropEntry.salary) {
							entry.salary = dropEntry.salary;
						}
						if (dropEntry.startYear || dropEntry.endYear) {
							entry.startYear = dropEntry.startYear;
							entry.endYear = dropEntry.endYear;
						}
						if (dropEntry.buyOuts && dropEntry.buyOuts.length > 0) {
							entry.buyOuts = dropEntry.buyOuts;
						}
					} else if (playerInAdds) {
						// This player was signed/picked up
						var addEntry = t.adds.find(function(a) {
							return a.playerId && a.playerId.toString() === playerId;
						});
						entry.type = 'fa-pickup';  // Display type for UI
						entry.regime = getRegimeForFranchise(t.franchiseId._id, t.timestamp);
						entry.salary = addEntry.salary;
						if (addEntry.startYear || addEntry.endYear) {
							entry.startYear = addEntry.startYear;
							entry.endYear = addEntry.endYear;
						}
					}
					break;
					
				case 'draft-select':
					entry.regime = getRegimeForFranchise(t.franchiseId._id, t.timestamp);
					entry.salary = t.salary;
					entry.draftSeason = new Date(t.timestamp).getFullYear();
					if (t.pickId) {
						entry.pickNumber = t.pickId.pickNumber;
						entry.pickRound = t.pickId.round;
						// 10 teams before 2012 expansion, 12 after
						entry.teamsPerRound = entry.draftSeason <= 2011 ? 10 : 12;
					}
					break;
			
				case 'expansion-draft-protect':
					entry.regime = getRegimeForFranchise(t.franchiseId._id, t.timestamp);
					break;
			
				case 'expansion-draft-select':
					entry.regime = getRegimeForFranchise(t.franchiseId._id, t.timestamp);
					break;
					
				case 'auction-ufa':
					entry.regime = getRegimeForFranchise(t.franchiseId._id, t.timestamp);
					entry.salary = t.salary;
					break;
				
				case 'auction-rfa-matched':
					entry.regime = getRegimeForFranchise(t.franchiseId._id, t.timestamp);
					entry.salary = t.salary;
					break;
				
				case 'auction-rfa-unmatched':
					entry.regime = getRegimeForFranchise(t.franchiseId._id, t.timestamp);
					entry.salary = t.salary;
					break;
				
				case 'rfa-rights-conversion':
					entry.regime = getRegimeForFranchise(t.franchiseId._id, t.timestamp);
					entry.salary = t.salary;
					entry.startYear = t.startYear;
					entry.endYear = t.endYear;
					break;
					
				case 'contract':
					entry.regime = getRegimeForFranchise(t.franchiseId._id, t.timestamp);
					entry.salary = t.salary;
					entry.startYear = t.startYear;
					entry.endYear = t.endYear;
					break;
			}
			
			return entry;
		});
		
		// Build timeline with year dividers (including empty years)
		var timeline = [];
		var currentYear = null;
		
		for (var i = 0; i < history.length; i++) {
			var entry = history[i];
			var entryYear = entry.year;
			
			if (entryYear && entryYear !== currentYear) {
				// Insert dividers for any skipped years (going backwards in time)
				if (currentYear !== null) {
					for (var y = currentYear - 1; y > entryYear; y--) {
						timeline.push({ isYearDivider: true, year: y, empty: true });
					}
				}
				// Add divider for this year
				timeline.push({ isYearDivider: true, year: entryYear, empty: false });
				currentYear = entryYear;
			}
			
			timeline.push(entry);
		}
		
		response.render('player', {
			activePage: 'player',
			player: player,
			contract: contractInfo,
			timeline: timeline,
			isOwner: isOwner,
			canCut: canCut,
			canTrade: canTrade
		});
	} catch (err) {
		console.error('Error loading player detail:', err);
		response.status(500).send('Error loading player');
	}
};

// Render disambiguation page when multiple players share the same slug
async function renderDisambiguation(request, response, slug, players) {
	// Enrich players with contract info for better disambiguation
	var Contract = require('../models/Contract');
	var Regime = require('../models/Regime');
	
	var playerIds = players.map(function(p) { return p._id; });
	var contracts = await Contract.find({ playerId: { $in: playerIds } })
		.populate('franchiseId')
		.lean();
	
	// Get regimes for franchise names
	var regimes = await Regime.find({}).lean();
	
	function getCurrentRegimeName(franchiseId) {
		for (var regime of regimes) {
			for (var tenure of regime.tenures) {
				if (tenure.franchiseId.toString() === franchiseId.toString() && tenure.endSeason === null) {
					return regime.displayName;
				}
			}
		}
		return 'Unknown';
	}
	
	// Build contract lookup by playerId
	var contractByPlayer = {};
	contracts.forEach(function(c) {
		contractByPlayer[c.playerId.toString()] = c;
	});
	
	// Enrich each player with disambiguation details
	var enrichedPlayers = players.map(function(p) {
		var contract = contractByPlayer[p._id.toString()];
		var details = [];
		
		// Positions
		if (p.positions && p.positions.length > 0) {
			details.push(p.positions.join('/'));
		}
		
		// Current team
		if (p.team) {
			details.push(p.team);
		}
		
		// College
		if (p.college) {
			details.push(p.college);
		}
		
		// Rookie year (if we have it)
		if (p.rookieYear) {
			details.push('drafted ' + p.rookieYear);
		} else if (p.estimatedRookieYear) {
			details.push('~' + p.estimatedRookieYear);
		}
		
		// Contract status
		var status = 'Free Agent';
		if (contract) {
			if (contract.salary === null) {
				status = 'RFA rights: ' + getCurrentRegimeName(contract.franchiseId._id);
			} else {
				status = getCurrentRegimeName(contract.franchiseId._id);
			}
		}
		
		return {
			_id: p._id,
			name: p.name,
			slug: p.slugs ? p.slugs[0] : null,
			positions: p.positions,
			details: details.join(' · '),
			status: status,
			active: p.active
		};
	});
	
	// Sort: active players first, then by details
	enrichedPlayers.sort(function(a, b) {
		if (a.active !== b.active) return b.active ? 1 : -1;
		return a.details.localeCompare(b.details);
	});
	
	response.render('player-disambiguation', {
		activePage: 'player',
		slug: slug,
		displayName: players[0].name,
		players: enrichedPlayers
	});
}
