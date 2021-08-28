var dotenv = require('dotenv').config({ path: __dirname + '/../.env' });

var fs = require('fs');
var request = require('superagent');

var PSO = require('../pso.js');

const siteData = {
	pso: {
		staticPositions: ['QB', 'RB', 'WR', 'TE', 'DL', 'LB', 'DB', 'K'],
		ratingThresholds: {
			fpts: [ 0, 6, 9, 12, 15 ]
		},
		sheetLink: 'https://sheets.googleapis.com/v4/spreadsheets/1nas3AqWZtCu_UZIV77Jgxd9oriF1NQjzSjFWW86eong/values/Rostered',
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
		sheetLink: 'https://sheets.googleapis.com/v4/spreadsheets/16SHgSkREFEYmPuLg35KDSIdJ72MrEkYb1NKXSaoqSTc/values/Rostered',
		fantraxLink: 'https://www.fantrax.com/fxpa/downloadPlayerStats?leagueId=gxejd020khl7ipoo&seasonOrProjection=PROJECTION_0_41b_SEASON&statusOrTeamFilter=ALL'
	}
};

var parameters = {
	site: 'pso',
	limit: null,
	query: {
		gp: 40
	},
	sortPaths: [ '-fantraxProjections.raw.fpts' ]
};

process.argv.forEach(function(value, index, array) {
	if (index > 1) {
		var pair = value.split(/=/);

		switch (pair[0]) {
			case 'site':
				parameters.site = pair[1];
				break;

			case 'limit':
				parameters.limit = parseInt(pair[1]);
				break;

			case 'gp':
				parameters.query.gp = parseInt(pair[1]);
				break;

			case 'name':
				parameters.query.name = pair[1];
				break;

			case 'owners':
				parameters.query.owners = pair[1].split(',');
				break;

			case 'positions':
				parameters.query.positions = pair[1].split(',');
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
				parameters.query.ufa = (pair[1] != 'false');
				break;

			case 'rfa':
				parameters.query.rfa = (pair[1] != 'false');
				break;

			case 'unsigned':
				parameters.query.unsigned = true;
				break;

			case 'signed':
				parameters.query.unsigned = false;
				break;

			case 'ovr':
				parameters.query.ovr = parseFloat(pair[1]);
				break;

			case 'score':
				parameters.query.score = parseFloat(pair[1]);
				break;

			case 'sort':
				var sortParameters = pair[1].split(',').reverse();

				sortParameters.forEach(sortParameter => {
					if (sortParameter == 'name') {
						parameters.sortPaths.unshift('+name');
					}
					else if (sortParameter == 'salary') {
						parameters.sortPaths.unshift('-salary');
					}
					else if (sortParameter == 'gp') {
						parameters.sortPaths.unshift('-fantraxProjections.gamesPlayed');
					}
					else if (sortParameter == 'contract') {
						parameters.sortPaths.unshift('+contract');
					}
					else if (sortParameter == 'positions') {
						parameters.sortPaths.unshift('+positions');
					}
					else {
						parameters.sortPaths.unshift('-fantraxProjections.rating.' + sortParameter);
					}
				});

				break;
		}
	}
});

var contractStyler = function(contract) {
	var colors = {
		UFA: '\x1b[1m\x1b[38;5;10m',
		RFA: '\x1b[1m\x1b[38;5;3m',
		signed: '\x1b[38;5;15m',
		reset: '\x1b[0m'
	};

	return (colors[contract] || colors.signed) + contract + colors.reset;
};

