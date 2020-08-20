$(document).ready(function() {
	$('#activate').bind('click', function(e) {
		e.preventDefault();
		$.get('/auction/activate', null, redrawAuctionClient);
	});

	$('#bid-form').bind('submit', function(e) {
		e.preventDefault();
		$.post('/auction/bid', { amount: $(this).find('#bid-amount').val() }, redrawAuctionClient);
	});

	$('#pause').bind('click', function(e) {
		e.preventDefault();
		$.get('/auction/pause', null, redrawAuctionClient);
	});

	$('#nomination-form').bind('submit', function(e) {
		var newPlayer = { name: $(this).find('#name').val(), position: $(this).find('#position').val(), team: $(this).find('#team').val() };

		console.log(newPlayer);

		e.preventDefault();
		$.post('/auction/nominate', newPlayer, redrawAuctionClient);
	});

	$('#pop').bind('click', function(e) {
		e.preventDefault();
		$.get('/auction/pop', null, redrawAuctionClient);
	});

	setInterval(fetchCurrentAuctionData, 3000);
});

var fetchCurrentAuctionData = function() {
	$.get('/auction/current', null, redrawAuctionClient);
};

var redrawAuctionClient = function(auctionData) {
	var player = $('<div id="player" class="col-12"><h1 id="player-name"></h1><h4 id="player-position"></h4><h4 id="player-team"></h4></div>');

	player.find('#player-name').text(auctionData.player.name);
	player.find('#player-position').text(auctionData.player.position);
	player.find('#player-team').text(auctionData.player.team);

	$('#player').replaceWith(player);

	var bidHistory = $('<ul id="bid-history" class="list-group col-12">');

	auctionData.bids.forEach(bid => {
		var bid = $('<li class="list-group-item"><strong>$' + bid.amount + '</strong> to <strong>' + bid.owner + '</strong></li>');
		bidHistory.append(bid);
	});

	$('#bid-history').replaceWith(bidHistory);
};
