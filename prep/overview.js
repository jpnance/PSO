var dotenv = require('dotenv').config({ path: __dirname + '/../.env' });

var fs = require('fs');
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
		ratingThresholds: {
			'fg%': [ 0.000, 0.400, 0.440, 0.500, 0.575 ],
			'3pm': [ 0.0, 1.0, 1.5, 2.0, 3.0 ],
			ftm: [ 0.0, 1.5, 2.7, 4.0, 6.0 ],
			'ft%': [ 0.000, 0.725, 0.775, 0.800, 0.830 ],
			pts: [ 0, 10, 15, 20, 26 ],
			reb: [ 0.0, 4.8, 6.5, 8.7, 12.0 ],
			ast: [ 0.0, 2.0, 3.3, 5.0, 8.0 ],
			stl: [ 0.0, 0.8, 1.0, 1.2, 1.8 ],
			blk: [ 0.0, 0.6, 0.9, 1.4, 2.0 ],
			to: [ 0.0, 0.6, 0.9, 1.1, 1.5 ]
		},
		sheetLink: 'https://spreadsheets.google.com/feeds/cells/16SHgSkREFEYmPuLg35KDSIdJ72MrEkYb1NKXSaoqSTc/2/public/full?alt=json',
		fantraxLink: 'https://www.fantrax.com/fxpa/downloadPlayerStats?leagueId=gxejd020khl7ipoo&seasonOrProjection=PROJECTION_0_41b_SEASON&statusOrTeamFilter=ALL'
	}
};

var parameters = {
	site: 'colbys',
	query: {
		gp: 40
	}
};

process.argv.forEach(function(value, index, array) {
	if (index > 1) {
		var pair = value.split(/=/);

		switch (pair[0]) {
			case 'site':
				parameters.site = pair[1];
				break;

			case 'owners':
				parameters.query.owners = pair[1].split(',');
				break;

			case 'fg%':
			case '3pm':
			case 'ftm':
			case 'ft%':
			case 'pts':
			case 'reb':
			case 'ast':
			case 'stl':
			case 'blk':
			case 'to':
				parameters.query[pair[0]] = parseFloat(pair[1]);
				break;

			case 'ufa':
				parameters.query.ufa = (pair[1] == 'true');
				break;

			case 'rfa':
				parameters.query.rfa = (pair[1] == 'true');
				break;

			case 'unsigned':
				parameters.query.unsigned = true;
				break;

			case 'signed':
				parameters.query.unsigned = false;
				break;
		}
	}
});

var displayPlayers = function(players) {
	var columnPadding = 2;
	var headings = [
		{
			field: 'owner',
			label: 'Owner',
			padLength: 12
		},
		{
			field: 'name',
			label: 'Name',
			padLength: 24
		},
		{
			field: 'contract',
			label: 'Contract',
			padLength: 8
		},
		{
			field: 'salary',
			label: 'Salary',
			padLength: 6
		},
		{
			field: 'fantraxProjections.rating.fg%',
			label: 'FG%',
			padLength: 3
		},
		{
			field: 'fantraxProjections.rating.3pm',
			label: '3PM',
			padLength: 3
		},
		{
			field: 'fantraxProjections.rating.ftm',
			label: 'FTM',
			padLength: 3
		},
		{
			field: 'fantraxProjections.rating.ft%',
			label: 'FT%',
			padLength: 3
		},
		{
			field: 'fantraxProjections.rating.pts',
			label: 'PTS',
			padLength: 3
		},
		{
			field: 'fantraxProjections.rating.reb',
			label: 'REB',
			padLength: 3
		},
		{
			field: 'fantraxProjections.rating.ast',
			label: 'AST',
			padLength: 3
		},
		{
			field: 'fantraxProjections.rating.stl',
			label: 'STL',
			padLength: 3
		},
		{
			field: 'fantraxProjections.rating.blk',
			label: 'BLK',
			padLength: 3
		},
		{
			field: 'fantraxProjections.rating.to',
			label: 'TO',
			padLength: 3
		},
	];

	players.forEach((player, i) => {
		var outputString = '';

		if (i == 0) {
			headings.forEach(heading => {
				outputString += heading.label.padEnd(heading.padLength + columnPadding);
			});

			console.log(outputString);

			outputString = '';

			headings.forEach(heading => {
				outputString += ''.padEnd(heading.label.length, '-').padEnd(heading.padLength + columnPadding);
			});

			console.log(outputString);

			outputString = '';
		}

		headings.forEach(heading => {
			var hierarchy = heading.field.split('.');
			var value = player;

			hierarchy.forEach(tier => {
				value = value[tier];
			});

			outputString += (value || '').toString().padEnd(heading.padLength + columnPadding);
		});

		console.log(outputString);
	});
};

