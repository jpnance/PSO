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

	extractFranchiseId: (elementId) => {
		return elementId.substring(elementId.indexOf('franchise-'));
	},

	franchisesInvolved: () => {
		return Object.keys(tradeMachine.deal);
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
			$('.gets[id=gets-' + franchiseId).removeClass('d-none');
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
});
