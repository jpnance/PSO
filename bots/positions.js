var dotenv = require('dotenv').config({ path: __dirname + '/../.env' });

var request = require('superagent');

var PSO = require('../pso.js');

const siteData = {
	pso: {
		staticPositions: ['QB', 'RB', 'WR', 'TE', 'DL', 'LB', 'DB', 'K'],
		sheetLink: 'https://sheets.googleapis.com/v4/spreadsheets/1nas3AqWZtCu_UZIV77Jgxd9oriF1NQjzSjFWW86eong/values/Rostered',
		fantraxLink: 'https://www.fantrax.com/fxpa/downloadPlayerStats?leagueId=eju35f9ok7xr9cvt&&statusOrTeamFilter=ALL'
	},
	colbys: {
		staticPositions: ['PG', 'SG', 'SF', 'PF', 'C'],
		sheetLink: 'https://sheets.googleapis.com/v4/spreadsheets/16SHgSkREFEYmPuLg35KDSIdJ72MrEkYb1NKXSaoqSTc/values/Rostered',
		fantraxLink: 'https://www.fantrax.com/fxpa/downloadPlayerStats?leagueId=gxejd020khl7ipoo&statusOrTeamFilter=ALL'
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

var newFantraxPromise = function(players) {
	return new Promise(function(resolve, reject) {
		request
			.get(siteData[parameters.site].fantraxLink)
			.set('Cookie', process.env.FANTRAX_COOKIES)
			.then(response => {
				var csvLines = response.body.toString();

				csvLines.split(/\n/).forEach((csvLine, i) => {
					if (i == 0) {
						return;
					}

					var fields = csvLine.replace(/^\"/, '').split(/","/);

					var name = fields[1];
					var team = fields[2];
					var positions = fields[3].split(/,/);

					var player = players.find(player => nameToId(player.name) == nameToId(name));

					if (player) {
						player.team = team;
						player.position = positions.filter(position => siteData[parameters.site].staticPositions.includes(position));
					}
				});

				resolve(players);
			});
		}
	)
};

var newSheetsPromise = function(fantraxId) {
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

				rows.shift();
				rows.shift();
				rows.pop();

				rows.forEach((row, i) => {
					players.push({ row: i, name: row[1], position: row[2].split('/') });
				});

				resolve(players);
			});
	});
};

var nameToId = function(name) {
	return name.toLowerCase().replace(/[^a-z]/g, '');
};

var positionSort = function(a, b) {
	return siteData[parameters.site].staticPositions.indexOf(a) - siteData[parameters.site].staticPositions.indexOf(b);
};

newSheetsPromise().then(players => {
	newFantraxPromise(players).then(players => {
		players.forEach(player => {
			if (player.position) {
				console.log(player.position.sort(positionSort).join('/'));
			}
			else {
				console.log('???');
			}
		});
	});
});