var filterUsingQuery = function(player) {
	if (!player.fantraxProjections) {
		return false;
	}

	var query = parameters.query;
	var queryKeys = Object.keys(query);

	if (queryKeys.length == 0) {
		return false;
	}

	for (var i = 0; i < queryKeys.length; i++) {
		var queryKey = queryKeys[i];

		if (queryKey == 'gp' && player.fantraxProjections.gamesPlayed < query.gp) {
			return false;
		}
		else if (queryKey == 'owners' && !query.owners.includes(player.owner)) {
			return false;
		}
		else if (Object.keys(siteData[parameters.site].ratingThresholds).includes(queryKey) && player.fantraxProjections.rating[queryKey] < query[queryKey]) {
			return false;
		}
		else if (queryKey == 'rfa' && player.rfa != query.rfa) {
			return false;
		}
		else if (queryKey == 'ufa' && player.ufa != query.ufa) {
			return false;
		}
		else if (queryKey == 'unsigned') {
			if (query.unsigned == true && !player.rfa && !player.ufa) {
				return false;
			}
			else if (query.unsigned == false && (player.rfa || player.ufa)) {
				return false;
			}
		}
	}

	return true;
};

var newFantraxPromise = function(players) {
	return new Promise(function(resolve, reject) {
		/*
		request
			.get(siteData[parameters.site].fantraxLink)
			.set('Cookie', process.env.FANTRAX_COOKIES)
			.then(response => {
				var csvLines = response.body.toString();
		*/

		fs.readFile('./colbys.csv', function(error, data) {
				var csvLines = data.toString();

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
							player.fantraxProjections = { raw: {}, perGame: {}, rating: {} };
						}

						player.fantraxProjections.gamesPlayed = parseInt(fields[12]);

						player.fantraxProjections.score = parseFloat(fields[9]);
						player.fantraxProjections.ratingSum = 0;

						player.fantraxProjections.raw['fg%'] = parseFloat(fields[13]);
						player.fantraxProjections.raw['3pm'] = parseInt(fields[14]);
						player.fantraxProjections.raw.ftm = parseInt(fields[15]);
						player.fantraxProjections.raw['ft%'] = parseFloat(fields[16]);
						player.fantraxProjections.raw.pts = parseInt(fields[17]);
						player.fantraxProjections.raw.reb = parseInt(fields[18]);
						player.fantraxProjections.raw.ast = parseInt(fields[19]);
						player.fantraxProjections.raw.stl = parseInt(fields[20]);
						player.fantraxProjections.raw.blk = parseInt(fields[21]);
						player.fantraxProjections.raw.to = parseInt(fields[22]);

						Object.keys(player.fantraxProjections.raw).forEach(statKey => {
							if (!statKey.includes('%')) {
								player.fantraxProjections.perGame[statKey] = parseFloat((player.fantraxProjections.raw[statKey] / player.fantraxProjections.gamesPlayed).toFixed(3));
							}
							else {
								player.fantraxProjections.perGame[statKey] = player.fantraxProjections.raw[statKey];
							}

							player.fantraxProjections.rating[statKey] = perGameAverageToRating(statKey, player.fantraxProjections.perGame[statKey]);

							player.fantraxProjections.ratingSum += player.fantraxProjections.rating[statKey];
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
						player.salary = undefined;

						if (player.start == '2018' || player.start == '2017') {
							player.rfa = true;
							player.contract = 'RFA';
						}
						else if (player.start != '2020') {
							player.ufa = true;
							player.contract = 'UFA';

							player.owner = undefined;
						}
					}

					if (!player.end) {
						player.end = undefined;
						player.contract = '20/?';
					}

					if (!player.contract && player.start && player.end) {
						player.contract = player.start.substring(2) + '/' + player.end.substring(2);
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

var perGameAverageToRating = function(stat, value) {
	var thresholds = siteData[parameters.site].ratingThresholds[stat];
	var rating = 0;

	if (stat == 'to') {
		rating = 6;
	}

	thresholds.forEach(threshold => {
		if (value >= threshold) {
			if (stat == 'to') {
				rating -= 1;
			}
			else {
				rating += 1;
			}
		}
	});

	if (rating == 6) {
		rating = 5;
	}
	else if (rating == 0) {
		rating = 1;
	}

	return rating;
};

var positionSort = function(a, b) {
	return siteData[parameters.site].staticPositions.indexOf(a) - siteData[parameters.site].staticPositions.indexOf(b);
};

newSheetsPromise().then(players => {
	newFantraxPromise(players).then(players => {
		var filteredPlayers = players.filter(filterUsingQuery);
		displayPlayers(filteredPlayers);

		//console.log(JSON.stringify(players, null, '  '));
	});
});
