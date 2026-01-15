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
		
		// Parse positions from comma-separated string
		var positionsStr = $player.data('positions') || '';
		var positions = positionsStr ? positionsStr.split(',') : [];
		
		// RFA rights use a different type for icon/styling
		var terms = $player.data('terms');
		var assetType = (terms === 'rfa-rights') ? 'rfa' : 'player';

		return {
			type: assetType,
			id: playerId,
			fromFranchiseId: fromFranchiseId,
			name: $player.data('name'),
			salary: parseInt($player.data('salary')) || 0,
			contract: $player.data('contract'),
			contractDisplay: $player.data('contract-display'),
			terms: terms,
			recoverable: parseInt($player.data('recoverable')) || 0,
			positions: positions
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

	updateTradeTools: () => {
		var $btn = $('.cash-neutral-btn');
		
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

	// Check if user is party to the current deal
	isUserPartyToDeal: () => {
		if (typeof userFranchiseIds === 'undefined' || !userFranchiseIds.length) return false;
		var franchises = tradeMachine.franchisesInvolved();
		return franchises.some((fId) => userFranchiseIds.includes(fId));
	},

	redrawTradeMachine: () => {
		$('.gets').addClass('d-none');
		
		var franchises = tradeMachine.franchisesInvolved();
		
		// Show/hide the Trade Details card wrapper
		if (franchises.length >= 2) {
			$('.trade-details-card').removeClass('d-none');
			$('.submit-trade-section').removeClass('d-none');
			
			// Show share/propose section if user is logged in with a franchise
			if (typeof isLoggedIn !== 'undefined' && isLoggedIn && typeof userFranchiseIds !== 'undefined' && userFranchiseIds.length > 0) {
				$('.share-propose-section').removeClass('d-none');
				// Show "Propose Trade" button only if user is party to the deal
				if (tradeMachine.isUserPartyToDeal()) {
					$('.propose-trade-btn').removeClass('d-none');
				} else {
					$('.propose-trade-btn').addClass('d-none');
				}
			} else {
				$('.share-propose-section').addClass('d-none');
			}
		} else {
			$('.trade-details-card').addClass('d-none');
			$('.submit-trade-section').addClass('d-none');
			$('.share-propose-section').addClass('d-none');
		}
		
		// Reset confirmation state when deal changes
		tradeMachine.resetConfirmState();
		
		// Rebuild dropdowns to exclude already-traded assets
		tradeMachine.rebuildPlayerLists();
		tradeMachine.rebuildPickLists();

		franchises.forEach((franchiseId, index) => {
			var $franchiseSection = $('.gets[id=gets-' + franchiseId + ']');
			var $franchiseAssetList = $franchiseSection.find('ul.asset-list');
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
				$franchiseAssetList.append(tradeMachine.buildNothingElement());
			}
			else {
				sortedAssets.forEach((asset) => {
					var $assetEl = tradeMachine.buildAssetElement(asset);
					
					// Add remove button as direct child of asset-content, pushed to the right
					var $removeBtn = $('<button class="remove-asset btn btn-link btn-sm p-0" data-type="' + asset.type + '" data-id="' + asset.id + '"><i class="fa fa-times"></i></button>');
					$assetEl.find('.asset-content').append($removeBtn);
					
					$franchiseAssetList.append($assetEl);
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
		tradeMachine.resetConfirmState();
	},
	
	resetConfirmState: () => {
		var $btn = $('.submit-trade-btn');
		$btn.removeClass('btn-warning').addClass('btn-primary');
		$btn.html('<i class="fa fa-check mr-1"></i> Submit Trade');
		$btn.prop('disabled', false);
		$('#confirm-execute').val('');
		$('.confirm-execute-section').addClass('d-none');
		$('.trade-result').empty();
		// Reset the confirm flag (accessed via closure in the click handler)
		if (typeof window.resetTradeConfirmed === 'function') {
			window.resetTradeConfirmed();
		}
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

	// Fetch and render budget impact from server
	renderBudgetImpact: () => {
		var $card = $('.budget-impact-card');
		var $container = $('.budget-impact');
		var franchises = tradeMachine.franchisesInvolved();
		
		if (franchises.length < 2) {
			$card.addClass('d-none');
			$container.empty();
			return;
		}
		
		// Keep card hidden until content loads to avoid flash
		// Fetch rendered partial from server
		$.ajax({
			url: '/propose/budget-impact',
			method: 'POST',
			contentType: 'application/json',
			data: JSON.stringify({ deal: tradeMachine.deal }),
			success: (html) => {
				$container.html(html);
				$card.removeClass('d-none');
			},
			error: () => {
				$container.html('<p class="text-muted mb-0">Error loading budget impact.</p>');
				$card.removeClass('d-none');
			}
		});
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
		// Use server-computed contract display for consistent formatting
		return player.contractDisplay;
	},

	formatPickNumber: (pickNumber, teamsPerRound) => {
		// Convert overall pick number to round.pick format (e.g., 1.09)
		teamsPerRound = teamsPerRound || 12;
		var round = Math.ceil(pickNumber / teamsPerRound);
		var pickInRound = ((pickNumber - 1) % teamsPerRound) + 1;
		return round + '.' + pickInRound.toString().padStart(2, '0');
	},

	formatMoney: (n) => {
		return '$' + n.toLocaleString('en-US');
	},

	// Build asset element by cloning template and populating data
	buildAssetElement: (asset) => {
		var templateId = 'asset-' + asset.type + '-template';
		var template = document.getElementById(templateId);
		if (!template) return $('<li></li>');
		
		var $el = $(template.content.cloneNode(true)).children();
		
		if (asset.type === 'player' || asset.type === 'rfa') {
			$el.find('.asset-name').text(asset.name);
			$el.find('.asset-meta').text(tradeMachine.terms(asset));
			
			// Add position badge if positions exist
			if (asset.positions && asset.positions.length > 0) {
				var $badge = tradeMachine.buildPositionBadge(asset.positions);
				$el.find('.asset-name').append(' ').append($badge);
			}
		}
		else if (asset.type === 'pick') {
			var mainText;
			if (asset.pickNumber) {
				var teamsPerRound = (asset.season <= 2011) ? 10 : 12;
				mainText = 'Pick ' + tradeMachine.formatPickNumber(asset.pickNumber, teamsPerRound);
			} else {
				mainText = tradeMachine.roundOrdinal(asset.round) + ' round pick';
			}
			var contextText = ' in ' + asset.season + ' (' + asset.origin + ')';
			
			$el.find('.asset-text strong').text(mainText);
			// Add context text after the strong element
			$el.find('.asset-text strong').after(contextText);
		}
		else if (asset.type === 'cash') {
			$el.find('.asset-text strong').text(tradeMachine.formatMoney(asset.amount));
			$el.find('.asset-text strong').after(' from ' + tradeMachine.franchiseName(asset.from) + ' in ' + asset.season);
		}
		
		return $el;
	},

	// Build position badge by cloning template
	buildPositionBadge: (positions) => {
		var template = document.getElementById('position-badge-template');
		if (!template || !positions || positions.length === 0) return $('');
		
		var $badge = $(template.content.cloneNode(true)).children();
		
		// Sort positions and update badge
		var sorted = tradeMachine.sortPositions(positions);
		$badge.text(sorted.join('/'));
		$badge.removeClass('pos-POS').addClass('pos-' + sorted[0]);
		
		return $badge;
	},

	// Sort positions by standard order
	sortPositions: (positions) => {
		var order = ['QB', 'RB', 'WR', 'TE', 'DL', 'LB', 'DB', 'K'];
		return positions.slice().sort((a, b) => {
			var idxA = order.indexOf(a);
			var idxB = order.indexOf(b);
			return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB);
		});
	},

	// Build "Nothing" placeholder element
	buildNothingElement: () => {
		var template = document.getElementById('asset-nothing-template');
		if (!template) return $('<li></li>');
		return $(template.content.cloneNode(true)).children();
	},

	// Start loading state on a button, returns restore function
	startLoading: ($btn) => {
		$btn.prop('disabled', true);
		return () => {
			$btn.prop('disabled', false);
		};
	},

	// Submit a proposal (isDraft: true = share for discussion, false = real proposal)
	submitProposal: (isDraft) => {
		var $proposeBtn = $('.propose-trade-btn');
		var $shareBtn = $('.share-trade-btn');
		var $result = $('.proposal-result');
		var $linkSection = $('.proposal-link-section');
		var notesVal = $('#proposal-notes').val();
		var notes = notesVal ? notesVal.trim() || null : null;
		
		var $activeBtn = isDraft ? $shareBtn : $proposeBtn;
		var restoreActive = tradeMachine.startLoading($activeBtn);
		var $otherBtn = isDraft ? $proposeBtn : $shareBtn;
		$otherBtn.prop('disabled', true);
		$result.empty().addClass('d-none');
		$linkSection.addClass('d-none');
		
		$.ajax({
			url: '/propose',
			method: 'POST',
			contentType: 'application/json',
			data: JSON.stringify({
				deal: tradeMachine.deal,
				notes: notes,
				isDraft: isDraft
			}),
			success: (response) => {
				// Redirect to the proposal page
				window.location.href = '/propose/' + response.proposalId;
			},
			error: (xhr) => {
				restoreActive();
				$otherBtn.prop('disabled', false);
				
				var response = xhr.responseJSON || {};
				var errors = response.errors || ['Unknown error'];
				
				var html = '<div class="alert alert-danger mb-0">';
				errors.forEach((err, i) => {
					if (i > 0) html += '<br>';
					html += '<i class="fa fa-exclamation-circle mr-2"></i>' + err;
				});
				html += '</div>';
				
				$result.html(html).removeClass('d-none');
			}
		});
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

		if (assetType === 'player' || assetType === 'rfa') {
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

	// Submit trade (admin only) - three phases: show EXECUTE prompt, validate, confirm if warnings
	var executePromptShown = false;
	var tradeConfirmed = false;
	window.resetTradeConfirmed = function() { 
		tradeConfirmed = false; 
		executePromptShown = false;
	};
	
	// Propose trade button (creates pending proposal, proposer auto-accepted)
	$('.propose-trade-btn').on('click', (e) => {
		tradeMachine.submitProposal(false);
	});
	
	// Share trade button (creates draft for discussion)
	$('.share-trade-btn').on('click', (e) => {
		tradeMachine.submitProposal(true);
	});
	
	// Copy link button
	$('.copy-link-btn').on('click', (e) => {
		var $input = $('#proposal-link');
		$input.select();
		document.execCommand('copy');
		
		var $btn = $(e.currentTarget);
		$btn.html('<i class="fa fa-check"></i>');
		setTimeout(() => {
			$btn.html('<i class="fa fa-copy"></i>');
		}, 2000);
	});

	$('.submit-trade-btn').on('click', (e) => {
		var $btn = $(e.currentTarget);
		var $result = $('.trade-result');
		var $confirmSection = $('.confirm-execute-section');
		var notes = $('#trade-notes').val().trim() || null;
		
		// First click: show the EXECUTE prompt
		if (!executePromptShown) {
			executePromptShown = true;
			$confirmSection.removeClass('d-none');
			$('#confirm-execute').focus();
			return;
		}
		
		// Check that the confirmation name was typed
		var confirmVal = $('#confirm-execute').val().trim().toUpperCase();
		var expectedName = (typeof confirmName !== 'undefined' && confirmName) ? confirmName.toUpperCase() : 'EXECUTE';
		if (confirmVal !== expectedName) {
			$result.html('<div class="alert alert-danger mb-0"><i class="fa fa-exclamation-circle mr-2"></i>Type the name to confirm</div>');
			return;
		}
		
		var validateOnly = !tradeConfirmed;
		
		// Disable button while submitting
		$btn.prop('disabled', true);
		$btn.html('<i class="fa fa-spinner fa-spin mr-1"></i> ' + (validateOnly ? 'Validating...' : 'Submitting...'));
		$result.empty();
		
		$.ajax({
			url: '/admin/process-trade',
			method: 'POST',
			contentType: 'application/json',
			data: JSON.stringify({
				deal: tradeMachine.deal,
				notes: notes,
				validateOnly: validateOnly
			}),
			success: (response) => {
				if (response.validated) {
					// Validation passed
					if (response.warnings && response.warnings.length > 0) {
						// Has warnings - show them and require confirmation
						tradeConfirmed = true;
						$btn.prop('disabled', false);
						$btn.removeClass('btn-primary').addClass('btn-warning');
						$btn.html('<i class="fa fa-exclamation-triangle mr-1"></i> Confirm Trade');
						
						var html = '<div class="alert alert-warning mb-0">';
						response.warnings.forEach((w, i) => {
							if (i > 0) html += '<br>';
							html += '<i class="fa fa-exclamation-triangle mr-2"></i>' + w;
						});
						html += '</div>';
						$result.html(html);
					} else {
						// No warnings - submit for real immediately
						tradeConfirmed = true;
						$btn.trigger('click');
					}
				} else {
					// Trade executed - redirect to view it
					window.location.href = '/trades/' + response.tradeId;
				}
			},
			error: (xhr) => {
				tradeConfirmed = false;
				$btn.prop('disabled', false);
				$btn.removeClass('btn-warning').addClass('btn-primary');
				$btn.html('<i class="fa fa-check mr-1"></i> Submit Trade');
				
				var response = xhr.responseJSON || {};
				var errors = response.errors || ['Unknown error'];
				
				var html = '<div class="alert alert-danger mb-0">';
				errors.forEach((err, i) => {
					if (i > 0) html += '<br>';
					html += '<i class="fa fa-exclamation-circle mr-2"></i>' + err;
				});
				html += '</div>';
				
				$result.html(html);
			}
		});
	});
});
