var tradeMachine = {
	deal: {},

	toggleFranchiseInvolvement: (franchiseId) => {
		if (!tradeMachine.deal[franchiseId]) {
			tradeMachine.deal[franchiseId] = {
				players: [],
				picks: [],
				cash: []
			};
		}
		else {
			// Remove the franchise's bucket
			delete tradeMachine.deal[franchiseId];
			
			// Clean up assets in other buckets that came from this franchise
			Object.keys(tradeMachine.deal).forEach((otherFranchiseId) => {
				var bucket = tradeMachine.deal[otherFranchiseId];
				
				// Remove cash that was coming from the removed franchise
				bucket.cash = bucket.cash.filter((c) => c.from !== franchiseId);
				
				// Remove players that belonged to the removed franchise
				bucket.players = bucket.players.filter((p) => p.fromFranchiseId !== franchiseId);
				
				// Remove picks that belonged to the removed franchise
				bucket.picks = bucket.picks.filter((p) => p.fromFranchiseId !== franchiseId);
			});
		}

		tradeMachine.rebuildPlayerLists();
		tradeMachine.rebuildPickLists();
		tradeMachine.rebuildFranchiseLists();
	},

	addPlayerToDeal: (playerId, franchiseId) => {
		if (!playerId) return;
		var playerData = tradeMachine.playerData(playerId);

		if (!tradeMachine.deal[franchiseId].players.find((player) => player.id == playerData.id)) {
			tradeMachine.deal[franchiseId].players.push(playerData);
		}
	},

	addPickToDeal: (pickId, franchiseId) => {
		if (!pickId) return;
		var pickData = tradeMachine.pickData(pickId);

		if (!tradeMachine.deal[franchiseId].picks.find((pick) => pick.id == pickData.id)) {
			tradeMachine.deal[franchiseId].picks.push(pickData);
		}
	},

	addCashToDeal: (amount, fromFranchiseId, season, toFranchiseId) => {
		if (!amount || !fromFranchiseId || isNaN(amount)) return;
		
		var existingCashFromFranchise = tradeMachine.deal[toFranchiseId].cash.find((asset) => asset.from == fromFranchiseId && asset.season == season);

		if (existingCashFromFranchise) {
			existingCashFromFranchise.amount = amount;
		}
		else {
			tradeMachine.deal[toFranchiseId].cash.push({
				type: 'cash',
				id: fromFranchiseId + '-' + season,
				amount: amount,
				from: fromFranchiseId,
				season: season
			});
		}
	},

	assetSortFunction: (a, b) => {
		if (a.type == 'player' && b.type != 'player') {
			return -1;
		}
		else if (a.type != 'player' && b.type == 'player') {
			return 1;
		}
		else if (a.type == 'player' && b.type == 'player') {
			if (a.salary < b.salary) {
				return 1;
			}
			else if (a.salary > b.salary) {
				return -1;
			}
			else if (a.name > b.name) {
				return 1;
			}
			else if (a.name < b.name) {
				return -1;
			}
			else {
				return 0;
			}
		}
		else {
			if (a.season < b.season) {
				return -1;
			}
			else if (a.season > b.season) {
				return 1;
			}
			else {
				if (a.type == 'pick' && b.type != 'pick') {
					return -1;
				}
				else if (a.type != 'pick' && b.type == 'pick') {
					return 1;
				}
				else {
					if (a.round < b.round) {
						return -1;
					}
					else if (a.round > b.round) {
						return 1;
					}
					else if (a.origin > b.origin) {
						return 1;
					}
					else if (a.origin < b.origin) {
						return -1;
					}
				}
			}
		}
	},

	extractFranchiseId: (elementId) => {
		// Element IDs are like "check-{objectId}" or "gets-{objectId}"
		var hyphenIndex = elementId.indexOf('-');
		return hyphenIndex !== -1 ? elementId.substring(hyphenIndex + 1) : elementId;
	},

	franchiseName: (franchiseId) => {
		var $franchise = $('select.master-franchise-list option[class=franchises-' + franchiseId + ']');
		return $franchise.data('name');
	},

	franchisesInvolved: () => {
		var sortedFranchises = Object.keys(tradeMachine.deal).sort((a, b) => {
			var aName = tradeMachine.franchiseName(a);
			var bName = tradeMachine.franchiseName(b);
			return aName.localeCompare(bName);
		});

		return sortedFranchises;
	},

	pickData: (pickId) => {
		var $pick = $('select.master-pick-list option[value="' + pickId + '"]');
		var pickNumberAttr = $pick.attr('data-picknumber');
		var pickNumber = pickNumberAttr ? parseInt(pickNumberAttr, 10) : null;
		// Get the franchise ID from the optgroup's class (e.g., "picks-abc123")
		var optgroupClass = $pick.closest('optgroup').attr('class') || '';
		var fromFranchiseId = optgroupClass.replace('picks-', '');

		return {
			type: 'pick',
			id: pickId,
			fromFranchiseId: fromFranchiseId,
			season: parseInt($pick.data('season')),
			round: parseInt($pick.data('round')),
			pickNumber: pickNumber,
			owner: $pick.data('owner'),
			origin: $pick.data('origin')
		};
	},

	playerData: (playerId) => {
		var $player = $('select.master-player-list option[value="' + playerId + '"]');
		// Get the franchise ID from the optgroup's class (e.g., "players-abc123")
		var optgroupClass = $player.closest('optgroup').attr('class') || '';
		var fromFranchiseId = optgroupClass.replace('players-', '');

		return {
			type: 'player',
			id: playerId,
			fromFranchiseId: fromFranchiseId,
			name: $player.data('name'),
			salary: parseInt($player.data('salary')) || 0,
			contract: $player.data('contract'),
			terms: $player.data('terms'),
			recoverable: parseInt($player.data('recoverable')) || 0
		};
	},

	rebuildPickLists: () => {
		// Collect all pick IDs already in any bucket
		var picksInDeal = [];
		tradeMachine.franchisesInvolved().forEach((fId) => {
			tradeMachine.deal[fId].picks.forEach((p) => {
				picksInDeal.push(p.id);
			});
		});
		
		$('.gets').each((i, gets) => {
			var $pickList = $(gets).find('.pick-list');
			$pickList.empty();

			var getsId = tradeMachine.extractFranchiseId(gets.id);

			tradeMachine.franchisesInvolved().forEach((franchiseId) => {
				if (franchiseId !== getsId) {
					var $optgroup = $('select.master-pick-list optgroup[class=picks-' + franchiseId + ']').clone();
					
					// Remove picks already in the deal
					$optgroup.find('option').each((j, opt) => {
						if (picksInDeal.includes($(opt).val())) {
							$(opt).remove();
						}
					});
					
					// Only add optgroup if it still has options
					if ($optgroup.find('option').length > 0) {
						$pickList.append($optgroup);
					}
				}
			});
		});
	},

	rebuildPlayerLists: () => {
		// Collect all player IDs already in any bucket
		var playersInDeal = [];
		tradeMachine.franchisesInvolved().forEach((fId) => {
			tradeMachine.deal[fId].players.forEach((p) => {
				playersInDeal.push(p.id);
			});
		});
		
		$('.gets').each((i, gets) => {
			var $playerList = $(gets).find('.player-list');
			$playerList.empty();

			var getsId = tradeMachine.extractFranchiseId(gets.id);

			tradeMachine.franchisesInvolved().forEach((franchiseId) => {
				if (franchiseId !== getsId) {
					var $optgroup = $('select.master-player-list optgroup[class=players-' + franchiseId + ']').clone();
					
					// Remove players already in the deal
					$optgroup.find('option').each((j, opt) => {
						if (playersInDeal.includes($(opt).val())) {
							$(opt).remove();
						}
					});
					
					// Only add optgroup if it still has options
					if ($optgroup.find('option').length > 0) {
						$playerList.append($optgroup);
					}
				}
			});
		});
	},

	rebuildFranchiseLists: () => {
		$('.gets').each((i, gets) => {
			var $franchiseList = $(gets).find('.franchise-list');
			$franchiseList.empty();

			var getsId = tradeMachine.extractFranchiseId(gets.id);

			tradeMachine.franchisesInvolved().forEach((franchiseId) => {
				if (franchiseId !== getsId) {
					$franchiseList.append($('select.master-franchise-list option[class=franchises-' + franchiseId + ']').clone());
				}
			});
		});
	},

	// Calculate trade impact for each franchise
	calculateTradeImpact: () => {
		var impact = {};
		var franchises = tradeMachine.franchisesInvolved();
		
		franchises.forEach((fId) => {
			impact[fId] = {
				playersIn: 0,
				playersOut: 0,
				salaryIn: 0,
				salaryOut: 0,
				recoverableIn: 0,
				recoverableOut: 0
			};
		});
		
		franchises.forEach((receivingId) => {
			var bucket = tradeMachine.deal[receivingId];
			
			bucket.players.forEach((player) => {
				if (player.terms !== 'rfa-rights') {
					impact[receivingId].playersIn++;
					impact[receivingId].salaryIn += player.salary || 0;
					impact[receivingId].recoverableIn += player.recoverable || 0;
					
					if (player.fromFranchiseId && impact[player.fromFranchiseId]) {
						impact[player.fromFranchiseId].playersOut++;
						impact[player.fromFranchiseId].salaryOut += player.salary || 0;
						impact[player.fromFranchiseId].recoverableOut += player.recoverable || 0;
					}
				}
			});
		});
		
		return impact;
	},

	// Generate warnings for a specific franchise
	getWarningsForFranchise: (fId) => {
		var warnings = [];
		var data = franchiseData[fId];
		if (!data) return warnings;
		
		var impact = tradeMachine.calculateTradeImpact();
		var cashDeltas = tradeMachine.calculateCashDeltas(currentSeason);
		
		var imp = impact[fId];
		if (!imp) return warnings;
		
		var netSalary = imp.salaryIn - imp.salaryOut;
		var netRecoverable = imp.recoverableIn - imp.recoverableOut;
		var cashDelta = cashDeltas[fId] || 0;
		
		// New available after trade (salary change reduces available, cash received increases it)
		var newAvailable = data.available - netSalary + cashDelta;
		
		// New recoverable after trade (accounts for players moving in/out)
		var newRecoverable = data.recoverable + netRecoverable;
		
		// Cap warnings only if available goes negative
		if (newAvailable < 0) {
			var deficit = Math.abs(newAvailable);
			
			// Check if recoverable can cover the deficit (soft cap)
			if (isBeforeCutDay && (newAvailable + newRecoverable) >= 0) {
				warnings.push({
					type: 'warning',
					icon: 'fa-exclamation-circle',
					text: '$' + deficit + ' over (can recover)'
				});
			} else {
				warnings.push({
					type: 'danger',
					icon: 'fa-exclamation-triangle',
					text: '$' + deficit + ' over cap'
				});
			}
		}
		
		return warnings;
	},

	// Update warnings on all party cards
	updatePartyWarnings: () => {
		var franchises = tradeMachine.franchisesInvolved();
		
		// Clear all warnings first
		$('.party-warnings').empty().addClass('d-none');
		
		franchises.forEach((fId) => {
			var warnings = tradeMachine.getWarningsForFranchise(fId);
			var $container = $('#gets-' + fId + ' .party-warnings');
			
			if (warnings.length > 0) {
				$container.removeClass('d-none');
				warnings.forEach((w) => {
					$container.append(
						$('<span class="badge badge-pill badge-' + w.type + ' mr-1"><i class="fa ' + w.icon + ' mr-1"></i>' + w.text + '</span>')
					);
				});
			}
		});
	},

	updateTradeTools: () => {
		var $btn = $('.cash-neutral-btn');
		
		// Update party-specific warnings
		tradeMachine.updatePartyWarnings();
		
		// Update cash-neutral button
		if (tradeMachine.isCashNeutral(currentSeason)) {
			$btn.removeClass('btn-outline-success').addClass('btn-success');
			$btn.find('.btn-text').text('Cash-Neutral ✓');
			$btn.prop('disabled', true);
		} else {
			$btn.removeClass('btn-success').addClass('btn-outline-success');
			$btn.find('.btn-text').text('Make Cash-Neutral');
			$btn.prop('disabled', false);
		}
	},

	redrawTradeMachine: () => {
		$('.gets').addClass('d-none');
		
		var franchises = tradeMachine.franchisesInvolved();
		
		// Show/hide the Trade Details card wrapper
		if (franchises.length >= 2) {
			$('.trade-details-card').removeClass('d-none');
		} else {
			$('.trade-details-card').addClass('d-none');
		}
		
		// Rebuild dropdowns to exclude already-traded assets
		tradeMachine.rebuildPlayerLists();
		tradeMachine.rebuildPickLists();

		franchises.forEach((franchiseId, index) => {
			var $franchiseSection = $('.gets[id=gets-' + franchiseId + ']');
			var $franchiseAssetList = $franchiseSection.find('ul.assets');
			var $separator = $franchiseSection.find('.party-separator');

			$franchiseSection.removeClass('d-none');
			$franchiseAssetList.empty();
			
			// Hide separator on last party
			if (index === franchises.length - 1) {
				$separator.addClass('d-none');
			} else {
				$separator.removeClass('d-none');
			}

			var sortedAssets = tradeMachine.sortedAssetsForFranchise(franchiseId);
			var count = sortedAssets.length;

			if (count === 0) {
				$franchiseAssetList.append($('<li class="text-muted empty-state"><i class="fa fa-inbox mr-2"></i>Nothing yet</li>'));
			}
			else {
				sortedAssets.forEach((asset) => {
					var cssClass = 'asset-' + asset.type;
					var icon = tradeMachine.iconForAsset(asset);
					var removeBtn = '<button class="remove-asset btn btn-link btn-sm p-0" data-type="' + asset.type + '" data-id="' + asset.id + '"><i class="fa fa-times"></i></button>';
					$franchiseAssetList.append($('<li class="' + cssClass + '">' + icon + '<span class="asset-content d-flex justify-content-between align-items-center">' + tradeMachine.textForAsset(asset) + removeBtn + '</span></li>'));
				});
			}
		});
		
		tradeMachine.updateTradeTools();
		tradeMachine.renderBudgetImpact();
	},

	reset: () => {
		tradeMachine.deal = {};
		$('.form-check-input').prop('checked', false);
		tradeMachine.redrawTradeMachine();
	},

	// Calculate salary delta for each franchise (positive = receiving more salary)
	calculateSalaryDeltas: () => {
		var deltas = {};
		var franchises = tradeMachine.franchisesInvolved();
		
		// Initialize deltas
		franchises.forEach((fId) => {
			deltas[fId] = 0;
		});
		
		// For each franchise, add salary they receive, subtract salary they give
		franchises.forEach((receivingId) => {
			var bucket = tradeMachine.deal[receivingId];
			
			// Add salary from players they receive
			bucket.players.forEach((player) => {
				var salary = player.salary || 0;
				if (player.terms !== 'rfa-rights') {
					deltas[receivingId] += salary;
					// The franchise giving this player loses salary
					if (player.fromFranchiseId && deltas[player.fromFranchiseId] !== undefined) {
						deltas[player.fromFranchiseId] -= salary;
					}
				}
			});
		});
		
		return deltas;
	},

	// Calculate budget impact per season for each franchise
	// Returns { franchiseId: { 2025: delta, 2026: delta, 2027: delta } }
	calculateBudgetImpact: () => {
		var franchises = tradeMachine.franchisesInvolved();
		var seasons = [currentSeason, currentSeason + 1, currentSeason + 2];
		var impact = {};
		
		// Initialize impact structure
		franchises.forEach((fId) => {
			impact[fId] = {};
			seasons.forEach((s) => {
				impact[fId][s] = 0;
			});
		});
		
		// Process players - salary affects budget for years the contract covers
		franchises.forEach((receivingId) => {
			var bucket = tradeMachine.deal[receivingId];
			
			bucket.players.forEach((player) => {
				if (player.terms === 'rfa-rights') return;
				
				var salary = player.salary || 0;
				var contract = player.contract; // e.g., "24/26" means 2024-2026
				
				// Parse contract end year
				var endYear = null;
				if (contract) {
					var parts = contract.split('/');
					if (parts.length === 2) {
						var endYY = parseInt(parts[1]);
						endYear = 2000 + endYY;
					}
				}
				
				seasons.forEach((season) => {
					// Player's salary counts if contract extends through this season
					if (endYear && season <= endYear) {
						// Receiver gains this salary obligation
						impact[receivingId][season] -= salary;
						// Sender loses this salary obligation  
						if (player.fromFranchiseId && impact[player.fromFranchiseId]) {
							impact[player.fromFranchiseId][season] += salary;
						}
					}
				});
			});
		});
		
		// Process cash - only affects the specific season
		franchises.forEach((receivingId) => {
			var bucket = tradeMachine.deal[receivingId];
			
			bucket.cash.forEach((c) => {
				var season = c.season;
				var amount = c.amount || 0;
				
				if (impact[receivingId][season] !== undefined) {
					// Receiver gains cash (improves budget)
					impact[receivingId][season] += amount;
				}
				if (c.from && impact[c.from] && impact[c.from][season] !== undefined) {
					// Sender loses cash
					impact[c.from][season] -= amount;
				}
			});
		});
		
		return impact;
	},

	// Render the budget impact table
	renderBudgetImpact: () => {
		var $card = $('.budget-impact-card');
		var $container = $('.budget-impact');
		var franchises = tradeMachine.franchisesInvolved();
		
		if (franchises.length < 2) {
			$card.addClass('d-none');
			$container.empty();
			return;
		}
		
		$card.removeClass('d-none');
		
		var impact = tradeMachine.calculateBudgetImpact();
		var seasons = [currentSeason, currentSeason + 1, currentSeason + 2];
		
		var html = '<table class="table table-sm table-borderless mb-0">';
		html += '<thead><tr><th></th>';
		seasons.forEach((s) => {
			html += '<th class="text-right">' + s + '</th>';
		});
		html += '</tr></thead><tbody>';
		
		franchises.forEach((fId) => {
			var name = tradeMachine.franchiseName(fId);
			html += '<tr><td><strong>' + name + '</strong></td>';
			seasons.forEach((s) => {
				var delta = impact[fId][s];
				var cls = delta > 0 ? 'text-success' : (delta < 0 ? 'text-danger' : 'text-muted');
				var sign = delta > 0 ? '+' : (delta < 0 ? '-' : '');
				var absValue = Math.abs(delta);
				html += '<td class="text-right ' + cls + '">' + sign + '$' + absValue + '</td>';
			});
			html += '</tr>';
		});
		
		html += '</tbody></table>';
		
		$container.html(html);
	},

	// Calculate net cash position for each franchise in current season
	calculateCashDeltas: (currentSeason) => {
		var deltas = {};
		var franchises = tradeMachine.franchisesInvolved();
		
		franchises.forEach((fId) => {
			deltas[fId] = 0;
		});
		
		franchises.forEach((receivingId) => {
			var bucket = tradeMachine.deal[receivingId];
			
			bucket.cash.forEach((c) => {
				if (c.season === currentSeason) {
					// Receiving franchise gets cash
					deltas[receivingId] += c.amount;
					// Sending franchise loses cash
					if (deltas[c.from] !== undefined) {
						deltas[c.from] -= c.amount;
					}
				}
			});
		});
		
		return deltas;
	},

	// Check if trade is cash-neutral for current season
	isCashNeutral: (currentSeason) => {
		var salaryDeltas = tradeMachine.calculateSalaryDeltas();
		var cashDeltas = tradeMachine.calculateCashDeltas(currentSeason);
		var franchises = tradeMachine.franchisesInvolved();
		
		if (franchises.length < 2) return true;
		
		// Trade is neutral if salary taken on equals cash received
		// salaryDelta = cap burden change, cashDelta = cap relief from cash
		// Neutral when: salaryDelta = cashDelta (cash received offsets salary taken on)
		for (var i = 0; i < franchises.length; i++) {
			var fId = franchises[i];
			var salaryDelta = salaryDeltas[fId] || 0;
			var cashDelta = cashDeltas[fId] || 0;
			if (salaryDelta !== cashDelta) return false;
		}
		return true;
	},

	// Make the trade cash-neutral by adding appropriate cash transactions
	makeCashNeutral: (currentSeason) => {
		var salaryDeltas = tradeMachine.calculateSalaryDeltas();
		var franchises = tradeMachine.franchisesInvolved();
		
		if (franchises.length < 2) return;
		
		// Remove existing current-season cash between involved parties
		franchises.forEach((fId) => {
			tradeMachine.deal[fId].cash = tradeMachine.deal[fId].cash.filter((c) => {
				return c.season !== currentSeason || !franchises.includes(c.from);
			});
		});
		
		// Positive delta = taking on more salary = should RECEIVE cash
		// Negative delta = shedding salary = should SEND cash
		var receivers = [];
		var senders = [];
		
		franchises.forEach((fId) => {
			var delta = salaryDeltas[fId] || 0;
			if (delta > 0) {
				receivers.push({ id: fId, amount: delta });
			} else if (delta < 0) {
				senders.push({ id: fId, amount: -delta });
			}
		});
		
		// Match senders to receivers
		var senderIdx = 0;
		var receiverIdx = 0;
		
		while (senderIdx < senders.length && receiverIdx < receivers.length) {
			var sender = senders[senderIdx];
			var receiver = receivers[receiverIdx];
			
			var amount = Math.min(sender.amount, receiver.amount);
			
			if (amount > 0) {
				// Add cash from sender to receiver
				tradeMachine.deal[receiver.id].cash.push({
					type: 'cash',
					id: sender.id + '-' + currentSeason,
					amount: amount,
					from: sender.id,
					season: currentSeason
				});
			}
			
			sender.amount -= amount;
			receiver.amount -= amount;
			
			if (sender.amount === 0) senderIdx++;
			if (receiver.amount === 0) receiverIdx++;
		}
		
		tradeMachine.redrawTradeMachine();
	},

	roundOrdinal: (round) => {
		switch (round) {
			case 1: return '1st';
			case 2: return '2nd';
			case 3: return '3rd';
			default: return round + 'th';
		}
	},

	sortedAssetsForFranchise: (franchiseId) => {
		var goingToDeal = tradeMachine.deal[franchiseId];
		var sortedAssets = [];

		goingToDeal.players.forEach((player) => {
			sortedAssets.push(player);
		});

		goingToDeal.picks.forEach((pick) => {
			sortedAssets.push(pick);
		});

		goingToDeal.cash.forEach((cash) => {
			sortedAssets.push(cash);
		});

		sortedAssets.sort(tradeMachine.assetSortFunction);

		return sortedAssets;
	},

	terms: (player) => {
		if (player.terms == 'unsigned') {
			return '$' + player.salary + ', unsigned';
		}
		else if (player.terms == 'rfa-rights') {
			return 'RFA rights';
		}
		else {
			return '$' + player.salary + ', ' + player.contract;
		}
	},

	formatPickNumber: (pickNumber, teamsPerRound) => {
		// Convert overall pick number to round.pick format (e.g., 1.09)
		teamsPerRound = teamsPerRound || 12;
		var round = Math.ceil(pickNumber / teamsPerRound);
		var pickInRound = ((pickNumber - 1) % teamsPerRound) + 1;
		return round + '.' + pickInRound.toString().padStart(2, '0');
	},

	iconForAsset: (asset) => {
		if (asset.type == 'player') {
			return '<span class="asset-icon player-icon"><i class="fa fa-user"></i></span>';
		}
		else if (asset.type == 'pick') {
			return '<span class="asset-icon pick-icon"><i class="fa fa-ticket"></i></span>';
		}
		else if (asset.type == 'cash') {
			return '<span class="asset-icon cash-icon">$</span>';
		}
		return '';
	},

	textForAsset: (asset) => {
		if (asset.type == 'player') {
			return asset.name + ' (' + tradeMachine.terms(asset) + ')';
		}
		else if (asset.type == 'pick') {
			var text = tradeMachine.roundOrdinal(asset.round) + ' round draft pick';
			if (asset.pickNumber) {
				var teamsPerRound = (asset.season <= 2011) ? 10 : 12;
				text += ' (#' + tradeMachine.formatPickNumber(asset.pickNumber, teamsPerRound) + ')';
			}
			text += ' from ' + asset.origin + ' in ' + asset.season;
			return text;
		}
		else if (asset.type == 'cash') {
			return '$' + asset.amount + ' from ' + tradeMachine.franchiseName(asset.from) + ' in ' + asset.season;
		}
	}
};

