var dotenv = require('dotenv').config({ path: '../.env' });

var fs = require('fs');
var request = require('superagent');

var PSO = require('../pso.js');

var render = false;

process.argv.forEach((value, index, array) => {
	if (index > 1) {
		var pair = value.split(/=/);

		switch (pair[0]) {
			case 'render':
				render = true;
				break;
		}
	}
});

var newPicksPromise = () => {
	return new Promise((resolve, reject) => {
		var picks = [];

		request
			.get('http://localhost:' + process.env.PORT + '/data/picks.json')
			.then((response) => {
				response.body.forEach((pick) => {
					picks.push({
						season: pick.season,
						number: pick.number,
						round: pick.round,
						owner: pick.owner,
						origin: pick.origin || 'From ' + pick.owner
					});
				});

				resolve(picks);
			})
	});
};

var newPlayersPromise = () => {
	return new Promise((resolve, reject) => {
		var players = [];

		request
			.get('http://localhost:' + process.env.PORT + '/data/players.json')
			.then((response) => {
				response.body.forEach((player) => {
					if (!player.owner || player.owner == '') {
						return;
					}

					if (!player.end) {
						player.terms = 'unsigned';
					}
					else if (new Date().getFullYear() != process.env.SEASON && player.end == process.env.SEASON) {
						player.terms = 'rfa-rights';
					}
					else {
						player.contract = player.start.toString().substring(2) + '/' + player.end.toString().substring(2);
						player.terms = 'signed';
					}

					players.push(player);
				});

				resolve(players);
			});
	});
};

var teams = {};

newPlayersPromise().then((players) => {
	players.sort((a, b) => {
		if (a.name < b.name) {
			return -1;
		}
		else if (a.name > b.name) {
			return 1;
		}
		else {
			return 0;
		}
	});

	players.forEach((player) => {
		if (!teams[player.owner]) {
			teams[player.owner] = [];
		}

		teams[player.owner].push(player);
	});

	newPicksPromise().then((picks) => {
		picks.forEach((pick) => {
			pick.origin = pick.origin.substring(5);
		});

		if (render) {
			var pug = require('pug');
			var compiledPug = pug.compileFile('../views/trade.pug');

			fs.writeFileSync('../public/trade/index.html', compiledPug({
				franchises: Object.values(PSO.franchises).sort(),
				teams: teams,
				picks: picks,
				season: process.env.SEASON
			}));

			process.exit();
		}
	});
});
