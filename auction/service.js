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
	rollCall: [],
	timer: {
		startedAt: null,
		guaranteed: 30000,
		resetTo: 10000,
		endingAt: null
	}
};

var owners = JSON.parse(process.env.AUCTION_USERS);
var nominationOrder = JSON.parse(process.env.NOMINATION_ORDER);

var sockets = [];

var auctionOverTimeout;

function activateAuction() {
	auction.status = 'active';

	clearTimeout(auctionOverTimeout);

	auction.timer.startedAt = Date.now();
	auction.timer.guaranteed = 30000;
	auction.timer.resetTo = 10000;
	auction.timer.endingAt = auction.timer.startedAt + auction.timer.guaranteed;

	auctionOverTimeout = setTimeout(pauseAuction, auction.timer.endingAt - auction.timer.startedAt);

	broadcastAuctionData();
};

module.exports.authenticateOwner = function(request, response) {
	if (owners[request.params.key]) {
		response.cookie('auctionAuthKey', request.params.key, { expires: new Date('2025-01-01') });
	}

	response.redirect('/auction');
};

function callRoll() {
	auction.status = 'roll-call';
	auction.rollCall = [];

	broadcastAuctionData();
};

function makeBid(bid) {
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

			if (auction.timer.endingAt - Date.now() < auction.timer.resetTo) {
				clearTimeout(auctionOverTimeout);

				auction.timer.endingAt = Date.now() + auction.timer.resetTo;

				auctionOverTimeout = setTimeout(pauseAuction, auction.timer.endingAt - Date.now());
			}

			broadcastAuctionData();
		}
	}
};

function nominatePlayer(player) {
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

function pauseAuction() {
	auction.status = 'paused';
	broadcastAuctionData();
};

function popBid() {
	auction.bids.shift();
	broadcastAuctionData();
};

module.exports.resetNominationOrder = function(request, response) {
	nominationOrder = JSON.parse(process.env.NOMINATION_ORDER);

	response.send(auction);
};

function removeFromNominationOrder(removeOwnerData) {
	var ownerIndex = nominationOrder.indexOf(removeOwnerData.owner);

	if (ownerIndex != -1) {
		nominationOrder.splice(ownerIndex, 1);
	}

	if (auction.nominator.now == removeOwnerData.owner) {
		auction.nominator.now = nominationOrder[ownerIndex % nominationOrder.length];
	}

	auction.nominator.next = nominationOrder[(nominationOrder.indexOf(auction.nominator.now) + 1) % nominationOrder.length];
	auction.nominator.later = nominationOrder[(nominationOrder.indexOf(auction.nominator.now) + 2) % nominationOrder.length];

	broadcastAuctionData();
};

function rollCall(rollCallData) {
	if (rollCallData.owner) {
		if (!auction.rollCall.includes(rollCallData.owner)) {
			auction.rollCall.push(rollCallData.owner);
			auction.rollCall.sort();
		}
	}

	broadcastAuctionData();
};

module.exports.handleConnection = function(socket, request) {
	var authKey = extractAuthKeyFromCookie(request.headers.cookie);

	socket.heartbeat = true;

	if (owners[authKey]) {
		socket.owner = owners[authKey];

		socket.send(JSON.stringify({
			type: 'auth',
			value: {
				loggedInAs: owners[authKey]
			}
		}));
	}

	sockets.push(socket);

	broadcastAuctionData();

	socket.on('message', handleMessage.bind(null, socket));
};

function handleMessage(socket, rawMessage) {
	var { type, value } = JSON.parse(rawMessage.toString());

	if (type == 'activate') {
		activateAuction();
	}
	else if (type == 'callRoll') {
		callRoll();
	}
	else if (type == 'heartbeat') {
		heartbeat(socket);
	}
	else if (type == 'makeBid') {
		makeBid({
			owner: socket.owner,
			...value
		});
	}
	else if (type == 'nominate') {
		nominatePlayer(value);
	}
	else if (type == 'pause') {
		pauseAuction();
	}
	else if (type == 'pop') {
		popBid();
	}
	else if (type == 'removeOwner') {
		removeFromNominationOrder(value);
	}
	else if (type == 'rollCall') {
		rollCall({
			owner: socket.owner
		});
	}
}

setInterval(function() {
	console.log(`${sockets.length} sockets`);

	sockets.forEach(function(socket) {
		if (!socket.heartbeat) {
			console.log('terminating socket');
			socket.terminate();
		}
	});

	sockets = sockets.filter(function(socket) {
		return socket.heartbeat;
	});

	sockets.forEach(function(socket) {
		socket.heartbeat = false;
	});
}, 10000);

function extractAuthKeyFromCookie(rawCookie = '') {
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
			value: auction,
			sentAt: Date.now()
		}));
	});
}

function heartbeat(socket) {
	socket.heartbeat = true;
}
