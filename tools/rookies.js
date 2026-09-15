var dotenv = require('dotenv').config({ path: '/app/.env' });

var request = require('superagent');

var players = require('../public/data/players.json');

var PSO = require('../config/pso.js');

var season = PSO.season;
var targetSeason = season + 1;
var sleeperLeagueId = PSO.sleeperLeagueIds[season];

var POSITION_ORDER = ['DB', 'DL', 'K', 'LB', 'QB', 'RB', 'TE', 'WR'];

var positionCount = {
	QB: 0,
	RB: 0,
	WR: 0,
	TE: 0,
	DL: 0,
	LB: 0,
	DB: 0,
	K: 0
};

request
	.get(`https://api.sleeper.app/v1/league/${sleeperLeagueId}/matchups/1`)
	.then((response) => {
		var teams = response.body;

		teams.forEach((team) => {
			team.starters.forEach((playerId) => {
				var starter = players.find((player) => player.id == playerId);
				if (!starter) {
					console.log(playerId);
				}
				else {
					starter.positions.forEach((position) => {
						positionCount[position]++;
					});
				}
			});
		});

		console.log(positionCount);

		var salaries = {};

		POSITION_ORDER.forEach((position) => {
			// Only include players with active contracts (not RFA rights)
			let positionPlayers = players.filter((player) => player.owner && player.salary && player.positions.includes(position));

			positionPlayers.sort((a, b) => b.salary - a.salary);

			let replacementLevel = positionPlayers.slice(positionCount[position] - 6 - 1, positionCount[position] + 6);

			var salary = Math.ceil(replacementLevel.reduce((previous, current) => {
				return previous + current.salary
			}, 0) / replacementLevel.length);

			salaries[position] = salary;

			console.log(position, positionPlayers.length, positionPlayers[0].name);
			console.log(salary);
		});

		var blob = "'" + targetSeason + "': { " + POSITION_ORDER.map(function(position) {
			return "'" + position + "': " + salaries[position];
		}).join(', ') + ' },';

		console.log('');
		console.log(blob);
	});
