var state = 'new-player';
var loggedInAs;
var lastAuctionData = null;
var lastAuctionStatus = null;
var resultRecorded = false;

var pluralFranchises = ['Koci/Mueller', 'Schexes'];

var socket;
var isReconnecting = false;
var reconnectAttempts = 0;
var reconnectTimeout = null;

var bidButtonTimeout;

$(document).ready(function() {
	connectToWebSocket();

	$('#reconnect').bind('click', function(e) {
		e.preventDefault();

		if (reconnectTimeout) {
			clearTimeout(reconnectTimeout);
			reconnectTimeout = null;
		}
		reconnectAttempts = 0;

		connectToWebSocket();
	});

	$('#activate').bind('click', function(e) {
		e.preventDefault();

		$('#nomination-form #nominator').val('');
		$('#nomination-form #player-list').val('');
		$('#nomination-form #player-search').val('');

		socket.send(JSON.stringify({
			type: 'activate'
		}));
	});

	$('#bid-form').bind('submit', function(e) {
		var newBid = { amount: $(this).find('#bid-amount').val() };

		if ($(this).find('#force-bid').length > 0) {
			newBid.force = true;
			newBid.owner = $(this).find('#owner').val();
		}

		e.preventDefault();

		socket.send(JSON.stringify({
			type: 'makeBid',
			value: newBid
		}));

		$(this).find('#bid-amount').val(null).focus();
	});

	$('#call-roll').bind('click', function(e) {
		e.preventDefault();

		socket.send(JSON.stringify({
			type: 'callRoll'
		}));
	});

	$('#pause').bind('click', function(e) {
		e.preventDefault();

		$('#nomination-form #nominator').val('');
		$('#nomination-form #player-list').val('');
		$('#nomination-form #player-search').val('');

		socket.send(JSON.stringify({
			type: 'pause'
		}));
	});

	$('body.admin .nominating .who').bind('click', function(e) {
		$('#nominator').val($(this).text());
		$('#player-list').val('');
		$('#player-search').val('');
		$('#owner').val($(this).text());
	});

	$('#nomination-form').bind('submit', function(e) {
		var newPlayer = {
			name: $(this).find('#name').val(),
			nominator: $(this).find('#nominator').val(),
			position: $(this).find('#position').val(),
			team: $(this).find('#team').val(),
			situation: $(this).find('#situation').val()
		};

		var playerId = $(this).find('#player-id').val();
		if (playerId) {
			newPlayer.playerId = playerId;
		}

		var pfrId = $(this).find('#pfr-id').val();
		if (pfrId) {
			newPlayer.pfrId = pfrId;
		}

		e.preventDefault();

		socket.send(JSON.stringify({
			type: 'nominate',
			value: newPlayer
		}));

		resultRecorded = false;
		$(this).find('#player-id').val('');
		$(this).find('#pfr-id').val('');
		$(this).find('#player-search').val('');
	});

	$('#nomination-form #nominator').bind('change', function(e) {
		var $this = $(e.target);

		if ($this.val() != '--') {
			$('#bid-form #owner').val($this.val());
		}
	});

	$('#nomination-form #player-list').bind('change', function(e) {
		var $this = $(e.target);

		if ($this.val() != '--') {
			var playerValues = $this.val().split(/,/);

			$('#nomination-form #name').val(playerValues[0]);
			$('#nomination-form #position').val(playerValues[1]);
			$('#nomination-form #team').val(playerValues[2]);
			$('#nomination-form #situation').val(playerValues[3]);
		}
		else {
			$('#nomination-form #name').val('--');
		}
	});

	$('#nomination-order-form').bind('submit', function(e) {
		e.preventDefault();

		var owner = $(this).find('#remove-owner').val();
		if (!owner) return;

		if (typeof AUCTION_PREVIEW_REMOVE_URL !== 'undefined') {
			var removeDialog = document.getElementById('remove-owner-dialog');
			$('#remove-owner-name').text(owner);
			$('#remove-owner-confirm').data('owner', owner).prop('disabled', false).text('Remove');

			$.getJSON(AUCTION_PREVIEW_REMOVE_URL, { owner: owner }, function(data) {
				var list = $('#remove-owner-players');
				list.empty();

				if (data.players && data.players.length > 0) {
					$('#remove-owner-no-rfa').hide();
					list.show();
					data.players.forEach(function(p) {
						list.append('<li>' + p.name + '</li>');
					});
				} else {
					list.hide();
					$('#remove-owner-no-rfa').show();
				}

				removeDialog.showModal();
			});
		} else {
			socket.send(JSON.stringify({
				type: 'removeOwner',
				value: { owner: owner }
			}));
		}
	});

	$('#remove-owner-confirm').on('click', function() {
		var owner = $(this).data('owner');
		socket.send(JSON.stringify({
			type: 'removeOwner',
			value: { owner: owner }
		}));
		document.getElementById('remove-owner-dialog').close();
		$('#remove-owner').val('');
	});

	$('#remove-owner-close, #remove-owner-cancel').on('click', function() {
		document.getElementById('remove-owner-dialog').close();
	});

	$('#pop').bind('click', function(e) {
		e.preventDefault();

		socket.send(JSON.stringify({
			type: 'pop'
		}));
	});

	$('#roll-call').bind('click', function(e) {
		e.preventDefault();

		socket.send(JSON.stringify({
			type: 'rollCall'
		}));
	});

	$('#set-timer-form').bind('submit', function(e) {
		var timer = {
			guaranteed: parseInt($(this).find('#set-timer-guaranteed').val()) * 1000,
			resetTo: parseInt($(this).find('#set-timer-reset-to').val()) * 1000
		};

		e.preventDefault();

		socket.send(JSON.stringify({
			type: 'setTimer',
			value: timer
		}));
	});

	$('#simulate-bids').bind('click', function(e) {
		e.preventDefault();

		socket.send(JSON.stringify({
			type: 'simulateBids'
		}));
	});

	$('#start-demo').bind('click', function(e) {
		e.preventDefault();

		socket.send(JSON.stringify({
			type: 'startDemo'
		}));
	});

	$('#stop-demo').bind('click', function(e) {
		e.preventDefault();

		socket.send(JSON.stringify({
			type: 'stopDemo'
		}));
	});

	// Player search (dynamic admin page only)
	var searchInput = $('#player-search');
	var searchResults = $('#player-search-results');
	var searchTimeout;

	if (searchInput.length > 0 && typeof AUCTION_SEARCH_URL !== 'undefined') {
		searchInput.on('input', function() {
			var query = $(this).val().trim();
			clearTimeout(searchTimeout);

			if (query.length < 2) {
				searchResults.removeClass('active').empty();
				return;
			}

			searchTimeout = setTimeout(function() {
				$.get(AUCTION_SEARCH_URL, { q: query }, function(html) {
					searchResults.html(html);
					searchResults.addClass('active');
					bindSearchResultClicks();
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
			if (!$(e.target).closest('.auction-search').length) {
				searchResults.removeClass('active');
			}
		});
	}

	function bindSearchResultClicks() {
		searchResults.find('.auction-search__result').on('click', function() {
			var el = $(this);

			$('#player-id').val(el.data('player-id'));
			$('#name').val(el.data('player-name'));
			$('#team').val(el.data('player-team') || '');
			$('#pfr-id').val(el.data('player-pfr-id') || '');

			var positions = el.data('player-positions');
			if (positions) {
				$('#position').val(positions.split('/')[0]);
			}

			var situation = el.data('player-situation') || 'UFA';
			$('#situation').val(situation);

			searchResults.removeClass('active').empty();
			searchInput.val('');
		});
	}

	// Record Result dialog (dynamic admin page only)
	if (typeof AUCTION_RECORD_URL !== 'undefined') {
		var recordDialog = document.getElementById('record-result-dialog');
		var recordRfaHolder = null;
		var recordHighBidder = null;
		var recordInitialAmount = 0;
		var recordWinner = null;
		var recordAmount = null;
		var recordAuctionType = null;

		function showRecordScreen(screen) {
			$('.record-result__screen').hide();
			$('#record-screen-' + screen).show();
		}

		function deriveType(winner) {
			if (!recordRfaHolder) return 'auction-ufa';
			return winner === recordRfaHolder ? 'auction-rfa-matched' : 'auction-rfa-unmatched';
		}

		function buildReviewHtml(winner, amount, type) {
			var player = $('#record-player-name-hidden').val();

			if (type === 'auction-rfa-matched') {
				return '<div class="record-result__review-main"><strong>' + winner + '</strong> keeps <strong>' + player + '</strong> for <strong>$' + amount + '</strong></div>';
			} else if (type === 'auction-rfa-unmatched') {
				return '<div class="record-result__review-context">' + recordRfaHolder + ' declines to match</div>'
					+ '<div class="record-result__review-main"><strong>' + winner + '</strong> wins <strong>' + player + '</strong> for <strong>$' + amount + '</strong></div>';
			} else {
				return '<div class="record-result__review-main"><strong>' + winner + '</strong> wins <strong>' + player + '</strong> for <strong>$' + amount + '</strong></div>';
			}
		}

		function showReviewScreen(winner, amount) {
			recordWinner = winner;
			recordAmount = amount;
			recordAuctionType = deriveType(winner);
			$('#record-type').val(recordAuctionType);

			$('#review-body').html(buildReviewHtml(winner, amount, recordAuctionType));

			$('#record-status').empty();
			$('#review-record').prop('disabled', false).text('Record');

			showRecordScreen('review');
		}

		function populateFinalBid(playerName, rfaHolder, owner, amount) {
			$('#final-bid-player').text(playerName);
			$('#final-bid-situation-label').text('RFA (' + rfaHolder + ')');
			$('#final-bid-owner').text(owner);
			$('#final-bid-raise-amount').val(amount);
			$('#final-bid-error').hide();
			$('#record-initial-amount').val(amount);
		}

		function populateEditScreen() {
			$('#edit-player-name').text($('#record-player-name-hidden').val());
			$('#edit-situation').val(recordRfaHolder ? 'RFA-' + recordRfaHolder : 'UFA');
			$('#edit-winner').val(recordHighBidder);
			$('#edit-amount').val(recordInitialAmount);
		}

		// Open dialog
		$(document).on('click', '#record-result-btn', function() {
			if (!lastAuctionData || !lastAuctionData.bids || lastAuctionData.bids.length === 0) return;

			var winningBid = lastAuctionData.bids[0];
			var situation = lastAuctionData.player.situation || 'UFA';
			var playerName = lastAuctionData.player.name;

			$('#record-player-id').val(lastAuctionData.player.playerId || '');
			$('#record-player-name-hidden').val(playerName);
			recordHighBidder = winningBid.owner;
			recordInitialAmount = winningBid.amount;

			if (situation.startsWith('RFA-')) {
				recordRfaHolder = situation.replace('RFA-', '');
				$('#record-rfa-holder').val(recordRfaHolder);
				populateFinalBid(playerName, recordRfaHolder, winningBid.owner, winningBid.amount);
				showRecordScreen('final-bid');
			} else {
				recordRfaHolder = null;
				$('#record-rfa-holder').val('');
				showReviewScreen(winningBid.owner, winningBid.amount);
			}

			recordDialog.showModal();
		});

		$('#final-bid-raise-amount').on('click', function() {
			$(this).select();
		});

		// Final Bid: Back to Edit (raw override)
		$('#final-bid-back').on('click', function() {
			populateEditScreen();
			showRecordScreen('edit');
		});

		// Final Bid: Continue
		$('#final-bid-continue').on('click', function() {
			var enteredAmount = parseInt($('#final-bid-raise-amount').val(), 10);
			var initialAmount = parseInt($('#record-initial-amount').val(), 10);

			if (!enteredAmount || enteredAmount < initialAmount) {
				$('#final-bid-error').text('Amount must be at least $' + initialAmount).show();
				return;
			}

			$('#final-bid-error').hide();

			if (enteredAmount > initialAmount) {
				socket.send(JSON.stringify({
					type: 'makeBid',
					value: { amount: enteredAmount, force: true, owner: recordHighBidder }
				}));
			}

			var currentAmount = enteredAmount;

			$('#rfa-decision-player').text($('#record-player-name-hidden').val());
			$('#rfa-decision-holder').text(recordRfaHolder);
			$('#rfa-decision-amount').text(currentAmount);
			$('#rfa-decision-bidder').text(recordHighBidder);

			showRecordScreen('rfa-decision');
		});

		// RFA Decision: Match
		$('#rfa-match').on('click', function() {
			var amount = parseInt($('#rfa-decision-amount').text(), 10);
			showReviewScreen(recordRfaHolder, amount);
		});

		// RFA Decision: Pass
		$('#rfa-pass').on('click', function() {
			var amount = parseInt($('#rfa-decision-amount').text(), 10);
			showReviewScreen(recordHighBidder, amount);
		});

		// RFA Decision: Back to Final Bid (pop the force bid if one was added)
		$('#rfa-decision-back').on('click', function() {
			var currentAmount = parseInt($('#rfa-decision-amount').text(), 10);
			var originalAmount = parseInt($('#record-initial-amount').val(), 10);

			if (currentAmount > originalAmount) {
				socket.send(JSON.stringify({ type: 'pop' }));
			}

			$('#final-bid-raise-amount').val(originalAmount);
			$('#final-bid-error').hide();
			showRecordScreen('final-bid');
		});

		// Review: Back (RFA goes to RFA Decision, UFA goes to Edit)
		$('#review-back').on('click', function() {
			if (recordRfaHolder) {
				showRecordScreen('rfa-decision');
			} else {
				populateEditScreen();
				showRecordScreen('edit');
			}
		});

		// Edit: Continue — routes based on situation pick
		$('#edit-continue').on('click', function() {
			var situation = $('#edit-situation').val();
			var winner = $('#edit-winner').val();
			var amount = parseInt($('#edit-amount').val(), 10);

			recordHighBidder = winner;
			recordInitialAmount = amount;

			if (situation === 'UFA') {
				recordRfaHolder = null;
				$('#record-rfa-holder').val('');
				showReviewScreen(winner, amount);
			} else {
				recordRfaHolder = situation.replace('RFA-', '');
				$('#record-rfa-holder').val(recordRfaHolder);
				populateFinalBid($('#record-player-name-hidden').val(), recordRfaHolder, winner, amount);
				showRecordScreen('final-bid');
			}
		});

		// Close dialog
		$('#record-close, #edit-cancel').on('click', function() {
			recordDialog.close();
		});

		// Review: Record
		$('#review-record').on('click', function() {
			var btn = $(this);
			btn.prop('disabled', true).text('Recording...');

			$.ajax({
				url: AUCTION_RECORD_URL,
				method: 'POST',
				contentType: 'application/json',
				data: JSON.stringify({
					playerId: $('#record-player-id').val() || null,
					playerName: $('#record-player-name-hidden').val(),
					winner: recordWinner,
					amount: recordAmount,
					type: recordAuctionType
				}),
				success: function(data) {
					resultRecorded = true;
					recordDialog.close();

					$('#record-result-btn')
						.removeClass('btn-success').addClass('btn-secondary')
						.prop('disabled', true)
						.html('<i class="fa fa-check"></i> Recorded: $' + data.amount + ' to ' + data.winner);
				},
				error: function(xhr) {
					var msg = 'Error recording result';
					try {
						var body = JSON.parse(xhr.responseText);
						if (body.error) msg = body.error;
					} catch (e) {}
					$('#record-status').html('<div class="text-danger mt-2">' + msg + '</div>');
					btn.prop('disabled', false).text('Record');
				}
			});
		});
	}
});

var addLoggedInAsClass = function(loggedInAsData) {
	if (loggedInAsData.loggedInAs) {
		var ownerIndex = owners.indexOf(loggedInAsData.loggedInAs);
		loggedInAs = loggedInAsData.loggedInAs;
	}
};

var redrawAuctionClient = function(auctionData, lag, isDemoMode) {
	lastAuctionData = auctionData;

	if (auctionData.status) {
		$('body')
			.removeClass('paused')
			.removeClass('active')
			.removeClass('roll-call')
			.removeClass('checked-in')
			.removeClass('owner-0')
			.removeClass('owner-1')
			.removeClass('owner-2')
			.removeClass('owner-3')
			.removeClass('owner-4')
			.removeClass('owner-5')
			.removeClass('owner-6')
			.removeClass('owner-7')
			.removeClass('owner-8')
			.removeClass('owner-9')
			.removeClass('owner-10')
			.removeClass('owner-11')
			.addClass(auctionData.status);

		if (auctionData.status == 'roll-call' && auctionData.rollCall.includes(loggedInAs)) {
			$('body').addClass('checked-in');
		}
	}

	// Determine whether to show Record button in the top bid row
	var showRecordButton = false;
	var justSettled = false;

	if (typeof AUCTION_RECORD_URL !== 'undefined') {
		var hasBids = auctionData.bids && auctionData.bids.length > 0;
		var isPaused = auctionData.status === 'paused';
		var hasPlayer = auctionData.player && auctionData.player.name && auctionData.player.name !== 'Tim Duncan';
		justSettled = isPaused && lastAuctionStatus === 'active';

		showRecordButton = isPaused && hasBids && hasPlayer && !resultRecorded && !isDemoMode;
	}

	lastAuctionStatus = auctionData.status;

	var pfrUrl;
	if (auctionData.player.pfrId) {
		pfrUrl = 'https://www.pro-football-reference.com/players/' + auctionData.player.pfrId.charAt(0) + '/' + auctionData.player.pfrId + '.htm';
	} else {
		var urlName = auctionData.player.name.toLowerCase().replace(' ', '+');
		pfrUrl = referenceSite + urlName;
	}

	if (auctionData.nominator.now != '--') {
		$('.nominating.next .who').text(auctionData.nominator.next);
		$('.nominating.later .who').text(auctionData.nominator.later);

		$('#nominator-name').text(auctionData.nominator.now);
		$('#nominator-text').text(pluralFranchises.includes(auctionData.nominator.now) ? 'nominate' : 'nominates');
	}

	$('#player-name a').attr('href', pfrUrl).text(auctionData.player.name);
	$('#player-position').text(auctionData.player.position);
	$('#player-team').text(auctionData.player.team);
	$('#player-situation').text(auctionData.player.situation);

	var bidHistory = $('<ul id="bid-history" class="list-group">');

	auctionData.bids.forEach((bid, i) => {
		var ownerIndex = owners.indexOf(bid.owner);
		var ownerClass = `owner-${ownerIndex}`;
		var ownerBidClass = `owner-${ownerIndex}-bid`;

		if (i == 0) {
			$('body').addClass(ownerClass);
		}

		var bidText = '<strong>$' + bid.amount + '</strong> to <strong>' + bid.owner + '</strong>';
		var li = $('<li class="list-group-item ' + ownerBidClass + '"><span>' + bidText + '</span></li>');

		if (i === 0 && typeof AUCTION_RECORD_URL !== 'undefined') {
			li.addClass('bid-history__top');
			if (showRecordButton) {
				li.append('<button id="record-result-btn" class="btn btn-primary btn-sm">Record</button>');
			} else if (resultRecorded) {
				li.append('<span class="badge badge-secondary"><i class="fa fa-check"></i> Recorded</span>');
			}
		}

		bidHistory.append(li);
	});

	$('#bid-history').replaceWith(bidHistory);

	if (justSettled && showRecordButton) {
		$('#record-result-btn').trigger('click');
	}

	$('#set-timer-guaranteed').val(auctionData.timer.guaranteed / 1000);
	$('#set-timer-reset-to').val(auctionData.timer.resetTo / 1000);

	resetTimer(auctionData.timer, lag);

	var attendance = $('<ul id="attendance" class="list-group col-12">');

	auctionData.rollCall.forEach(owner => {
		var ownerIndex = owners.indexOf(owner);
		var ownerClass = 'owner-' + ownerIndex + '-bid';
		var present = $('<li class="list-group-item ' + ownerClass + '"><strong>' + owner + '</strong></li>');

		attendance.append(present);
	});

	$('#attendance').replaceWith(attendance);
};

function connectToWebSocket() {
	var reconnectDialog = document.getElementById('reconnect-dialog') || $('dialog')[0];

	socket = new WebSocket(webSocketUrl + '/ws/auction');
	socket.onmessage = handleMessage;

	socket.onopen = function() {
		isReconnecting = false;
		reconnectAttempts = 0;

		if (reconnectTimeout) {
			clearTimeout(reconnectTimeout);
			reconnectTimeout = null;
		}

		reconnectDialog.close();
	}

	socket.onclose = function() {
		isReconnecting = false;

		reconnectDialog.showModal();

		var delay = Math.min(2000 * Math.pow(2, reconnectAttempts), 30000);
		reconnectAttempts++;

		reconnectTimeout = setTimeout(reconnectIfNeeded, delay);
	}

	socket.onerror = function() {
		isReconnecting = false;
	}
}

function reconnectIfNeeded() {
	if (!socket || isReconnecting) {
		return;
	}

	if (socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) {
		if (reconnectTimeout) {
			clearTimeout(reconnectTimeout);
			reconnectTimeout = null;
		}

		isReconnecting = true;
		connectToWebSocket();
	}
}

document.addEventListener('visibilitychange', function() {
	if (document.visibilityState === 'visible') {
		reconnectIfNeeded();
	}
});

window.addEventListener('focus', reconnectIfNeeded);

function handleMessageLaggy(rawMessage) {
	setTimeout(handleMessage.bind(null, rawMessage), 1000);
}

function handleMessage(rawMessage) {
	var parsed = JSON.parse(rawMessage.data);
	var type = parsed.type;
	var value = parsed.value;
	var sentAt = parsed.sentAt;

	if (type == 'auth') {
		addLoggedInAsClass(value);
	}
	else if (type == 'auctionData') {
		redrawAuctionClient(value, Date.now() - sentAt, parsed.demoMode);
	}
}

function resetTimer(timer, lag) {
	requestAnimationFrame(updateTimerDuration.bind(null, timer, lag));
}

function updateTimerDuration(timer, lag) {
	var root = document.querySelector(':root');

	var guaranteed = timer.guaranteed;
	var remaining = timer.endingAt - Date.now() + lag;
	var percentage = Math.min(1, (guaranteed - remaining) / guaranteed) * 100;

	root.style.setProperty('--duration', `${percentage}%`);

	var remainingWholeSeconds = Math.ceil((Math.max(remaining, 0)) / 1000);

	$('#clock').text(`:${remainingWholeSeconds.toString().padStart(2, '0')}`);

	if (remaining > 0) {
		requestAnimationFrame(updateTimerDuration.bind(null, timer, lag));
	}
}
