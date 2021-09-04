var tradeMachine = {
	franchisesInvolved: [],

	toggleFranchiseInvolvement: (franchiseId) => {
		var index = tradeMachine.franchisesInvolved.indexOf(franchiseId);

		if (index == -1) {
			tradeMachine.franchisesInvolved.push(franchiseId);
		}
		else {
			tradeMachine.franchisesInvolved.splice(index, 1);
		}

		tradeMachine.rebuildPlayerLists();
		tradeMachine.rebuildFranchiseLists();
	},

	rebuildPlayerLists: () => {
		$('select.player-list').each((i, list) => {
			var $this = $(list);
			$this.empty();

			tradeMachine.franchisesInvolved.forEach((franchiseId) => {
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

			tradeMachine.franchisesInvolved.forEach((franchiseId) => {
				if (!list.id.endsWith(franchiseId)) {
					$this.append($('select.master-franchise-list option[id=franchise-' + franchiseId + ']').clone());
				}
			});
		});
	},

	redrawTradeMachine: () => {
		$('.gets').addClass('d-none');

		tradeMachine.franchisesInvolved.forEach((franchiseId) => {
			$('.gets[id=gets-' + franchiseId).removeClass('d-none');
		});
	},
};

$(document).ready(function() {
	$('.form-check-input:checked').each((i, input) => {
		var franchiseId = input.id;

		tradeMachine.toggleFranchiseInvolvement(franchiseId);
		tradeMachine.redrawTradeMachine();
	});

	$('.form-check').on('click', '.form-check-input', (e) => {
		var franchiseId = e.currentTarget.id;

		tradeMachine.toggleFranchiseInvolvement(franchiseId);
		tradeMachine.redrawTradeMachine();
	});
});
