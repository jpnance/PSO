/*
 * For PSO, you first need to download a huge JSON file with Sleeper projections and then convert it into a CSV file. Follow the directions in csv.js and then do `node csv > pso.csv`.
 */

/*
 * For Colbys, you first need to download a CSV with projction data.
 *
 * 1. Go to Fantrax
 * 2. Click on "Players"
 * 3. Select the "Tracked" scoring category (not "Tracked (Per-Game)")
 * 4. Select "All" players (not just "All Available Players")
 * 5. Download the CSV and overwrite colbys.csv in this directory
 * 6. Then this stuff should work.
 */

var dotenv = require('dotenv').config({ path: '../.env' });

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
		fantraxLink: 'https://www.fantrax.com/fxpa/downloadPlayerStats?leagueId=' + PSO.fantraxLeagueId + '&&statusOrTeamFilter=ALL'
	},
	colbys: {
		staticPositions: ['PG', 'SG', 'SF', 'PF', 'C'],
		rosterMakeup: ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F/C', 'Util', 'Util', 'Util'],
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
		fantraxLink: 'https://www.fantrax.com/fxpa/downloadPlayerStats?leagueId=g7xcurksln93iz5v&seasonOrProjection=PROJECTION_0_41b_SEASON&statusOrTeamFilter=ALL'
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

			case 'rookies':
				parameters.query.rookies = true;
				break;

			case 'score':
				parameters.query.score = parseFloat(pair[1]);
				break;

			case 'sort':
				var sortParameters = pair[1].split(',').reverse();
				parameters.sortPaths = [];

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
					else if (sortParameters == 'score') {
						parameters.sortPaths.unshift('-fantraxProjections.score');
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
	if (parameters.site == 'pso') {
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
				label: '',
				padLength: 8
			},
			{
				path: 'experience',
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
	}
	else if (parameters.site == 'colbys') {
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
	}

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
		else if (queryKey == 'rookies' && player.experience > 0) {
			return false;
		}
	}

	return true;
};

