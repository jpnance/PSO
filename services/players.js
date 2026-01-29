var Player = require('../models/Player');
var Contract = require('../models/Contract');
var Transaction = require('../models/Transaction');
var Regime = require('../models/Regime');

exports.playerDetail = async function(request, response) {
	try {
		var playerId = request.params.id;
		
		// Get player
		var player = await Player.findById(playerId).lean();
		if (!player) {
			return response.status(404).render('player-not-found');
		}
		
		// Get current contract (if any)
		var contract = await Contract.findOne({ playerId: playerId })
			.populate('franchiseId')
			.lean();
		
		var contractInfo = null;
		if (contract) {
			// Look up regime display name
			var regime = await Regime.findOne({
				'tenures': {
					$elemMatch: {
						franchiseId: contract.franchiseId._id,
						endSeason: null
					}
				}
			}).lean();
			
			contractInfo = {
				salary: contract.salary,
				startYear: contract.startYear,
				endYear: contract.endYear,
				isRfa: contract.salary === null,
				franchiseId: contract.franchiseId._id,
				franchiseRosterId: contract.franchiseId.rosterId,
				franchiseName: regime ? regime.displayName : 'Unknown'
			};
		}
		
		// Get transaction history for this player
		// Players can appear in: playerId field, parties.receives.players, parties.receives.rfaRights, dropped, parties.drops
		var transactions = await Transaction.find({
			$or: [
				{ playerId: playerId },
				{ 'parties.receives.players.playerId': playerId },
				{ 'parties.receives.rfaRights.playerId': playerId },
				{ 'dropped.playerId': playerId },
				{ 'parties.drops.playerId': playerId }
			]
		})
			.populate('franchiseId')
			.populate('playerId', 'name')
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
					
				case 'fa-pickup':
					entry.description = 'Signed by ' + getRegimeForFranchise(t.franchiseId._id, t.timestamp);
					entry.salary = t.salary;
					break;
					
				case 'fa-cut':
					entry.description = 'Cut by ' + getRegimeForFranchise(t.franchiseId._id, t.timestamp);
					break;
					
				case 'draft-select':
					entry.description = 'Drafted by ' + getRegimeForFranchise(t.franchiseId._id, t.timestamp);
					entry.salary = t.salary;
					break;
					
				case 'auction-ufa':
					entry.description = 'Won at auction by ' + getRegimeForFranchise(t.franchiseId._id, t.timestamp);
					entry.salary = t.winningBid;
					break;
					
				case 'auction-rfa-matched':
					entry.description = 'RFA matched by ' + getRegimeForFranchise(t.franchiseId._id, t.timestamp);
					entry.salary = t.winningBid;
					break;
					
				case 'auction-rfa-unmatched':
					entry.description = 'RFA not matched, signed by ' + getRegimeForFranchise(t.franchiseId._id, t.timestamp);
					entry.salary = t.winningBid;
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
			history: history
		});
	} catch (err) {
		console.error('Error loading player detail:', err);
		response.status(500).send('Error loading player');
	}
};
