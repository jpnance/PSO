var dotenv = require('dotenv').config({ path: '/app/.env' });

var request = require('superagent');

var PSO = require('../pso.js');
var sleeperData = Object.values(require('../public/data/sleeper-data.json'));

const siteData = {
	sheetLink: 'https://sheets.googleapis.com/v4/spreadsheets/1nas3AqWZtCu_UZIV77Jgxd9oriF1NQjzSjFWW86eong/values/Rostered',
};

var newSheetsPromise = function() {
	return new Promise(function(resolve, reject) {
		request
			.get(siteData.sheetLink)
			.query({ alt: 'json', key: process.env.GOOGLE_API_KEY })
			.then((response) => {
				var dataJson = JSON.parse(response.text);

				var players = [];

				dataJson.values.forEach((row, i) => {
					if (i < 2 || i == dataJson.values.length - 1) {
						return;
					}

					var player = {
						owner: (row[0] != '') ? row[0] : undefined,
						name: row[1],
						positions: row[2].split('/'),
						start: parseInt(row[3]) || 'FA',
						end: parseInt(row[4]) || undefined,
						salary: row[5] ? parseInt(row[5].replace('$', '')) : undefined
					};

					var sleeperPlayer = sleeperData.filter((sleeperPlayerData) => {
						return sleeperPlayerData.search_full_name == player.name.replace(/[\. '-]/g, '').toLowerCase() && sleeperPlayerData.fantasy_positions.includes(player.positions[0]);
					});

					if (sleeperPlayer.length == 1) {
						player.id = sleeperPlayer[0].player_id;
					}
					else {
						if (player.name == 'Mike Williams' && player.positions.includes('WR')) {
							player.id = '4068';
						}
						else if (player.name == 'Marcus Williams' && player.positions.includes('DB')) {
							player.id = '4091';
						}
						else {
							console.error(player);
						}
					}

					players.push(player);
				});

				resolve(players);
			});
	});
};

newSheetsPromise().then((players) => {
	console.log(JSON.stringify(players));
});
