var request = require('superagent');

var players = require('../public/data/merged.json');

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
	.get('https://api.sleeper.app/v1/league/817129464579350528/matchups/1')
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

		Object.keys(positionCount).forEach((position) => {
			let positionPlayers = players.filter((player) => player.owner && player.owner != '' && player.positions.includes(position));

			positionPlayers.sort((a, b) => b.salary - a.salary);

			let replacementLevel = positionPlayers.slice(positionCount[position] - 6 - 1, positionCount[position] + 6);

			console.log(position, positionPlayers.length, positionPlayers[0].name);
			console.log(Math.ceil(replacementLevel.reduce((previous, current) => {
				return previous + current.salary
			}, 0) / replacementLevel.length));
		});
	});
