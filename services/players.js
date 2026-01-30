var Player = require('../models/Player');
var Contract = require('../models/Contract');
var Transaction = require('../models/Transaction');
var Regime = require('../models/Regime');
var LeagueConfig = require('../models/LeagueConfig');
var Season = require('../models/Season');
var transactionService = require('./transaction');

exports.playerDetail = async function(request, response) {
	try {
		var playerId = request.params.id;
		
		// Get player and config
		var player = await Player.findById(playerId).lean();
		if (!player) {
			return response.status(404).render('player-not-found');
		}
		
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
			.populate('playerId', 'name')
			.populate('facilitatedTradeId', 'tradeId')
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
		
		// Build display-friendly transaction list
		var history = transactions.map(function(t) {
			var entry = {
				type: t.type,
				timestamp: t.timestamp,
				notes: t.notes
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
					entry.description = 'Traded';
					if (sendingParty && receivingParty) {
						entry.from = getRegimeForFranchise(sendingParty.franchiseId, t.timestamp);
						entry.to = getRegimeForFranchise(receivingParty.franchiseId, t.timestamp);
						entry.description = entry.from + ' → ' + entry.to;
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
						entry.description = 'Cut by ' + getRegimeForFranchise(t.franchiseId._id, t.timestamp);
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
						entry.description = 'Signed by ' + getRegimeForFranchise(t.franchiseId._id, t.timestamp);
						entry.salary = addEntry.salary;
						if (addEntry.startYear || addEntry.endYear) {
							entry.startYear = addEntry.startYear;
							entry.endYear = addEntry.endYear;
						}
					}
					break;
					
				case 'draft-select':
					entry.description = 'Drafted by ' + getRegimeForFranchise(t.franchiseId._id, t.timestamp);
					entry.salary = t.salary;
					entry.draftSeason = new Date(t.timestamp).getFullYear();
					break;
					
			case 'auction-ufa':
				entry.description = 'Won at auction by ' + getRegimeForFranchise(t.franchiseId._id, t.timestamp);
				entry.salary = t.salary;
				break;
				
			case 'auction-rfa-matched':
				entry.description = 'RFA matched by ' + getRegimeForFranchise(t.franchiseId._id, t.timestamp);
				entry.salary = t.salary;
				break;
				
			case 'auction-rfa-unmatched':
				entry.description = 'RFA not matched, signed by ' + getRegimeForFranchise(t.franchiseId._id, t.timestamp);
				entry.salary = t.salary;
				break;
					
				case 'contract':
					entry.description = 'Contract set by ' + getRegimeForFranchise(t.franchiseId._id, t.timestamp);
					entry.salary = t.salary;
					entry.startYear = t.startYear;
					entry.endYear = t.endYear;
					break;
					
				default:
					entry.description = t.type;
			}
			
			return entry;
		});
		
		response.render('player', {
			activePage: 'player',
			player: player,
			contract: contractInfo,
			history: history,
			isOwner: isOwner,
			canCut: canCut,
			canTrade: canTrade
		});
	} catch (err) {
		console.error('Error loading player detail:', err);
		response.status(500).send('Error loading player');
	}
};
