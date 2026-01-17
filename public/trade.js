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
		// Element IDs are like "check-{objectId}" or "party-{objectId}"
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
		
		$('.trade-machine__party').each((i, party) => {
			var $pickList = $(party).find('.pick-list');
			$pickList.empty();

			var partyId = tradeMachine.extractFranchiseId(party.id);

			tradeMachine.franchisesInvolved().forEach((franchiseId) => {
				if (franchiseId !== partyId) {
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
		
		$('.trade-machine__party').each((i, party) => {
			var $playerList = $(party).find('.player-list');
			$playerList.empty();

			var partyId = tradeMachine.extractFranchiseId(party.id);

			tradeMachine.franchisesInvolved().forEach((franchiseId) => {
				if (franchiseId !== partyId) {
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
		$('.trade-machine__party').each((i, party) => {
			var $franchiseList = $(party).find('.franchise-list');
			$franchiseList.empty();

			var partyId = tradeMachine.extractFranchiseId(party.id);

			tradeMachine.franchisesInvolved().forEach((franchiseId) => {
				if (franchiseId !== partyId) {
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
		// Cash-neutral button removed - budget impact now inline with assets
	},

	// Check if user is party to the current deal
	isUserPartyToDeal: () => {
		if (typeof userFranchiseIds === 'undefined' || !userFranchiseIds.length) return false;
		var franchises = tradeMachine.franchisesInvolved();
		return franchises.some((fId) => userFranchiseIds.includes(fId));
	},

	redrawTradeMachine: () => {
		$('.trade-machine__party').addClass('d-none');
		
		var franchises = tradeMachine.franchisesInvolved();
		
		// Show/hide the Trade Details card wrapper
		if (franchises.length >= 2) {
			$('.trade-details-card').removeClass('d-none');
			$('.submit-trade-section').removeClass('d-none');
			
			// Show share/propose section if user is logged in with a franchise
			if (typeof isLoggedIn !== 'undefined' && isLoggedIn && typeof userFranchiseIds !== 'undefined' && userFranchiseIds.length > 0) {
				$('.trade-machine__footer').removeClass('d-none');
				// Show "Propose Trade" button only if user is party to the deal
				if (tradeMachine.isUserPartyToDeal()) {
					$('.propose-trade-btn').removeClass('d-none');
				} else {
					$('.propose-trade-btn').addClass('d-none');
				}
			} else {
				$('.trade-machine__footer').addClass('d-none');
			}
		} else {
			$('.trade-details-card').addClass('d-none');
			$('.submit-trade-section').addClass('d-none');
			$('.trade-machine__footer').addClass('d-none');
		}
		
		// Reset confirmation state when deal changes
		tradeMachine.resetConfirmState();
		
		// Rebuild dropdowns to exclude already-traded assets
		tradeMachine.rebuildPlayerLists();
		tradeMachine.rebuildPickLists();

		franchises.forEach((franchiseId, index) => {
			var $franchiseSection = $('.trade-machine__party[id=party-' + franchiseId + ']');
			var $franchiseAssetList = $franchiseSection.find('ul.asset-list');
			var $separator = $franchiseSection.find('.trade-machine__party-separator');

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
					var $removeBtn = $('<button class="trade-machine__remove-btn btn btn-link btn-sm p-0" data-type="' + asset.type + '" data-id="' + asset.id + '"><i class="fa fa-times"></i></button>');
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

	// Parse contract end year from contract string like "22/26" or "FA/26"
	parseContractEndYear: (contract) => {
		if (!contract) return null;
		var parts = contract.split('/');
		if (parts.length !== 2) return null;
		var endYear = parseInt(parts[1], 10);
		if (isNaN(endYear)) return null;
		// Convert 2-digit year to 4-digit (assumes 2000s)
		return endYear < 100 ? 2000 + endYear : endYear;
	},

	// Calculate salary delta for each franchise for a specific season
	// (accounts for contract end years)
	calculateSalaryDeltasForSeason: (targetSeason) => {
		var deltas = {};
		var franchises = tradeMachine.franchisesInvolved();
		
		// Initialize deltas
		franchises.forEach((fId) => {
			deltas[fId] = 0;
		});
		
		// For each franchise, add salary they receive, subtract salary they give
		// but only if the contract covers the target season
		franchises.forEach((receivingId) => {
			var bucket = tradeMachine.deal[receivingId];
			
			bucket.players.forEach((player) => {
				var salary = player.salary || 0;
				if (player.terms !== 'rfa-rights' && player.terms !== 'unsigned') {
					var endYear = tradeMachine.parseContractEndYear(player.contract);
					// Only count if contract covers the target season
					if (endYear && targetSeason <= endYear) {
						deltas[receivingId] += salary;
						if (player.fromFranchiseId && deltas[player.fromFranchiseId] !== undefined) {
							deltas[player.fromFranchiseId] -= salary;
						}
					}
				}
			});
		});
		
		return deltas;
	},


	// Fetch and render budget impact inline with each party's assets
	renderBudgetImpact: () => {
		var franchises = tradeMachine.franchisesInvolved();
		
		if (franchises.length < 2) {
			$('.budget-impact-summary').remove();
			return;
		}
		
		// Fetch budget impact partial from server
		$.ajax({
			url: '/propose/budget-impact',
			method: 'POST',
			contentType: 'application/json',
			dataType: 'html',
			data: JSON.stringify({ deal: tradeMachine.deal }),
			success: (html) => {
				// Remove existing and replace with new
				$('.budget-impact-summary').remove();
				
				if (!html || !html.trim()) return;
				
				// Append to card-body (action sections are now in card-footer)
				$('.trade-details-card .card-body').append(html);
			},
			error: () => {
				console.error('Error loading budget impact');
			}
		});
	},

	// Make the trade cash-neutral by adding appropriate cash transactions for a specific season
	makeCashNeutral: (targetSeason) => {
		var salaryDeltas = tradeMachine.calculateSalaryDeltasForSeason(targetSeason);
		var franchises = tradeMachine.franchisesInvolved();
		
		if (franchises.length < 2) return;
		
		// Remove existing cash for target season between involved parties
		franchises.forEach((fId) => {
			tradeMachine.deal[fId].cash = tradeMachine.deal[fId].cash.filter((c) => {
				return c.season !== targetSeason || !franchises.includes(c.from);
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
					id: sender.id + '-' + targetSeason,
					amount: amount,
					from: sender.id,
					season: targetSeason
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

	// Reset add asset controls to collapsed state
	resetAddAssetControls: () => {
		$('.trade-machine__add-controls').each((i, controls) => {
			var $controls = $(controls);
			$controls.find('.trade-machine__add-inputs').addClass('d-none');
			$controls.find('.trade-machine__add-trigger').removeClass('d-none');
			$controls.find('.trade-machine__amount-input').val('');
		});
	},


	// Start loading state on a button, returns restore function
	startLoading: ($btn) => {
		$btn.prop('disabled', true);
		return () => {
			$btn.prop('disabled', false);
		};
	},

	// Create an alert banner from the template
	createAlertBanner: (type, icon, messages) => {
		var template = document.getElementById('alert-banner-template');
		
		// Fallback if template not found or has no content
		if (!template || !template.content) {
			var $container = $('<div class="alert alert-' + type + ' mb-0"></div>');
			messages.forEach(function(msg, i) {
				if (i > 0) $container.append('<div class="mt-2"></div>');
				var $row = $('<div class="d-flex align-items-start"></div>');
				$row.append('<i class="fa ' + icon + ' mr-2 mt-1 flex-shrink-0"></i>');
				$row.append($('<span></span>').text(msg));
				$container.append($row);
			});
			return $container;
		}
		
		// For single message, just clone and modify the template directly
		if (messages.length === 1) {
			var clonedContent = template.content.cloneNode(true);
			var banner = clonedContent.querySelector('.alert');
			if (banner) {
				banner.classList.remove('alert-danger');
				banner.classList.add('alert-' + type);
				banner.classList.add('mb-0');
				var iconEl = banner.querySelector('i.fa');
				if (iconEl) {
					iconEl.classList.remove('fa-exclamation-circle');
					iconEl.classList.add(icon);
				}
				var spanEl = banner.querySelector('span');
				if (spanEl) {
					spanEl.textContent = messages[0];
				}
				return $(banner);
			}
		}
		
		// Multiple messages: build container with multiple rows
		var $container = $('<div class="alert alert-' + type + ' mb-0"></div>');
		messages.forEach(function(msg, i) {
			if (i > 0) {
				$container.append('<div class="mt-2"></div>');
			}
			var $row = $('<div class="d-flex align-items-start"></div>');
			$row.append('<i class="fa ' + icon + ' mr-2 mt-1 flex-shrink-0"></i>');
			$row.append($('<span></span>').text(msg));
			$container.append($row);
		});
		
		return $container;
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
				
				$result.html(tradeMachine.createAlertBanner('danger', 'fa-exclamation-circle', errors)).removeClass('d-none');
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

	// Pre-populate from an existing proposal if initialDeal is set
	if (typeof initialDeal !== 'undefined' && initialDeal) {
		var missingAssets = [];
		
		// First, toggle all franchises into the deal
		Object.keys(initialDeal).forEach(function(franchiseId) {
			if (!tradeMachine.deal[franchiseId]) {
				// Check the checkbox and toggle the franchise
				$('#check-' + franchiseId).prop('checked', true);
				tradeMachine.toggleFranchiseInvolvement(franchiseId);
			}
		});
		
		// Then add all assets, tracking any that can't be found
		Object.keys(initialDeal).forEach(function(franchiseId) {
			var bucket = initialDeal[franchiseId];
			
			// Add players
			(bucket.players || []).forEach(function(playerId) {
				var $player = $('select.master-player-list option[value="' + playerId + '"]');
				if ($player.length === 0) {
					missingAssets.push('player');
				} else {
					tradeMachine.addPlayerToDeal(playerId, franchiseId);
				}
			});
			
			// Add picks
			(bucket.picks || []).forEach(function(pickId) {
				var $pick = $('select.master-pick-list option[value="' + pickId + '"]');
				if ($pick.length === 0) {
					missingAssets.push('pick');
				} else {
					tradeMachine.addPickToDeal(pickId, franchiseId);
				}
			});
			
			// Add cash
			(bucket.cash || []).forEach(function(cashItem) {
				tradeMachine.addCashToDeal(cashItem.amount, cashItem.from, cashItem.season, franchiseId);
			});
		});
		
		tradeMachine.redrawTradeMachine();
		
		// Show warning if any assets couldn't be loaded
		if (missingAssets.length > 0) {
			var numberToWord = function(n) {
				var words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
				return n <= 10 ? words[n] : String(n);
			};
			
			var playerCount = missingAssets.filter(function(a) { return a === 'player'; }).length;
			var pickCount = missingAssets.filter(function(a) { return a === 'pick'; }).length;
			
			var parts = [];
			if (playerCount === 1) parts.push('one player');
			else if (playerCount > 1) parts.push(numberToWord(playerCount) + ' players');
			if (pickCount === 1) parts.push('one pick');
			else if (pickCount > 1) parts.push(numberToWord(pickCount) + ' picks');
			
			var msg = parts.join(' and ') + ' from the original deal couldn\'t be loaded — they may have moved.';
			msg = msg.charAt(0).toUpperCase() + msg.slice(1);
			$('.trade-details-card .card-body').prepend(
				'<div class="alert alert-warning mb-3"><i class="fa fa-exclamation-triangle mr-2"></i>' + msg + '</div>'
			);
		}
	} else if (typeof userFranchiseIds !== 'undefined' && userFranchiseIds.length > 0) {
		// Auto-select the current user's franchise(s) on a fresh trade machine
		userFranchiseIds.forEach(function(franchiseId) {
			if (!tradeMachine.deal[franchiseId]) {
				$('#check-' + franchiseId).prop('checked', true);
				tradeMachine.toggleFranchiseInvolvement(franchiseId);
			}
		});
		tradeMachine.redrawTradeMachine();
	}

	$('.form-check').on('click', '.form-check-input', (e) => {
		var franchiseId = tradeMachine.extractFranchiseId(e.currentTarget.id);

		tradeMachine.toggleFranchiseInvolvement(franchiseId);
		tradeMachine.redrawTradeMachine();
	});

	// Add Asset trigger button - shows all inputs
	$('.trade-machine__party').on('click', '.trade-machine__add-trigger', (e) => {
		var $controls = $(e.currentTarget).closest('.trade-machine__add-controls');
		$controls.find('.trade-machine__add-trigger').addClass('d-none');
		$controls.find('.trade-machine__add-inputs').removeClass('d-none');
	});

	// Done button - collapses back to trigger
	$('.trade-machine__party').on('click', '.trade-machine__add-done', (e) => {
		var $controls = $(e.currentTarget).closest('.trade-machine__add-controls');
		$controls.find('.trade-machine__add-inputs').addClass('d-none');
		$controls.find('.trade-machine__add-trigger').removeClass('d-none');
	});

	$('.trade-machine__party').on('click', '.add-player', (e) => {
		var $party = $(e.delegateTarget);
		var franchiseId = tradeMachine.extractFranchiseId($party.attr('id'));
		var playerId = $party.find('select.player-list').val();

		tradeMachine.addPlayerToDeal(playerId, franchiseId);
		tradeMachine.redrawTradeMachine();
	});

	$('.trade-machine__party').on('click', '.add-pick', (e) => {
		var $party = $(e.delegateTarget);

		var franchiseId = tradeMachine.extractFranchiseId(e.delegateTarget.id);
		var pickId = $party.find('.pick-list').val();

		tradeMachine.addPickToDeal(pickId, franchiseId);
		tradeMachine.redrawTradeMachine();
	});

	$('.trade-machine__party').on('click', '.add-cash', (e) => {
		var $party = $(e.delegateTarget);

		var toFranchiseId = tradeMachine.extractFranchiseId(e.delegateTarget.id);
		var amount = parseInt($party.find('.trade-machine__amount-input').val());
		var fromFranchiseId = $party.find('select.franchise-list').val();
		var season = parseInt($party.find('select.season-list').val());

		tradeMachine.addCashToDeal(amount, fromFranchiseId, season, toFranchiseId);
		tradeMachine.redrawTradeMachine();
		
		// Clear the amount field after adding
		$party.find('.trade-machine__amount-input').val('');
	});

	$('.reset-trade-machine').on('click', (e) => {
		tradeMachine.reset();
	});

	// Remove asset from deal
	$(document).on('click', '.trade-machine__remove-btn', (e) => {
		e.preventDefault();
		var $btn = $(e.currentTarget);
		var $party = $btn.closest('.trade-machine__party');
		var franchiseId = tradeMachine.extractFranchiseId($party.attr('id'));
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

	// Make trade cash-neutral (delegated since button is dynamically added)
	$(document).on('click', '.cash-neutral-btn:not(:disabled)', (e) => {
		var season = $(e.currentTarget).data('season') || currentSeason;
		tradeMachine.makeCashNeutral(season);
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
			$result.html(tradeMachine.createAlertBanner('danger', 'fa-exclamation-circle', ['Type the name to confirm']));
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
				
				$result.html(tradeMachine.createAlertBanner('danger', 'fa-exclamation-circle', errors));
			}
		});
	});
});
