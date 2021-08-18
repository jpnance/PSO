var dotenv = require('dotenv').config({ path: '../.env' });
var fs = require('fs');

var request = require('superagent');

var nominators = [
	'Brett',
	'James/Charles',
	'Jason',
	'John/Zach',
	'Keyon',
	'Koci/Mueller',
	'Luke',
	'Mitch',
	'Patrick',
	'Quinn',
	'Schex',
	'Trevor'
];

var players = JSON.parse(fs.readFileSync('./demo.json', 'utf8'));

setInterval(function() {
	var player = players[Math.floor(Math.random() * players.length)];

	request
		.post('http://localhost:9528/auction/nominate')
		.send({ name: player.name, nominator: nominators[Math.floor(Math.random() * nominators.length)], position: player.position, situation: player.situation, status: 'active' })
		.catch(function(error) {
			console.log(error);
			process.exit();
		});
}, 20000);
