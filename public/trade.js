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
		return elementId.substring(elementId.indexOf('franchise-'));
	},

	franchiseName: (franchiseId) => {
		var $franchise = $('select.master-franchise-list option[id=franchises-' + franchiseId + ']');
		return $franchise.data('name');
	},

	franchisesInvolved: () => {
		return Object.keys(tradeMachine.deal);
	},

	playerData: (playerId) => {
		var $player = $('select.master-player-list option[value="' + playerId + '"]');

		return {
			type: 'player',
			id: playerId,
			name: $player.data('name'),
			salary: parseInt($player.data('salary')),
			contract: $player.data('contract')
		};
	},

	rebuildPickLists: () => {
		$('select.picks-list').each((i, list) => {
			var $this = $(list);
			$this.empty();

			tradeMachine.franchisesInvolved().forEach((franchiseId) => {
				if (!list.id.endsWith(franchiseId)) {
					$this.append($('select.master-picks-list optgroup[id=picks-' + franchiseId + ']').clone());
				}
			});
		});
	},

	rebuildPlayerLists: () => {
		$('select.player-list').each((i, list) => {
			var $this = $(list);
			$this.empty();

			tradeMachine.franchisesInvolved().forEach((franchiseId) => {
				if (!list.id.endsWith(franchiseId)) {
					$this.append($('select.master-player-list optgroup[id=players-' + franchiseId + ']').clone());
				}
			});
		});
	},

	rebuildFranchiseLists: () => {
		$('select.franchise-list').each((i, list) => {
			var $this = $(list);
			$this.empty();

			tradeMachine.franchisesInvolved().forEach((franchiseId) => {
				if (!list.id.endsWith(franchiseId)) {
					$this.append($('select.master-franchise-list option[id=franchises-' + franchiseId + ']').clone());
				}
			});
		});
	},

	redrawTradeMachine: () => {
		$('.gets').addClass('d-none');

		tradeMachine.franchisesInvolved().forEach((franchiseId) => {
			var goingToDeal = tradeMachine.deal[franchiseId];

			var $franchiseSection = $('.gets[id=gets-' + franchiseId)
			var $franchiseAssetList = $franchiseSection.find('ul');

			$franchiseSection.removeClass('d-none');
			$franchiseAssetList.empty();

			if (goingToDeal.players.length == 0 && goingToDeal.picks.length == 0 && goingToDeal.cash.length == 0) {
				$franchiseAssetList.append($('<li>Nothing</li>'));
			}
			else {
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

				sortedAssets.forEach((asset) => {
					if (asset.type == 'player') {
						$franchiseAssetList.append($('<li>' + asset.name + ' ($' + asset.salary + ', ' + asset.contract + ')</li>'));
					}
					else if (asset.type == 'cash') {
						$franchiseAssetList.append($('<li>$' + asset.amount + ' from ' + tradeMachine.franchiseName(asset.from) + ' in ' + asset.season + '</li>'));
					}
				});
			}
		});
	},
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

	$('.input-group').on('click', '.add-player', (e) => {
		var franchiseId = tradeMachine.extractFranchiseId(e.currentTarget.id);
		var playerId = $('select[id=player-list-' + franchiseId + ']').val();

		tradeMachine.addPlayerToDeal(playerId, franchiseId);
		tradeMachine.redrawTradeMachine();
	});

	$('.input-group').on('click', '.add-cash', (e) => {
		var toFranchiseId = tradeMachine.extractFranchiseId(e.currentTarget.id);
		var amount = parseInt($('input[id=cash-' + toFranchiseId + ']').val());
		var fromFranchiseId = $('select[id=franchise-list-' + toFranchiseId + ']').val();
		var season = parseInt($('select[id=season-list-' + toFranchiseId + ']').val());

		tradeMachine.addCashToDeal(amount, fromFranchiseId, season, toFranchiseId);
		tradeMachine.redrawTradeMachine();
	});
});
