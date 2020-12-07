var dotenv = require('dotenv').config({ path: '../.env' });

var random = {
	names: [
		'C.J. Spiller',
		'Akiem Hicks',
		'Mike Gillislee',
		'Brian Poole',
		'Victor Cruz',
		'Bennie Fowler III',
		'Roger Lewis',
		'Ronnie Hillman',
		'Doug Baldwin',
		'Kurt Coleman',
		'Josh Malone',
		'Nick O\'Leary',
		'Boston Scott',
		'Tom Savage',
		'Malik Jefferson',
		'Trumaine Johnson',
		'Braxton Berrios',
		'Johnathan Cyprien',
		'Eli Harold',
		'Sebastian Janikowski',
		'Malik Hooker',
		'Devin McCourty',
		'Mike Mitchell',
		'Fletcher Cox',
		'DeShawn Shead',
		'DeMarco Murray',
		'Pierre Garcon',
		'Brandon Marshall (SEA)',
		'Jahleel Addae',
		'Michael Floyd',
		'Karl Joseph',
		'Rod Smith',
		'DeAndre Levy',
		'Adam Shaheen',
		'Chris Warren',
		'Eddie Lacy',
		'Drew Stanton',
		'Jason McCourty',
		'Julius Peppers',
		'Keelan Cole',
		'Byron Marshall',
		'Jatavis Brown',
		'Rob Kelley',
		'Andrew Sendejo',
		'Linval Joseph',
		'Stephen Anderson',
		'Connor Cook',
		'Denzel Perryman',
		'Marcus Murphy',
		'Marquess Wilson',
		'Sam Bradford',
		'Josh Bynes',
		'Richard Rodgers',
		'Thomas Rawls',
		'Ladarius Green',
		'Paul Perkins',
		'Malcolm Jenkins',
		'Sean Davis',
		'Braxton Miller',
		'Jace Amaro',
		'Trent Taylor',
		'Dan Carpenter',
		'Javorius Allen',
		'Andre Williams',
		'A.J. Klein',
		'Kai Forbath',
		'Dwayne Allen',
		'Chad Hansen',
		'Maxx Williams'
	],
	positions: [ 'QB', 'RB', 'RB/WR', 'WR', 'TE', 'DL', 'DL/LB', 'LB', 'DB', 'K' ],
	teams: [
		'ARI',
		'ATL',
		'BAL',
		'BUF',
		'CAR',
		'CHI',
		'CIN',
		'CLE',
		'DAL',
		'DEN',
		'DET',
		'FA',
		'GB',
		'HOU',
		'IND',
		'JAX',
		'KC',
		'LAC',
		'LAR',
		'LV',
		'MIA',
		'MIN',
		'NE',
		'NO',
		'NYG',
		'NYJ',
		'PHI',
		'PIT',
		'SEA',
		'SF',
		'TB',
		'TEN',
		'WAS'
	],
	situations: [ 'UFA', 'RFA-Brett/Luke', 'RFA-James/Charles', 'RFA-John/Zach', 'RFA-Keyon', 'RFA-Koci/Mueller', 'RFA-Mitch', 'RFA-Patrick', 'RFA-Quinn', 'RFA-Schex', 'RFA-Syed/Kuan', 'RFA-Terence', 'RFA-Trevor' ]
};

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
		response.cookie('auctionAuthKey', request.params.key, { expires: new Date('2020-09-01') });
	}

	response.redirect('/auction');
};

module.exports.callRoll = function(request, response) {
	auction.status = 'roll-call';
	auction.rollCall = [];

	response.send(auction);
};

module.exports.currentAuction = function(request, response) {
	if (false && Math.random() < 0.005) {
		auction.player.name = random.names[Math.floor(Math.random() * random.names.length)];
		auction.player.position = random.positions[Math.floor(Math.random() * random.positions.length)];
		auction.player.team = random.teams[Math.floor(Math.random() * random.teams.length)];
		auction.player.situation = random.situations[Math.floor(Math.random() * random.situations.length)];

		auction.bids = [];
	}

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
