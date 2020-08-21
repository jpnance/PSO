var dotenv = require('dotenv').config({ path: '../.env' });

var auction = {
	player: {
		name: 'Malcolm Brown',
		position: 'RB',
		team: 'LAR'
	},
	bids: [],
	status: 'active'
};

module.exports.activateAuction = function(request, response) {
	auction.status = 'active';
	response.redirect('/auction');
};

module.exports.authenticateOwner = function(request, response) {
	var owners = JSON.parse(process.env.AUCTION_USERS);

	if (owners[request.params.key]) {
		response.cookie('auctionAuthKey', request.params.key, { expires: new Date('2020-09-01') });
	}

	if (request.cookies && request.cookies.auctionAuthKey) {
		console.log(request.cookies.auctionAuthKey);
	}

	response.send({});
};

module.exports.currentAuction = function(request, response) {
	response.send(auction);
};

module.exports.makeBid = function(request, response) {
	if (auction.status != 'active') {
		response.send(auction);
		return;
	}

	var newBid = {
		owner: (Math.random() > 0.5 ? 'Patrick' : 'Mitch'),
		amount: parseInt(request.body.amount)
	};

	if (newBid.amount) {
		var highBid = true;

		auction.bids.forEach(existingBid => {
			if (existingBid.amount >= newBid.amount) {
				highBid = false;
			}
		});

		if (highBid) {
			auction.bids.unshift(newBid);
		}
	}

	response.send(auction);
};

module.exports.nominatePlayer = function(request, response) {
	auction.status = 'paused';

	auction.player.name = request.body.name;
	auction.player.position = request.body.position;
	auction.player.team = request.body.team;

	auction.bids = [];

	response.send(auction);
};

module.exports.pauseAuction = function(request, response) {
	auction.status = 'paused';
	response.redirect('/auction');
};

module.exports.popBid = function(request, response) {
	auction.bids.shift();
	response.redirect('/auction');
};
