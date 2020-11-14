var dotenv = require('dotenv').config({ path: '../.env' });

var request = require('superagent');

var parameters = {
	render: false,
	season: parseInt(process.env.SEASON),
	site: 'pso'
};

var sheetLinks = {
	pso: 'https://spreadsheets.google.com/feeds/cells/1nas3AqWZtCu_UZIV77Jgxd9oriF1NQjzSjFWW86eong/2/public/full?alt=json',
	colbys: 'https://spreadsheets.google.com/feeds/cells/16SHgSkREFEYmPuLg35KDSIdJ72MrEkYb1NKXSaoqSTc/2/public/full?alt=json'
};

process.argv.forEach(function(value, index, array) {
	if (index > 1) {
		var pair = value.split(/=/);

		switch (pair[0]) {
			case 'render':
				parameters.render = true;
				break;

			case 'season':
				parameters.season = parseInt(pair[1]);
				break;

			case 'site':
				parameters.site = pair[1];
				break;
		}
	}
});

var rows = [];
var players = [];
var positions = [];
var situations = [];

request
	.get(sheetLinks[parameters.site])
	.then(response => {
		var dataJson = JSON.parse(response.text);

		dataJson.feed.entry.forEach(cell => {
			var row = parseInt(cell.gs$cell.row);
			var column = parseInt(cell.gs$cell.col);
			var value = cell.gs$cell.$t;

			if (!rows[row]) {
				rows[row] = [];
			}

			rows[row][column] = value;
		});

		rows.forEach((row, i) => {
			if (i < 3 || i == rows.length - 1) {
				return;
			}

			var player = {
				owner: row[2],
				name: row[3],
				position: row[4],
				start: row[5],
				end: row[6],
				salary: row[7]
			};

			if (player.end == parameters.season) {
				if (player.start == parameters.season - 2 || player.start == parameters.season - 1) {
					player.situation = 'RFA-' + player.owner;
				}
				else {
					player.situation = 'UFA';
				}

				players.push(player);
			}
		});

		players.sort((a, b) => {
			if (a.name > b.name) {
				return 1;
			}
			else if (a.name < b.name) {
				return -1;
			}
			else {
				return 0;
			}
		});

		players.forEach(player => {
			if (!positions.includes(player.position)) {
				positions.push(player.position);
			}

			if (!situations.includes(player.situation)) {
				situations.push(player.situation);
			}
		});

		positions.sort();
		situations.sort();

		if (parameters.render) {
			var fs = require('fs');
			var pug = require('pug');
			var compiledPug = pug.compileFile('../views/auction.pug');
			fs.writeFileSync('../public/auction/index.html', compiledPug());

			var compiledPugAdmin = pug.compileFile('../views/auction-admin.pug');
			fs.writeFileSync('../public/auction/admin.html', compiledPugAdmin({ players: players, positions: positions, situations: situations }));
		}

		process.exit();
	});