var newCsvPromise = function(players) {
	return new Promise(function(resolve, reject) {
		if (parameters.site == 'pso') {
			fs.readFile('./pso.csv', function(error, data) {
				var csvLines = data.toString();

				csvLines.split(/\n/).forEach((csvLine, i) => {
					if (i == 0) {
						return;
					}

					// 0 => "Sleeper ID"
					// 1 => "First Name"
					// 2 => "Last Name"
					// 3 => "Team"
					// 4 => "Position"
					// 5 => "Experience"
					// 6 => "2QB Dynasty ADP"
					// 7 => "IDP ADP"
					// 8 => "Pass Yards"
					// 9 => "Pass TDs"
					// 10 => "Pass INTs"
					// 11 => "Pass 2PCs"
					// 12 => "Rush Yards"
					// 13 => "Rush TDs"
					// 14 => "Receiving Yards"
					// 15 => "Receiving TDs"
					// 16 => "Fumbles Lost"
					// 17 => "Solo Tackles"
					// 18 => "Assisted Tackles"
					// 19 => "Sacks"
					// 20 => "INTs"
					// 21 => "Fumbles Forced"
					// 22 => "Fumbles Recovered"
					// 23 => "INT TDs"
					// 24 => "PSO Points"

					var fields = csvLine.split(/,/);

					if (fields.length == 1) {
						return;
					}

					var row = {
						name: `${fields[1]} ${fields[2]}`,
						team: fields[3],
						experience: parseInt(fields[5]),
						positions: fields[4].split(/\//),
						score: parseFloat(fields[24]),
					};

					var id = nameToId(row.name);

					if (row.experience == 0) {
						player = {
							id: id,
							owner: undefined,
							name: row.name,
							positions: row.positions,
							start: 'FA',
							end: 2024,
							salary: 0,
							ufa: true,
							contract: 'UFA'
						};

						players.push(player);
					}

					var player = players.find(player => player.id == id);

					if (player && row.positions.some((position) => player.positions.indexOf(position) > -1)) {
						player.team = row.team;
						player.experience = row.experience;
						player.positions = row.positions.filter(position => siteData[parameters.site].staticPositions.includes(position));

						if (player.fantraxProjections) {
							//console.log('Dirty data with', player.name, '(' + player.team + ')');
						}
						else {
							player.fantraxProjections = { raw: {}, perGame: {}, rating: {} };
						}

						player.fantraxProjections.ratingSum = 0;
						player.fantraxProjections.raw.fpts = row.score;
						player.fantraxProjections.perGame.fpts = row.score / 17;
						player.fantraxProjections.rating.fpts = perGameAverageToRating('fpts', player.fantraxProjections.perGame.fpts);
						player.fantraxProjections.ratingSum += player.fantraxProjections.rating.fpts;
					}
				});

				resolve(players);
			});
		}
		else if (parameters.site == 'colbys') {
			fs.readFile('./colbys.csv', function(error, data) {
				var csvLines = data.toString();

				csvLines.split(/\n/).forEach((csvLine, i) => {
					if (i == 0) {
						return;
					}

					// "ID","Player","Team","Position","RkOv","Status","Age","Opponent","Salary","Contract","Score","GP","FG%","3PTM","FTM","FT%","PTS","REB","AST","ST","BLK","TO"

					// 0 => "ID"
					// 1 => "Player"
					// 2 => "Team"
					// 3 => "Position"
					// 4 => "RkOv"
					// 5 => "Status"
					// 6 => "Age"
					// 7 => "Opponent"
					// 8 => "Salary"
					// 9 => "Contract"
					// 10 => "Score"
					// 11 => "GP"
					// 12 => "FG%"
					// 13 => "3PTM"
					// 14 => "FTM"
					// 15 => "FT%"
					// 16 => "PTS"
					// 17 => "REB"
					// 18 => "AST"
					// 19 => "ST"
					// 20 => "BLK"
					// 21 => "TO"

					var fields = csvLine.replace(/^\"/, '').split(/","/);

					if (fields.length == 1) {
						return;
					}

					var row = {
						name: fields[1],
						team: fields[2],
						positions: fields[3].split(/,/),
						score: parseFloat(fields[10]),
						gamesPlayed: parseInt(fields[11]),
						'fg%': parseFloat(fields[12]),
						'3pm': parseInt(fields[13]),
						ftm: parseInt(fields[14]),
						'ft%': parseFloat(fields[15]),
						pts: parseInt(fields[16]),
						reb: parseInt(fields[17]),
						ast: parseInt(fields[18]),
						stl: parseInt(fields[19]),
						blk: parseInt(fields[20]),
						to: parseInt(fields[21])
					};

					var id = nameToId(row.name);

					var player = players.find(player => player.id == id);

					if (player && row.positions.some((position) => player.positions.indexOf(position) > -1)) {
						player.team = row.team;
						player.positions = row.positions.filter(position => siteData[parameters.site].staticPositions.includes(position));

						if (player.fantraxProjections) {
							//console.log('Dirty data with', player.name, '(' + player.team + ')');
						}
						else {
							player.fantraxProjections = { raw: {}, perGame: {}, rating: {} };
						}

						// colbys
						player.fantraxProjections.gamesPlayed = row.gamesPlayed;

						player.fantraxProjections.score = row.score;
						player.fantraxProjections.ratingSum = 0;

						player.fantraxProjections.raw['fg%'] = row['fg%'];
						player.fantraxProjections.raw['3pm'] = row['3pm'];
						player.fantraxProjections.raw.ftm = row.ftm;
						player.fantraxProjections.raw['ft%'] = row['ft%'];
						player.fantraxProjections.raw.pts = row.pts;
						player.fantraxProjections.raw.reb = row.reb;
						player.fantraxProjections.raw.ast = row.ast;
						player.fantraxProjections.raw.stl = row.stl;
						player.fantraxProjections.raw.blk = row.blk;
						player.fantraxProjections.raw.to = row.to;

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
	});
};

// worth noting that rookies don't appear on the sheet
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

				if (parameters.site == 'pso') {
					rows.shift();
					rows.pop();
				}

				rows.shift();

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

					if (player.end == '2024') {
						player.salary = 0;

						if (player.start == '2023' || player.start == '2022') {
							player.rfa = true;
							player.contract = 'RFA';
						}
						else if (player.start != '2025') {
							player.ufa = true;
							player.contract = 'UFA';

							player.owner = undefined;
						}
					}

					if (!player.end) {
						player.end = undefined;
						player.contract = '25/?';
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

	return color + parseFloat(score).toFixed(2) + reset;
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
	newCsvPromise(players).then(players => {
		var filteredPlayers = players.filter(filterUsingQuery);

		filteredPlayers.sort(sortPlayers);

		if (parameters.limit) {
			filteredPlayers = filteredPlayers.slice(0, parameters.limit);
		}

		displayPlayers(filteredPlayers);

		//console.log(JSON.stringify(filteredPlayers, null, '  '));
	});
});