$(document).ready(function() {
	$('.form-check-input:checked').each((i, input) => {
		var franchiseId = tradeMachine.extractFranchiseId(input.id);

		tradeMachine.toggleFranchiseInvolvement(franchiseId);
		tradeMachine.redrawTradeMachine();
	});

	$('.form-check').on('click', '.form-check-input', (e) => {
		var franchiseId = tradeMachine.extractFranchiseId(e.currentTarget.id);

		tradeMachine.toggleFranchiseInvolvement(franchiseId);
		tradeMachine.redrawTradeMachine();
	});

	$('.gets').on('click', '.add-player', (e) => {
		var franchiseId = tradeMachine.extractFranchiseId(e.delegateTarget.id);
		var playerId = $('#gets-' + franchiseId + ' select.player-list').val();

		tradeMachine.addPlayerToDeal(playerId, franchiseId);
		tradeMachine.redrawTradeMachine();
	});

	$('.gets').on('click', '.add-pick', (e) => {
		var $gets = $(e.delegateTarget);

		var franchiseId = tradeMachine.extractFranchiseId(e.delegateTarget.id);
		var pickId = $gets.find('.pick-list').val();

		tradeMachine.addPickToDeal(pickId, franchiseId);
		tradeMachine.redrawTradeMachine();
	});

	$('.gets').on('click', '.add-cash', (e) => {
		var $gets = $(e.delegateTarget);

		var toFranchiseId = tradeMachine.extractFranchiseId(e.delegateTarget.id);
		var amount = parseInt($gets.find('input.amount').val());
		var fromFranchiseId = $gets.find('select.franchise-list').val();
		var season = parseInt($gets.find('select.season-list').val());

		tradeMachine.addCashToDeal(amount, fromFranchiseId, season, toFranchiseId);
		tradeMachine.redrawTradeMachine();
		
		// Clear the amount field after adding
		$gets.find('input.amount').val('');
	});

	$('.reset-trade-machine').on('click', (e) => {
		tradeMachine.reset();
	});

	$('.cash-neutral-btn').on('click', (e) => {
		tradeMachine.makeCashNeutral(currentSeason);
	});

	// Remove asset from deal
	$(document).on('click', '.remove-asset', (e) => {
		e.preventDefault();
		var $btn = $(e.currentTarget);
		var $gets = $btn.closest('.gets');
		var franchiseId = tradeMachine.extractFranchiseId($gets.attr('id'));
		var assetType = $btn.data('type');
		var assetId = $btn.data('id');

		if (assetType === 'player') {
			tradeMachine.deal[franchiseId].players = tradeMachine.deal[franchiseId].players.filter(p => p.id !== assetId);
		}
		else if (assetType === 'pick') {
			tradeMachine.deal[franchiseId].picks = tradeMachine.deal[franchiseId].picks.filter(p => p.id !== assetId);
		}
		else if (assetType === 'cash') {
			// For cash, the id is constructed as "from-season"
			tradeMachine.deal[franchiseId].cash = tradeMachine.deal[franchiseId].cash.filter(c => (c.from + '-' + c.season) !== assetId);
		}

		tradeMachine.redrawTradeMachine();
	});
});
