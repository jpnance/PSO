const dotenv = require('dotenv').config({ path: __dirname + '/../.env' });

const auctionKeys = JSON.parse(process.env.AUCTION_USERS);

Object.keys(auctionKeys).forEach((key) => {
	console.log(auctionKeys[key] + ': https://thedynastyleague.com/auction/login/' + key);
});
