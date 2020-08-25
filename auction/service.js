var dotenv = require('dotenv').config({ path: '../.env' });

var auction = {
	player: {
		name: 'Malcolm Brown',
		position: 'RB',
		team: 'LAR',
		situation: 'UFA'
	},
	bids: [],
	status: 'active'
};

var owners = JSON.parse(process.env.AUCTION_USERS);

module.exports.activateAuction = function(request, response) {
	auction.status = 'active';
	response.send(auction);
};

module.exports.authenticateOwner = function(request, response) {
	if (owners[request.params.key]) {
		response.cookie('auctionAuthKey', request.params.key, { expires: new Date('2020-09-01') });
	}

	response.redirect('/auction');
};

module.exports.currentAuction = function(request, response) {
	response.send(auction);
};

module.exports.makeBid = function(request, response) {
	if (request.body.force && request.body.owner && request.body.amount) {
		auction.bids.unshift({ owner: request.body.owner, amount: parseInt(request.body.amount) });
		response.send(auction);
		return;
	}

	var owner = null;

	if (auction.status != 'active') {
		response.send(auction);
		return;
	}

	if (request.body.owner) {
		owner = request.body.owner;
	}
	else if (request.cookies && request.cookies.auctionAuthKey && owners[request.cookies.auctionAuthKey]) {
		owner = owners[request.cookies.auctionAuthKey];
	}

	if (!owner) {
		response.send(auction);
		return;
	}

	if (auction.bids && auction.bids[0] && owner == auction.bids[0].owner) {
		response.send(auction);
		return;
	}

	if (auction.player.situation.startsWith('RFA-') && auction.player.situation.includes(owner)) {
		response.send(auction);
		return;
	}

	var newBid = {
		owner: owner,
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
	auction.player.situation = request.body.situation;

	auction.bids = [];

	response.send(auction);
};

module.exports.pauseAuction = function(request, response) {
	auction.status = 'paused';
	response.send(auction);
};

module.exports.popBid = function(request, response) {
	auction.bids.shift();
	response.send(auction);
};

module.exports.quickAuth = function(request, response) {
	if (request.cookies && request.cookies.auctionAuthKey && owners[request.cookies.auctionAuthKey]) {
		response.send({ loggedInAs: owners[request.cookies.auctionAuthKey] });
	}
};
