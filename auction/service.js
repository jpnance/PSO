var dotenv = require('dotenv').config({ path: '/app/.env' });

var auction = {
	nominator: {
		now: '--',
		next: '--',
		later: '--'
	},

	player: {
		name: 'Tim Duncan',
		position: 'PF/C',
		team: 'SAS',
		situation: 'UFA'
	},
	bids: [],
	status: 'active',
	rollCall: []
};

var owners = JSON.parse(process.env.AUCTION_USERS);
var nominationOrder = JSON.parse(process.env.NOMINATION_ORDER);

module.exports.activateAuction = function(request, response) {
	auction.status = 'active';
	response.send(auction);
};

module.exports.authenticateOwner = function(request, response) {
	if (owners[request.params.key]) {
		response.cookie('auctionAuthKey', request.params.key, { expires: new Date('2025-01-01') });
	}

	response.redirect('/auction');
};

module.exports.callRoll = function(request, response) {
	auction.status = 'roll-call';
	auction.rollCall = [];

	response.send(auction);
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

	if (!owner || !nominationOrder.includes(owner)) {
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

	if (newBid.amount > 0) {
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
	if (request.body.status) {
		auction.status = request.body.status;
	}
	else {
		auction.status = 'paused';
	}

	auction.nominator.now = request.body.nominator;
	auction.nominator.next = nominationOrder[(nominationOrder.indexOf(auction.nominator.now) + 1) % nominationOrder.length];
	auction.nominator.later = nominationOrder[(nominationOrder.indexOf(auction.nominator.now) + 2) % nominationOrder.length];

	auction.player.name = request.body.name;
	auction.player.position = request.body.position;
	auction.player.team = request.body.team;
	auction.player.situation = request.body.situation;

	auction.bids = [];

	response.send(auction);
};

module.exports.pauseAuction = function(request, response) {
	if (request.query.bidCount && request.query.bidCount == auction.bids.length) {
		auction.status = 'paused';
	}

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

module.exports.resetNominationOrder = function(request, response) {
	nominationOrder = JSON.parse(process.env.NOMINATION_ORDER);

	response.send(auction);
};

module.exports.removeFromNominationOrder = function(request, response) {
	var ownerIndex = nominationOrder.indexOf(request.body.owner);

	if (ownerIndex != -1) {
		nominationOrder.splice(ownerIndex, 1);
	}

	if (auction.nominator.now == request.body.owner) {
		auction.nominator.now = nominationOrder[ownerIndex % nominationOrder.length];
	}

	auction.nominator.next = nominationOrder[(nominationOrder.indexOf(auction.nominator.now) + 1) % nominationOrder.length];
	auction.nominator.later = nominationOrder[(nominationOrder.indexOf(auction.nominator.now) + 2) % nominationOrder.length];

	response.send(auction);
};

module.exports.rollCall = function(request, response) {
	if (request.cookies && request.cookies.auctionAuthKey && owners[request.cookies.auctionAuthKey]) {
		var owner = owners[request.cookies.auctionAuthKey];

		if (!auction.rollCall.includes(owner)) {
			auction.rollCall.push(owner);
			auction.rollCall.sort();
		}
	}

	response.send(auction);
};
