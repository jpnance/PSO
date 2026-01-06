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
			delete tradeMachine.deal[franchiseId];
		}

		tradeMachine.rebuildPlayerLists();
		tradeMachine.rebuildPickLists();
		tradeMachine.rebuildFranchiseLists();
	},

	addPlayerToDeal: (playerId, franchiseId) => {
		var playerData = tradeMachine.playerData(playerId);

		if (!tradeMachine.deal[franchiseId].players.find((player) => player.id == playerData.id)) {
			tradeMachine.deal[franchiseId].players.push(playerData);
		}
	},

	addPickToDeal: (pickId, franchiseId) => {
		var pickData = tradeMachine.pickData(pickId);

		if (pickData.origin.includes(')')) {
			pickData.origin = pickData.origin.replace(')', ', via ' + pickData.owner + ')');
		}
		else if (!pickData.origin.startsWith(pickData.owner)) {
			pickData.origin += ' (via ' + pickData.owner + ')';
		}

		if (!tradeMachine.deal[franchiseId].picks.find((pick) => pick.id == pickData.id)) {
			tradeMachine.deal[franchiseId].picks.push(pickData);
		}
	},

	addCashToDeal: (amount, fromFranchiseId, season, toFranchiseId) => {
		var existingCashFromFranchise = tradeMachine.deal[toFranchiseId].cash.find((asset) => asset.from == fromFranchiseId && asset.season == season);

		if (existingCashFromFranchise) {
			existingCashFromFranchise.amount = amount;
		}
		else {
			tradeMachine.deal[toFranchiseId].cash.push({
				type: 'cash',
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

		return {
			type: 'pick',
			id: pickId,
			season: parseInt($pick.data('season')),
			round: parseInt($pick.data('round')),
			owner: $pick.data('owner'),
			origin: $pick.data('origin')
		};
	},

	playerData: (playerId) => {
		var $player = $('select.master-player-list option[value="' + playerId + '"]');

		return {
			type: 'player',
			id: playerId,
			name: $player.data('name'),
			salary: parseInt($player.data('salary')),
			contract: $player.data('contract'),
			terms: $player.data('terms')
		};
	},

	rebuildPickLists: () => {
		$('.gets').each((i, gets) => {
			var $pickList = $(gets).find('.pick-list');
			$pickList.empty();

			var getsId = tradeMachine.extractFranchiseId(gets.id);

			tradeMachine.franchisesInvolved().forEach((franchiseId) => {
				if (franchiseId !== getsId) {
					$pickList.append($('select.master-pick-list optgroup[class=picks-' + franchiseId + ']').clone());
				}
			});
		});
	},

	rebuildPlayerLists: () => {
		$('.gets').each((i, gets) => {
			var $playerList = $(gets).find('.player-list');
			$playerList.empty();

			var getsId = tradeMachine.extractFranchiseId(gets.id);

			tradeMachine.franchisesInvolved().forEach((franchiseId) => {
				if (franchiseId !== getsId) {
					$playerList.append($('select.master-player-list optgroup[class=players-' + franchiseId + ']').clone());
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

	redrawTradeMachine: () => {
		$('.gets').addClass('d-none');

		tradeMachine.franchisesInvolved().forEach((franchiseId) => {
			var $franchiseSection = $('.gets[id=gets-' + franchiseId + ']');
			var $franchiseAssetList = $franchiseSection.find('ul');

			$franchiseSection.removeClass('d-none');
			$franchiseAssetList.empty();

			var sortedAssets = tradeMachine.sortedAssetsForFranchise(franchiseId);

			if (sortedAssets.length == 0) {
				$franchiseAssetList.append($('<li>Nothing</li>'));
			}
			else {
				sortedAssets.forEach((asset) => {
					$franchiseAssetList.append($('<li>' + tradeMachine.textForAsset(asset) + '</li>'));
				});
			}
		});
	},

	reset: () => {
		tradeMachine.deal = {};
		$('.form-check-input').prop('checked', false);
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

	textForAsset: (asset) => {
		if (asset.type == 'player') {
			return asset.name + ' (' + tradeMachine.terms(asset) + ')';
		}
		else if (asset.type == 'pick') {
			return tradeMachine.roundOrdinal(asset.round) + ' round draft pick from ' + asset.origin + ' in ' + asset.season;
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
	});

	$('.reset-trade-machine').on('click', (e) => {
		tradeMachine.reset();
	});
});
