var state = 'new-player';
var loggedInAs;

var pluralFranchises = ['Koci/Mueller', 'Schexes'];

var socket;
var socketHeartbeatInterval;

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

		socket.send(JSON.stringify({
			type: 'pause'
		}));
	});

	$('body.admin .nominating .who').bind('click', function(e) {
		$('#nominator').val($(this).text());
		$('#player-list').val('');
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

		e.preventDefault();

		socket.send(JSON.stringify({
			type: 'nominate',
			value: newPlayer
		}));
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
});

var addLoggedInAsClass = function(loggedInAsData) {
	if (loggedInAsData.loggedInAs) {
		var ownerIndex = owners.indexOf(loggedInAsData.loggedInAs);
		loggedInAs = loggedInAsData.loggedInAs;
	}
};

var redrawAuctionClient = function(auctionData, lag) {
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
	var dialog = $('dialog')[0];

	socket = new WebSocket(webSocketUrl);
	socket.onmessage = handleMessage;

	socket.onopen = function() {
		socketHeartbeatInterval = setInterval(function() {
			socket.send(JSON.stringify({
				type: 'heartbeat'
			}));
		}, 5000);

		dialog.close();
	}

	socket.onclose = function() {
		clearInterval(socketHeartbeatInterval);

		dialog.showModal();
	}
}

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
