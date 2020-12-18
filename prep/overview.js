var dotenv = require('dotenv').config({ path: __dirname + '/../.env' });

var request = require('superagent');

var PSO = require('../pso.js');

const siteData = {
	pso: {
		staticPositions: ['QB', 'RB', 'WR', 'TE', 'DL', 'LB', 'DB', 'K'],
		sheetLink: 'https://spreadsheets.google.com/feeds/cells/1nas3AqWZtCu_UZIV77Jgxd9oriF1NQjzSjFWW86eong/2/public/full?alt=json',
		fantraxLink: 'https://www.fantrax.com/fxpa/downloadPlayerStats?leagueId=eju35f9ok7xr9cvt&&statusOrTeamFilter=ALL'
	},
	colbys: {
		staticPositions: ['PG', 'SG', 'SF', 'PF', 'C'],
		rosterMakeup: ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'Util', 'Util', 'Util'],
		sheetLink: 'https://spreadsheets.google.com/feeds/cells/16SHgSkREFEYmPuLg35KDSIdJ72MrEkYb1NKXSaoqSTc/2/public/full?alt=json',
		fantraxLink: 'https://www.fantrax.com/fxpa/downloadPlayerStats?leagueId=gxejd020khl7ipoo&seasonOrProjection=PROJECTION_0_41b_SEASON&statusOrTeamFilter=ALL'
	}
};

var parameters = {
	site: 'colbys'
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

					// "Player","Team","Position","Rk","Status","Age","Opponent","Salary","Contract","Score","%D","ADP","GP","FG%","3PTM","FTM","FT%","PTS","REB","AST","ST","BLK","TO"
					var fields = csvLine.replace(/^\"/, '').split(/","/);

					var id = nameToId(fields[0]);
					var positions = fields[2].split(/,/);

					var player = players.find(player => player.id == id);

					if (player) {
						player.team = fields[1];
						player.positions = positions.filter(position => siteData[parameters.site].staticPositions.includes(position));

						if (player.fantraxProjections) {
							console.log('Dirty data with', player.name, '(' + player.team + ')');
						}
						else {
							player.fantraxProjections = { raw: {}, perGame: {} };
						}

						player.fantraxProjections.gamesPlayed = parseInt(fields[12]);

						player.fantraxProjections.score = parseFloat(fields[9]);

						player.fantraxProjections.raw.fieldGoalPercentage = parseFloat(fields[13]);
						player.fantraxProjections.raw.threePointersMade = parseInt(fields[14]);
						player.fantraxProjections.raw.freeThrowsMade = parseInt(fields[15]);
						player.fantraxProjections.raw.freeThrowPercentage = parseFloat(fields[16]);
						player.fantraxProjections.raw.points = parseInt(fields[17]);
						player.fantraxProjections.raw.rebounds = parseInt(fields[18]);
						player.fantraxProjections.raw.assists = parseInt(fields[19]);
						player.fantraxProjections.raw.steals = parseInt(fields[20]);
						player.fantraxProjections.raw.blocks = parseInt(fields[21]);
						player.fantraxProjections.raw.turnovers = parseInt(fields[22]);

						Object.keys(player.fantraxProjections.raw).forEach(statKey => {
							if (!statKey.includes('Percentage')) {
								player.fantraxProjections.perGame[statKey] = parseFloat((player.fantraxProjections.raw[statKey] / player.fantraxProjections.gamesPlayed).toFixed(3));
							}
							else {
								player.fantraxProjections.perGame[statKey] = player.fantraxProjections.raw[statKey];
							}
						});
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
			.then(response => {
				var dataJson = JSON.parse(response.text);
				var cells = dataJson.feed.entry;

				var rows = [];
				var players = [];
				var league = {};

				cells.forEach(cell => {
					var row = parseInt(cell.gs$cell.row);
					var column = parseInt(cell.gs$cell.col);

					if (!rows[row]) {
						rows[row] = [];
					}

					rows[row][column] = cell.content.$t;
				});

				rows.shift();
				rows.shift();

				rows.forEach(row => {
					var player = {
						id: nameToId(row[3]),
						owner: row[2],
						name: row[3],
						start: row[5],
						end: row[6],
						salary: row[7] ? parseInt(row[7].substring(1)) : null
					};

					if (player.end == '2019') {
						delete player.salary;

						if (player.start == '2018' || player.start == '2017') {
							player.rfa = true;
						}
						else if (player.start != '2020') {
							player.ufa = true;
							delete player.owner;
						}
					}

					players.push(player);
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
		console.log(players);
	});
});
