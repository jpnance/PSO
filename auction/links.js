const dotenv = require('dotenv').config({ path: __dirname + '/../.env' });

const auctionKeys = {};
const auctionUsers = JSON.parse(process.env.AUCTION_USERS);
const owners = JSON.parse(process.env.NOMINATION_ORDER);

Object.keys(auctionUsers).forEach((key) => {
	auctionKeys[auctionUsers[key]] = key;
});

owners.sort().forEach((owner) => {
	console.log(owner + ': https://thedynastyleague.com/auction/login/' + auctionKeys[owner]);
});
