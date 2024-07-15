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

module.exports.activateAuction = function() {
	auction.status = 'active';
	broadcastAuctionData();
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

module.exports.makeBid = function(bid) {
	if (bid.force && bid.owner && bid.amount) {
		auction.bids.unshift({
			owner: bid.owner,
			amount: parseInt(bid.amount)
		});

		broadcastAuctionData();
		return;
	}

	var owner = bid.owner;

	if (auction.status != 'active') {
		return;
	}

	if (!owner || !nominationOrder.includes(owner)) {
		return;
	}

	if (auction.bids && auction.bids[0] && owner == auction.bids[0].owner) {
		return;
	}

	if (auction.player.situation.startsWith('RFA-') && auction.player.situation.includes(owner)) {
		return;
	}

	var newBid = {
		owner: owner,
		amount: parseInt(bid.amount)
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
			broadcastAuctionData();
		}
	}
};

module.exports.nominatePlayer = function(player) {
	auction.status = 'paused';

	auction.nominator.now = player.nominator;
	auction.nominator.next = nominationOrder[(nominationOrder.indexOf(auction.nominator.now) + 1) % nominationOrder.length];
	auction.nominator.later = nominationOrder[(nominationOrder.indexOf(auction.nominator.now) + 2) % nominationOrder.length];

	auction.player.name = player.name;
	auction.player.position = player.position;
	auction.player.team = player.team;
	auction.player.situation = player.situation;

	auction.bids = [];

	broadcastAuctionData();
};

module.exports.pauseAuction = function() {
	auction.status = 'paused';
	broadcastAuctionData();
};

module.exports.popBid = function() {
	auction.bids.shift();
	broadcastAuctionData();
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

var sockets = [];

module.exports.handleConnection = function(socket, request) {
	var authKey = extractAuthKeyFromCookie(request.headers.cookie);

	sockets.push(socket);

	if (owners[authKey]) {
		socket.owner = owners[authKey];

		socket.send(JSON.stringify({
			type: 'auth',
			value: {
				loggedInAs: owners[authKey]
			}
		}));
	}

	broadcastAuctionData();

	socket.on('message', handleMessage.bind(null, socket));
};

function handleMessage(socket, rawMessage) {
	var { type, value } = JSON.parse(rawMessage.toString());

	if (type == 'activate') {
		module.exports.activateAuction();
	}
	else if (type == 'makeBid') {
		module.exports.makeBid({
			owner: socket.owner,
			...value
		});
	}
	else if (type == 'nominate') {
		module.exports.nominatePlayer(value);
	}
	else if (type == 'pause') {
		module.exports.pauseAuction();
	}
	else if (type == 'pop') {
		module.exports.popBid();
	}
}

setInterval(function() {
	sockets.forEach(function(socket) {
		socket.send(JSON.stringify({
			type: 'ping',
			value: 'just saying hi'
		}));
	});
}, 10000);

function extractAuthKeyFromCookie(rawCookie) {
	var pairs = rawCookie.split(';');
	var authKey;

	pairs
		.map(function(pair) {
			return pair.split('=');
		})
		.forEach(function(pairArray) {
			if (pairArray[0] == 'auctionAuthKey') {
				authKey = pairArray[1];
			}
		});

	return authKey;
}

function broadcastAuctionData() {
	sockets.forEach(function(socket) {
		socket.send(JSON.stringify({
			type: 'auctionData',
			value: auction
		}));
	});
}