var displayPlayers = function(players) {
	var columnPadding = 1;

	// pso
	var headings = [
		{
			path: 'owner',
			label: '',
			padLength: 14
		},
		{
			path: 'name',
			label: '',
			padLength: 24
		},
		{
			path: 'team',
			label: '',
			padLength: 8
		},
		{
			path: 'positions',
			label: '',
			padLength: 11
		},
		{
			path: 'contract',
			label: '',
			styler: contractStyler,
			padLength: 6
		},
		{
			path: 'salary',
			label: '',
			styler: salaryStyler,
			padLength: 4
		},
		{
			path: 'fantraxProjections.raw.fpts',
			label: 'FPts',
			padLength: 8
		},
		{
			path: 'bye',
			label: '',
			padLength: 3
		},
		{
			path: 'fantraxProjections.ratingSum',
			label: '',
			styler: ratingStyler,
			padLength: 3
		},
	];

	/*
	// colbys
	var headings = [
		{
			path: 'owner',
			label: '',
			padLength: 12
		},
		{
			path: 'name',
			label: '',
			padLength: 24
		},
		{
			path: 'team',
			label: '',
			padLength: 4
		},
		{
			path: 'positions',
			label: '',
			padLength: 11
		},
		{
			path: 'contract',
			label: '',
			styler: contractStyler,
			padLength: 6
		},
		{
			path: 'salary',
			label: '',
			styler: salaryStyler,
			padLength: 4
		},
		{
			path: 'fantraxProjections.gamesPlayed',
			label: 'GP',
			padLength: 3
		},
		{
			path: 'fantraxProjections.rating.fg%',
			label: 'FG%',
			styler: ratingStyler,
			padLength: 3
		},
		{
			path: 'fantraxProjections.rating.3pm',
			label: '3PM',
			styler: ratingStyler,
			padLength: 3
		},
		{
			path: 'fantraxProjections.rating.ftm',
			label: 'FTM',
			styler: ratingStyler,
			padLength: 3
		},
		{
			path: 'fantraxProjections.rating.ft%',
			label: 'FT%',
			styler: ratingStyler,
			padLength: 3
		},
		{
			path: 'fantraxProjections.rating.pts',
			label: 'PTS',
			styler: ratingStyler,
			padLength: 3
		},
		{
			path: 'fantraxProjections.rating.reb',
			label: 'REB',
			styler: ratingStyler,
			padLength: 3
		},
		{
			path: 'fantraxProjections.rating.ast',
			label: 'AST',
			styler: ratingStyler,
			padLength: 3
		},
		{
			path: 'fantraxProjections.rating.stl',
			label: 'STL',
			styler: ratingStyler,
			padLength: 3
		},
		{
			path: 'fantraxProjections.rating.blk',
			label: 'BLK',
			styler: ratingStyler,
			padLength: 3
		},
		{
			path: 'fantraxProjections.rating.to',
			label: 'TO',
			styler: ratingStyler,
			padLength: 2
		},
		{
			path: 'fantraxProjections.ratingSum',
			label: '',
			padLength: 3
		},
		{
			path: 'fantraxProjections.score',
			label: '',
			styler: scoreStyler,
			padLength: 5
		}
	];
	*/

	players.forEach((player, i) => {
		var outputString = '';

		if (i == 0) {
			headings.forEach(heading => {
				outputString += heading.label.padEnd(heading.padLength + columnPadding);
			});

			console.log(outputString);

			outputString = '';
		}

		headings.forEach(heading => {
			var value = drillDown(player, heading.path);
			var preStyleLength = 0;

			value = (value || '').toString();
			preStyleLength = value.length;

			if (heading.styler) {
				value = heading.styler(value);
			}

			outputString += value;

			for (var i = 0; i < (heading.padLength + columnPadding) - preStyleLength; i++) {
				outputString += ' ';
			}
		});

		console.log(outputString);
	});
};

