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

	addPlayerToFranchise: (playerId, franchiseId) => {
		var playerData = tradeMachine.playerData(playerId);

		if (!tradeMachine.deal[franchiseId].players.includes(playerData)) {
			tradeMachine.deal[franchiseId].players.push(playerData);
		}

		tradeMachine.deal[franchiseId].players.sort((a, b) => {
			return b.salary - a.salary;
		});
	},

	extractFranchiseId: (elementId) => {
		return elementId.substring(elementId.indexOf('franchise-'));
	},

	franchisesInvolved: () => {
		return Object.keys(tradeMachine.deal);
	},

	playerData: (playerId) => {
		var $player = $('select.master-player-list option[value="' + playerId + '"]');
		console.log($player);

		return {
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
					$this.append($('select.master-franchise-list option[id=franchise-' + franchiseId + ']').clone());
				}
			});
		});
	},

	redrawTradeMachine: () => {
		$('.gets').addClass('d-none');

		tradeMachine.franchisesInvolved().forEach((franchiseId) => {
			var goingToFranchise = tradeMachine.deal[franchiseId];

			var $franchiseSection = $('.gets[id=gets-' + franchiseId)
			var $franchiseAssetList = $franchiseSection.find('ul');

			$franchiseSection.removeClass('d-none');
			$franchiseAssetList.empty();

			if (goingToFranchise.players.length == 0 && goingToFranchise.picks.length == 0 && goingToFranchise.cash.length == 0) {
				$franchiseAssetList.append($('<li>Nothing</li>'));
			}
			else {
				goingToFranchise.players.forEach((player) => {
					$franchiseAssetList.append($('<li>' + player.name + ' ($' + player.salary + ', ' + player.contract + ')</li>'));
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

		tradeMachine.addPlayerToFranchise(playerId, franchiseId);
		tradeMachine.redrawTradeMachine();
	});
});
