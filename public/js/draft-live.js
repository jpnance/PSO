$(document).ready(function() {
	var searchInput = $('#draft-live-search');
	var searchResults = $('#draft-live-results');
	var selectedPanel = $('#draft-live-confirm');
	var currentPickId = $('#draft-live-pick-id').val();
	var searchTimeout;
	var selectedPlayer = null;

	searchInput.on('input', function() {
		var query = $(this).val().trim();
		clearTimeout(searchTimeout);

		if (query.length < 2) {
			searchResults.removeClass('active').empty();
			return;
		}

		searchTimeout = setTimeout(function() {
			$.get(DRAFT_SEARCH_URL, { q: query }, function(html) {
				searchResults.html(html);
				searchResults.addClass('active');
				bindResultClicks();
			});
		}, 200);
	});

	searchInput.on('keydown', function(e) {
		if (e.key === 'Escape') {
			searchResults.removeClass('active').empty();
			searchInput.blur();
		}
	});

	$(document).on('click', function(e) {
		if (!$(e.target).closest('.draft-live__search-container').length) {
			searchResults.removeClass('active');
		}
	});

	function bindResultClicks() {
		searchResults.find('.draft-live__result').on('click', function() {
			var el = $(this);
			if (el.data('player-taken')) return;

			var player = {
				_id: el.data('player-id'),
				name: el.data('player-name'),
				positions: el.data('player-positions'),
				team: el.data('player-team')
			};
			selectPlayerForDraft(player);
		});
	}

	function selectPlayerForDraft(player) {
		selectedPlayer = player;
		searchResults.removeClass('active');
		searchInput.val('');

		$.get(DRAFT_SALARY_URL, { playerId: player._id, pickId: currentPickId }, function(html) {
			selectedPanel.html(html).removeClass('d-none');
			$('#draft-live-search-mode').addClass('d-none');
			bindConfirmActions();
		});
	}

	function bindConfirmActions() {
		$('#draft-live-cancel').on('click', function() {
			selectedPlayer = null;
			selectedPanel.addClass('d-none');
			$('#draft-live-search-mode').removeClass('d-none');
			searchInput.val('').focus();
		});

		$('#draft-live-draft').on('click', function() {
			if (!selectedPlayer) return;

			var btn = $(this);
			btn.prop('disabled', true).text('Drafting...');

			$.ajax({
				url: DRAFT_SELECT_URL,
				method: 'POST',
				contentType: 'application/json',
				data: JSON.stringify({
					pickId: currentPickId,
					playerId: selectedPlayer._id
				}),
				success: function() {
					window.location.reload();
				},
				error: function(xhr) {
					var msg = 'Error drafting player';
					try {
						var body = JSON.parse(xhr.responseText);
						if (body.errors) msg = body.errors.join(', ');
					} catch (e) {}
					alert(msg);
					btn.prop('disabled', false).html('<i class="fa fa-check"></i> Draft');
				}
			});
		});
	}

	$('#draft-live-pass').on('click', function() {
		if (!confirm('Pass on this pick?')) return;

		var btn = $(this);
		btn.prop('disabled', true).text('Passing...');

		$.ajax({
			url: DRAFT_PASS_URL,
			method: 'POST',
			contentType: 'application/json',
			data: JSON.stringify({ pickId: currentPickId }),
			success: function() {
				window.location.reload();
			},
			error: function(xhr) {
				var msg = 'Error passing on pick';
				try {
					var body = JSON.parse(xhr.responseText);
					if (body.errors) msg = body.errors.join(', ');
				} catch (e) {}
				alert(msg);
				btn.prop('disabled', false).html('<i class="fa fa-forward"></i> Pass');
			}
		});
	});

	searchInput.focus();
});
