var dotenv = require('dotenv').config({ path: '/app/.env' });
var PSO = require('../config/pso');

var request = require('superagent');

var parameters = {
	render: false,
	season: PSO.season,
	site: 'pso'
};

var siteData = {
	pso: {
		sheetLink: 'https://sheets.googleapis.com/v4/spreadsheets/1nas3AqWZtCu_UZIV77Jgxd9oriF1NQjzSjFWW86eong/values/Rostered',
		firstRow: 3,
		referenceSite: 'https://www.pro-football-reference.com/search/search.fcgi?search='
	},
	colbys: {
		sheetLink: 'https://sheets.googleapis.com/v4/spreadsheets/16SHgSkREFEYmPuLg35KDSIdJ72MrEkYb1NKXSaoqSTc/values/Rostered',
		firstRow: 2,
		referenceSite: 'https://www.basketball-reference.com/search/search.fcgi?search='
	}
};

process.argv.forEach(function(value, index, array) {
	if (index > 1) {
		var pair = value.split(/=/);

		switch (pair[0]) {
			case 'demo':
				parameters.demo = true;
				break;

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
	.get(siteData[parameters.site].sheetLink)
	.query({ alt: 'json', key: process.env.GOOGLE_API_KEY })
	.then(response => {
		var dataJson = JSON.parse(response.text);

		dataJson.values.forEach((row, i) => {
			if (i < siteData[parameters.site].firstRow - 1 || i == rows.length - 1) {
				return;
			}

			var player = {
				owner: row[0],
				name: row[1],
				position: row[2],
				start: row[3],
				end: row[4],
				salary: row[5]
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
			var path = require('path');
			var pug = require('pug');
			var compiledPug = pug.compileFile(path.join(__dirname, '../views/auction.pug'));
			fs.writeFileSync(path.join(__dirname, '../public/auction/index.html'), compiledPug({
				owners: PSO.nominationOrder,
				referenceSite: siteData[parameters.site].referenceSite,
				webSocketUrl: process.env.WEB_SOCKET_URL
			}));

			var compiledPugAdmin = pug.compileFile(path.join(__dirname, '../views/auction-admin.pug'));
			fs.writeFileSync(path.join(__dirname, '../public/auction/admin.html'), compiledPugAdmin({
				players: players,
				positions: positions,
				situations: situations,
				owners: PSO.nominationOrder,
				referenceSite: siteData[parameters.site].referenceSite,
				webSocketUrl: process.env.WEB_SOCKET_URL
			}));
		}

		if (parameters.demo) {
			console.log(JSON.stringify(players));
		}

		process.exit();
	});
