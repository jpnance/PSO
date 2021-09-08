var dotenv = require('dotenv').config({ path: __dirname + '/../.env' });

var fs = require('fs');
var request = require('superagent');

var PSO = require('../pso.js');

const siteData = {
	pso: {
		sheetLink: 'https://sheets.googleapis.com/v4/spreadsheets/1nas3AqWZtCu_UZIV77Jgxd9oriF1NQjzSjFWW86eong/values/Rostered',
		fantraxLink: 'https://www.fantrax.com/fxpa/downloadPlayerStats?leagueId=' + PSO.fantraxLeagueId + '&pageNumber=1&view=STATS&positionOrGroup=ALL&seasonOrProjection=PROJECTION_0_23b_EVENT_BY_PERIOD&timeframeTypeCode=BY_PERIOD&transactionPeriod=1&miscDisplayType=1&sortType=SCORE&maxResultsPerPage=20&statusOrTeamFilter=ALL_TAKEN&scoringCategoryType=5&timeStartType=PERIOD_ONLY&schedulePageAdj=0&searchName=&startDate=2021-09-09&endDate=2022-01-09&teamId=mkljbisnkkyr33yl'
	},
	colbys: {
		sheetLink: 'https://sheets.googleapis.com/v4/spreadsheets/16SHgSkREFEYmPuLg35KDSIdJ72MrEkYb1NKXSaoqSTc/values/Rostered',
		fantraxLink: 'https://www.fantrax.com/fxpa/downloadPlayerStats?leagueId=gxejd020khl7ipoo&seasonOrProjection=PROJECTION_0_41b_SEASON&statusOrTeamFilter=ALL'
	}
};

var parameters = {
	site: 'pso'
};

var owners = {
	'BLLZ': 'Brett',
	'REYN': 'James/Charles',
	'RIDD': 'Jason',
	'ATTY': 'John/Zach',
	'SOMA': 'Keyon',
	'KOMU': 'Koci/Mueller',
	'LUKE': 'Luke',
	'MTCH': 'Mitch',
	'pat': 'Patrick',
	'QTM': 'Quinn',
	'SCHX': 'Schex',
	'PP': 'Trevor'
};

var rosterTemplate = {
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
				var players = [];

		/*
		fs.readFile('./pso.csv', function(error, data) {
				var csvLines = data.toString();
		*/

				csvLines.split(/\n/).forEach((csvLine, i) => {
					if (i == 0) {
						return;
					}

					// "ID","Player","Team","Position","Rk","Status","Roster Status","Age","Opponent","Contract","FPts","%D","ADP","Bye","Ros%"
					var fields = csvLine.replace(/^\"/, '').split(/","/);

					players.push({
						name: fields[1],
						owner: fields[5],
						positions: fields[3].split(/,/),
						ppg: parseFloat(fields[10]),
						bye: parseInt(fields[13])
					})
				});

				players.sort((a, b) => {
					if (a.ppg > b.ppg) {
						return -1;
					}
					else if (a.ppg < b.ppg) {
						return 1;
					}
					else {
						return 0;
					}
				});

				resolve(players);
			});
		}
	)
};

var pointsForOwnerWeek = function(players, owner, week) {
	var rosterSpots = [
		{ fillWith: ['QB'], default: 8 },
		{ fillWith: ['RB'], default: 4 },
		{ fillWith: ['RB'], default: 4 },
		{ fillWith: ['WR'], default: 5 },
		{ fillWith: ['WR'], default: 5 },
		{ fillWith: ['TE'], default: 3 },
		{ fillWith: ['WR', 'TE'], default: 5 },
		{ fillWith: ['RB', 'WR'], default: 5 },
		{ fillWith: ['QB', 'RB', 'WR', 'TE'], default: 8 },
		{ fillWith: ['DL'], default: 4 },
		{ fillWith: ['LB'], default: 5 },
		{ fillWith: ['DB'], default: 4 },
		{ fillWith: ['DL', 'LB', 'DB'], default: 5 },
		{ fillWith: ['DL', 'LB', 'DB'], default: 5 },
		{ fillWith: ['K'], default: 7 }
	];

	var ownerPlayers = players.filter(player => player.owner == owner && player.bye != week);
	var weekTotal = 0;

	ownerPlayers.forEach(player => {
		rosterSpots.every(rosterSpot => {
			if (!rosterSpot.filled && player.positions.some(position => rosterSpot.fillWith.includes(position))) {
				rosterSpot.filled = true;
				weekTotal += player.ppg;
				return false;
			}

			return true;
		});
	});

	rosterSpots.forEach(rosterSpot => {
		if (!rosterSpot.filled) {
			weekTotal += rosterSpot.default;
		}
	});

	return weekTotal;
};

newFantraxPromise().then(players => {
	for (var week = 1; week <= 15; week++) {
		console.log('Week', week);

		Object.keys(owners).forEach(owner => {
			console.log(owners[owner], Math.round(pointsForOwnerWeek(players, owner, week)));
		});

		console.log();
	}
});
