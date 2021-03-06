var dotenv = require('dotenv').config({ path: '../.env' });

var request = require('superagent');

var parameters = {
	render: false,
	season: parseInt(process.env.SEASON),
	site: 'pso'
};

var siteData = {
	pso: {
		sheetLink: 'https://spreadsheets.google.com/feeds/cells/1nas3AqWZtCu_UZIV77Jgxd9oriF1NQjzSjFWW86eong/2/public/full?alt=json',
		firstRow: 3
	},
	colbys: {
		sheetLink: 'https://spreadsheets.google.com/feeds/cells/16SHgSkREFEYmPuLg35KDSIdJ72MrEkYb1NKXSaoqSTc/2/public/full?alt=json',
		firstRow: 2
	}
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
var owners = {
	pso: [
		'Brett',
		'James/Charles',
		'John/Zach',
		'Keyon',
		'Koci/Mueller',
		'Luke',
		'Mitch',
		'Patrick',
		'Quinn',
		'Schex',
		'Terence',
		'Trevor'
	],

	colbys: [
		'James',
		'Jason',
		'Joel',
		'John/Charles',
		'Justin',
		'Mike',
		'Mitch/Keyon',
		'Patrick',
		'Paul',
		'Schex/Kevin',
		'Syed/Koci',
		'Taylor'
	]
};


request
	.get(siteData[parameters.site].sheetLink)
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
			if (i < siteData[parameters.site].firstRow || i == rows.length - 1) {
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
			fs.writeFileSync('../public/auction/admin.html', compiledPugAdmin({ players: players, positions: positions, situations: situations, owners: owners[parameters.site] }));
		}

		process.exit();
	});
