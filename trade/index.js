var dotenv = require('dotenv').config({ path: '../.env' });

var fs = require('fs');
var request = require('superagent');

var PSO = require('../pso.js');

const siteData = {
	fantraxLink: 'https://www.fantrax.com/fxpa/downloadPlayerStats?leagueId=4bveni4tkkyr33y2&pageNumber=1&reload=1&view=STATS&positionOrGroup=ALL&seasonOrProjection=PROJECTION_0_23b_EVENT_BY_PERIOD&timeframeTypeCode=BY_PERIOD&transactionPeriod=1&miscDisplayType=1&sortType=SCORE&maxResultsPerPage=20&statusOrTeamFilter=ALL_TAKEN&scoringCategoryType=5&timeStartType=PERIOD_ONLY&schedulePageAdj=0&searchName=&startDate=2021-09-09&endDate=2022-01-09&teamId=mkljbisnkkyr33yl'
};

var render = false;

process.argv.forEach((value, index, array) => {
	if (index > 1) {
		var pair = value.split(/=/);

		switch (pair[0]) {
			case 'render':
				render = true;
				break;
		}
	}
});

var newPicksPromise = () => {
	return new Promise((resolve, reject) => {
		fs.readFile('./picks.csv', (error, data) => {
			var csvLines = data.toString();

			var picks = [];

			csvLines.split(/\n/).forEach((csvLine, i) => {
				if (i == 0) {
					return;
				}

				var fields = csvLine.replace(/^\"/, '').replace(/\"$/, '').split(/","/);

				if (fields.length == 1) {
					return;
				}

				picks.push({
					number: parseInt(fields[0]),
					round: parseInt(fields[1]),
					owner: fields[2],
					origin: fields[4] ? fields[4] : 'From ' + fields[2]
				});
			});

			resolve(picks);
		});
	});
};

var newPlayersPromise = () => {
	return new Promise((resolve, reject) => {
		/*
		request
			.get(siteData.fantraxLink)
			.set('Cookie', process.env.FANTRAX_COOKIES)
			.then(response => {
				var csvLines = response.body.toString();
		*/

		fs.readFile('./players.csv', (error, data) => {
				var csvLines = data.toString();

				var players = [];

				csvLines.split(/\n/).forEach((csvLine, i) => {
					if (i == 0) {
						return;
					}

					// "ID","Player","Team","Position","Rk","Status","Roster Status","Age","Opponent","Contract","FPts","%D","ADP","Bye","Ros%"
					var fields = csvLine.replace(/^\"/, '').replace(/\"$/, '').split(/","/);

					var player = {
						id: fields[0],
						name: fields[1],
						owner: fields[5],
						positions: fields[3].split(/,/),
						salary: parseInt(fields[9]),
						contract: fields[10]
					};

					if (player.contract == 'TBA') {
						player.contract = 'unsigned';
					}
					else if (new Date().getFullYear() != process.env.SEASON && player.contract.split('/')[1] == season.toString().substring(2)) {
						player.contract = 'RFA rights';
					}

					players.push(player);
				});

				resolve(players);
			});
		}
	)
};

var teams = {};

newPlayersPromise().then((players) => {
	players.sort((a, b) => {
		if (a.name < b.name) {
			return -1;
		}
		else if (a.name > b.name) {
			return 1;
		}
		else {
			return 0;
		}
	});

	players.forEach((player) => {
		if (!teams[PSO.fantraxAbbreviations[player.owner]]) {
			teams[PSO.fantraxAbbreviations[player.owner]] = [];
		}

		teams[PSO.fantraxAbbreviations[player.owner]].push(player);
	});

	newPicksPromise().then((picks) => {
		picks.forEach((pick) => {
			pick.origin = pick.origin.substring(5);
		});

		if (render) {
			var pug = require('pug');
			var compiledPug = pug.compileFile('../views/trade.pug');

			fs.writeFileSync('../public/trade/index.html', compiledPug({
				franchises: Object.values(PSO.franchises).sort(),
				teams: teams,
				picks: picks,
				season: process.env.SEASON
			}));

			process.exit();
		}
	});
});
