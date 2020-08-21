var numberOfBids = 0;
var timer = -1;

$(document).ready(function() {
	$('#activate').bind('click', function(e) {
		e.preventDefault();
		$.get('/auction/activate', null, redrawAuctionClient);
	});

	$('#bid-form').bind('submit', function(e) {
		var newBid = { amount: $(this).find('#bid-amount').val() };

		if ($(this).find('#force-bid')) {
			console.log('forcing');
			newBid.force = true;
			newBid.owner = $(this).find('#owner').val();
		}

		e.preventDefault();
		$.post('/auction/bid', newBid, redrawAuctionClient);

		$(this).find('#bid-amount').val(null).focus();
	});

	$('#pause').bind('click', function(e) {
		e.preventDefault();
		$.get('/auction/pause', null, redrawAuctionClient);
	});

	$('#nomination-form').bind('submit', function(e) {
		var newPlayer = { name: $(this).find('#name').val(), position: $(this).find('#position').val(), team: $(this).find('#team').val(), situation: $(this).find('#situation').val() };

		e.preventDefault();
		$.post('/auction/nominate', newPlayer, redrawAuctionClient);
	});

	$('#pop').bind('click', function(e) {
		e.preventDefault();
		$.get('/auction/pop', null, redrawAuctionClient);
	});

	setInterval(fetchCurrentAuctionData, 3000);
	setInterval(updateTimer, 1000);
});

var fetchCurrentAuctionData = function() {
	$.get('/auction/current', null, redrawAuctionClient);
};

var redrawAuctionClient = function(auctionData) {
	if (auctionData.status) {
		$('body').removeClass('paused').removeClass('active').addClass(auctionData.status);
	}

	var player = $('<div id="player" class="col-12"><h1 id="player-name"><a href="" target="_blank"></a></h1><h4 id="player-position"></h4><h4 id="player-team"></h4><h4 id="player-situation"></h4></div>');

	var urlName = auctionData.player.name.toLowerCase().replace(' ', '+');

	player.find('#player-name a').attr('href', 'https://www.pro-football-reference.com/search/search.fcgi?search=' + urlName).text(auctionData.player.name);
	player.find('#player-position').text(auctionData.player.position);
	player.find('#player-team').text(auctionData.player.team);
	player.find('#player-situation').text(auctionData.player.situation);

	$('#player').replaceWith(player);

	var bidHistory = $('<ul id="bid-history" class="list-group col-12">');

	auctionData.bids.forEach(bid => {
		var bid = $('<li class="list-group-item"><strong>$' + bid.amount + '</strong> to <strong>' + bid.owner + '</strong></li>');
		bidHistory.append(bid);
	});

	$('#bid-history').replaceWith(bidHistory);

	if (auctionData.bids.length != numberOfBids) {
		numberOfBids = auctionData.bids.length;
		timer = -1;
	}
};

var updateTimer = function() {
	timer++;
	$('#timer').text(timer);
};
