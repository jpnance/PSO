var dotenv = require('dotenv').config({ path: '/app/.env' });
var fs = require('fs');
var PSO = require('../config/pso');

var request = require('superagent');

var nominators = PSO.nominationOrder;
var players = JSON.parse(fs.readFileSync('./demo.json', 'utf8'));

setInterval(function() {
	var player = players[Math.floor(Math.random() * players.length)];

	request
		.post('http://' + process.env.PSO_WEB_CONTAINER_NAME + ':' + process.env.PORT + '/auction/nominate')
		.send({ name: player.name, nominator: nominators[Math.floor(Math.random() * nominators.length)], position: player.position, situation: player.situation, status: 'active' })
		.catch(function(error) {
			console.log(error);
			process.exit();
		});
}, 20000);
