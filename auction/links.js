const dotenv = require('dotenv').config({ path: '/app/.env' });
const PSO = require('../config/pso');

const auctionKeys = {};
const auctionUsers = PSO.auctionUsers;
const owners = PSO.nominationOrder;

Object.keys(auctionUsers).forEach((key) => {
	auctionKeys[auctionUsers[key]] = key;
});

owners.sort().forEach((owner) => {
	console.log(owner + ': https://thedynastyleague.com/auction/login/' + auctionKeys[owner]);
});
