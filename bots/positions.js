var dotenv = require('dotenv').config({ path: '/app/.env' });

var request = require('superagent');

var PSO = require('../pso.js');

const siteData = {
	pso: {
		staticPositions: ['QB', 'RB', 'WR', 'TE', 'DL', 'LB', 'DB', 'K'],
		sheetLink: 'https://sheets.googleapis.com/v4/spreadsheets/1nas3AqWZtCu_UZIV77Jgxd9oriF1NQjzSjFWW86eong/values/Rostered',
		dataRetrievalFunction: newSleeperJsonPromise,
	},
	colbys: {
		staticPositions: ['PG', 'SG', 'SF', 'PF', 'C'],
		sheetLink: 'https://sheets.googleapis.com/v4/spreadsheets/16SHgSkREFEYmPuLg35KDSIdJ72MrEkYb1NKXSaoqSTc/values/Rostered',
		fantraxLink: `https://www.fantrax.com/fxpa/downloadPlayerStats?leagueId=${PSO.fantraxLeagueId}&statusOrTeamFilter=ALL`,
		dataRetrievalFunction: newFantraxPromise,
	}
};

var parameters = {
	site: 'pso'
};

process.argv.forEach(function(value, index, array) {
	if (index > 1) {
		var pair = value.split(/=/);

		switch (pair[0]) {
			case 'site':
				parameters.site = pair[1];
				break;
		}
	}
});

function newSleeperJsonPromise(players) {
	return new Promise(function(resolve, reject) {
		var sleeperData = Object.values(require('../public/data/sleeper-data.json')).filter((sleeperPlayerData) => sleeperPlayerData.active);

		var mergedPlayers = [];

		players.forEach((player) => {
			var sleeperPlayer = sleeperData.filter((sleeperPlayerData) => {
				return sleeperPlayerData.search_full_name == player.name.replace(/[\. '-]/g, '').toLowerCase() && sleeperPlayerData.fantasy_positions.includes(player.positions[0]);
			});

			if (sleeperPlayer.length == 1) {
				mergedPlayers.push({
					name: player.name,
					positions: sleeperPlayer[0].fantasy_positions,
				});
			}
			else {
				console.error(player);
				console.error(player.name.replace(/[\. '-]/g, '').toLowerCase());
				console.error(sleeperPlayer.filter((sp) => sp.search_full_name == 'chrisjones'));

				process.exit();
			}
		});

		resolve(mergedPlayers);
	});
}

function newFantraxPromise(players) {
	return new Promise(function(resolve, reject) {
		request
			.get(siteData[parameters.site].fantraxLink)
			.set('Cookie', process.env.FANTRAX_COOKIES)
			.then(response => {
				var csvLines = response.body.toString().trim();

				csvLines.split(/\n/).forEach((csvLine, i) => {
					if (i == 0) {
						return;
					}

					var fields = csvLine.replace(/^\"/, '').split(/","/);

					var name = fields[1];
					var team = fields[2];
					var positions = fields[3].split(/,/);

					var playersWithName = players.filter(player => nameToId(player.name) == nameToId(name));

					if (playersWithName.length > 1) {
						return;
					}

					var player = playersWithName[0];

					if (player) {
						if (player.dirty) {
							player.position = player.originalPosition;
						}
						else {
							player.team = team;
							player.originalPosition = player.position;
							player.position = positions.filter(position => siteData[parameters.site].staticPositions.includes(position));
							player.dirty = true;
						}
					}
				});

				resolve(players);
			});
		}
	)
}

function newSheetsPromise(fantraxId) {
	return new Promise(function(resolve, reject) {
		request
			.get(siteData[parameters.site].sheetLink)
			.query({ alt: 'json', key: process.env.GOOGLE_API_KEY })
			.then(response => {
				var dataJson = JSON.parse(response.text);

				var rows = [];
				var players = [];

				dataJson.values.forEach((row, i) => {
					rows.push(row);
				});

				if (parameters.site == 'pso') {
					rows.shift();
				}

				rows.shift();
				rows.pop();

				rows.forEach((row, i) => {
					players.push({ row: i, name: row[1], positions: row[2].split('/') });
				});

				resolve(players);
			});
	});
}

function nameToId(name) {
	return name.toLowerCase().replace(/[^a-z]/g, '');
}

function positionSort(a, b) {
	return siteData[parameters.site].staticPositions.indexOf(a) - siteData[parameters.site].staticPositions.indexOf(b);
}

newSheetsPromise().then(players => {
	siteData[parameters.site].dataRetrievalFunction(players).then(players => {
		players.forEach(player => {
			if (player.positions) {
				console.log(player.positions.sort(positionSort).join('/'));
			}
			else {
				console.log('???');
			}
		});
	});
});
