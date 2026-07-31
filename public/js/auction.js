var state = 'new-player';
var loggedInAs;
var lastAuctionData = null;
var resultRecorded = false;

var pluralFranchises = ['Koci/Mueller', 'Schexes'];

var socket;
var socketHeartbeatInterval;
var isReconnecting = false;

var bidButtonTimeout;

$(document).ready(function() {
	connectToWebSocket();

	$('#reconnect').bind('click', function(e) {
		e.preventDefault();

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

		e.preventDefault();

		socket.send(JSON.stringify({
			type: 'nominate',
			value: newPlayer
		}));

		resultRecorded = false;
		$(this).find('#player-id').val('');
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

		socket.send(JSON.stringify({
			type: 'removeOwner',
			value: {
				owner: $(this).find('#remove-owner').val()
			}
		}));
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

		$('#record-result-btn').on('click', function() {
			if (!lastAuctionData || !lastAuctionData.bids || lastAuctionData.bids.length === 0) return;

			var winningBid = lastAuctionData.bids[0];
			var situation = lastAuctionData.player.situation || 'UFA';

			$('#record-player-name').val(lastAuctionData.player.name);
			$('#record-player-id').val(lastAuctionData.player.playerId || '');
			$('#record-winner').val(winningBid.owner);
			$('#record-amount').val(winningBid.amount);

			var auctionType = 'auction-ufa';
			if (situation.startsWith('RFA-')) {
				var rfaHolder = situation.replace('RFA-', '');
				if (rfaHolder === winningBid.owner) {
					auctionType = 'auction-rfa-matched';
				} else {
					auctionType = 'auction-rfa-unmatched';
				}
			}
			$('#record-type').val(auctionType);

			$('#record-status').empty();
			$('#record-confirm').prop('disabled', false).html('<i class="fa fa-check"></i> Record');
			recordDialog.showModal();
		});

		$('#record-cancel').on('click', function() {
			recordDialog.close();
		});

		$('#record-confirm').on('click', function() {
			var btn = $(this);
			btn.prop('disabled', true).text('Recording...');

			$.ajax({
				url: AUCTION_RECORD_URL,
				method: 'POST',
				contentType: 'application/json',
				data: JSON.stringify({
					playerId: $('#record-player-id').val() || null,
					playerName: $('#record-player-name').val(),
					winner: $('#record-winner').val(),
					amount: $('#record-amount').val(),
					type: $('#record-type').val()
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
					btn.prop('disabled', false).html('<i class="fa fa-check"></i> Record');
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

var redrawAuctionClient = function(auctionData, lag) {
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

	// Show Record Result button when paused with a winning bid (dynamic admin only)
	if (typeof AUCTION_RECORD_URL !== 'undefined') {
		var hasBids = auctionData.bids && auctionData.bids.length > 0;
		var isPaused = auctionData.status === 'paused';
		var hasPlayer = auctionData.player && auctionData.player.name && auctionData.player.name !== 'Tim Duncan';

		if (isPaused && hasBids && hasPlayer && !resultRecorded) {
			$('#record-result-container').show();
			$('#record-result-btn')
				.removeClass('btn-secondary').addClass('btn-success')
				.prop('disabled', false)
				.html('<i class="fa fa-database"></i> Record Result');
		} else if (resultRecorded && isPaused && hasBids && hasPlayer) {
			$('#record-result-container').show();
		} else {
			$('#record-result-container').hide();
		}
	}

	var urlName = auctionData.player.name.toLowerCase().replace(' ', '+');

	if (auctionData.nominator.now != '--') {
		$('.nominating.next .who').text(auctionData.nominator.next);
		$('.nominating.later .who').text(auctionData.nominator.later);

		$('#nominator-name').text(auctionData.nominator.now);
		$('#nominator-text').text(pluralFranchises.includes(auctionData.nominator.now) ? 'nominate' : 'nominates');
	}

	$('#player-name a').attr('href', referenceSite + urlName).text(auctionData.player.name);
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

		var bid = $('<li class="list-group-item ' + ownerBidClass + '"><strong>$' + bid.amount + '</strong> to <strong>' + bid.owner + '</strong></li>');

		bidHistory.append(bid);
	});

	$('#bid-history').replaceWith(bidHistory);

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

		socketHeartbeatInterval = setInterval(function() {
			socket.send(JSON.stringify({
				type: 'heartbeat'
			}));
		}, 5000);

		reconnectDialog.close();
	}

	socket.onclose = function() {
		isReconnecting = false;

		clearInterval(socketHeartbeatInterval);

		reconnectDialog.showModal();
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
	var { type, value, sentAt } = JSON.parse(rawMessage.data);

	if (type == 'auth') {
		addLoggedInAsClass(value);
	}
	else if (type == 'auctionData') {
		redrawAuctionClient(value, Date.now() - sentAt);
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