var drillDown = function(player, path) {
	var value = player;
	var hierarchy = path.split('.');

	hierarchy.forEach(tier => {
		value = value[tier];
	});

	return value;
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
		else if (queryKey == 'name' && !player.name.toLowerCase().includes(query.name.toLowerCase())) {
			return false;
		}
		else if (queryKey == 'owners' && !query.owners.includes(player.owner)) {
			return false;
		}
		else if (queryKey == 'positions') {
			var positionMatch = false;

			player.positions.forEach(position => {
				if (query.positions.includes(position)) {
					positionMatch = true;
				}
			});

			if (!positionMatch) {
				return false;
			}
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
		else if (queryKey == 'ovr' && player.fantraxProjections.ratingSum < query.ovr) {
			return false;
		}
		else if (queryKey == 'score' && player.fantraxProjections.score < query.score) {
			return false;
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

		fs.readFile('./pso.csv', function(error, data) {
				var csvLines = data.toString();

				csvLines.split(/\n/).forEach((csvLine, i) => {
					if (i == 0) {
						return;
					}

					// "Player","Team","Position","Rk","Status","Age","Opponent","Salary","Contract","Score","%D","ADP","GP","FG%","3PTM","FTM","FT%","PTS","REB","AST","ST","BLK","TO"
					var fields = csvLine.replace(/^\"/, '').split(/","/);

					var id = nameToId(fields[1]);
					var positions = fields[3].split(/,/);

					var player = players.find(player => player.id == id);

					if (player && positions.some((position) => player.positions.indexOf(position) > -1)) {
						player.team = fields[2];
						player.positions = positions.filter(position => siteData[parameters.site].staticPositions.includes(position));
						player.bye = parseInt(fields[13]);

						if (player.fantraxProjections) {
							console.log('Dirty data with', player.name, '(' + player.team + ')');
						}
						else {
							player.fantraxProjections = { raw: {}, perGame: {}, rating: {} };
						}

						// pso
						player.fantraxProjections.ratingSum = 0;
						player.fantraxProjections.raw.fpts = parseFloat(fields[9]);
						player.fantraxProjections.perGame.fpts = parseFloat(fields[10]);
						player.fantraxProjections.rating.fpts = perGameAverageToRating('fpts', player.fantraxProjections.perGame.fpts);
						player.fantraxProjections.ratingSum += player.fantraxProjections.rating.fpts;

						/*
						// colbys
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
						*/
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
				var league = {};

				dataJson.values.forEach((row, i) => {
					rows.push(row);
				});

				rows.shift();
				rows.shift();
				rows.pop();

				rows.forEach(row => {
					var player = {
						id: nameToId(row[1]),
						owner: row[0],
						name: row[1],
						positions: row[2].split('/'),
						start: row[3],
						end: row[4],
						salary: row[5] ? parseInt(row[5].substring(1)) : null
					};

					if (player.end == '2020') {
						player.salary = 0;

						if (player.start == '2019' || player.start == '2018') {
							player.rfa = true;
							player.contract = 'RFA';
						}
						else if (player.start != '2021') {
							player.ufa = true;
							player.contract = 'UFA';

							player.owner = undefined;
						}
					}

					if (!player.end) {
						player.end = undefined;
						player.contract = '21/?';
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

var ratingStyler = function(rating) {
	var colors = {
		5: '\x1b[1m\x1b[38;5;10m',
		4: '\x1b[38;5;2m',
		3: '\x1b[38;5;3m',
		2: '\x1b[38;5;1m',
		1: '\x1b[38;5;1m',
		reset: '\x1b[0m'
	};

	return colors[rating] + rating + colors.reset;
};

var salaryStyler = function(salary) {
	return salary || '';
};

var scoreStyler = function(score) {
	if (!score) {
		return score;
	}

	var color = '';

	if (score >= 90) {
		color = '\x1b[1m\x1b[38;5;10m';
	}
	else if (score >= 80) {
		color = '\x1b[38;5;2m';
	}
	else if (score >= 70) {
		color = '\x1b[38;5;3m';
	}
	else {
		color = '\x1b[38;5;1m';
	}

	var reset = '\x1b[0m';

	return color + score + reset;
};

var sortPlayers = function(a, b) {
	for (var i = 0; i < parameters.sortPaths.length; i++) {
		var sortPath = parameters.sortPaths[i].substring(1);
		var order = parameters.sortPaths[i][0];

		var aValue = drillDown(a, sortPath);
		var bValue = drillDown(b, sortPath);

		if (aValue > bValue) {
			if (order == '-') {
				return -1;
			}
			else {
				return 1;
			}
		}
		else if (aValue < bValue) {
			if (order == '-') {
				return 1;
			}
			else {
				return -1;
			}
		}
	}

	return 0;
};

newSheetsPromise().then(players => {
	newFantraxPromise(players).then(players => {
		var filteredPlayers = players.filter(filterUsingQuery);

		filteredPlayers.sort(sortPlayers);

		if (parameters.limit) {
			filteredPlayers = filteredPlayers.slice(0, parameters.limit);
		}

		displayPlayers(filteredPlayers);

		//console.log(JSON.stringify(players, null, '  '));
	});
});
