var dotenv = require('dotenv').config({ path: __dirname + '/../.env' });

var request = require('superagent');

var PSO = require('../pso.js');

const staticPositions = ['PG', 'SG', 'SF', 'PF', 'C'];

var newFantraxPromise = function(players) {
	return new Promise(function(resolve, reject) {
		request
			.get('https://www.fantrax.com/fxpa/downloadPlayerStats?leagueId=gxejd020khl7ipoo&pageNumber=1&view=STATS&positionOrGroup=BASKETBALL_PLAYER&seasonOrProjection=PROJECTION_0_41b_SEASON&timeframeTypeCode=YEAR_TO_DATE&transactionPeriod=1&miscDisplayType=1&sortType=SCORE&maxResultsPerPage=20&statusOrTeamFilter=ALL&scoringCategoryType=5&timeStartType=PERIOD_ONLY&schedulePageAdj=0&searchName=&datePlaying=ALL&startDate=2020-12-22&endDate=2021-05-17&teamId=dyoukhkjkhl7n5o9')
			.set('Cookie', process.env.FANTRAX_COOKIES)
			.then(response => {
				var csvLines = response.body.toString();

				csvLines.split(/\n/).forEach(csvLine => {
					var fields = csvLine.replace(/^\"/, '').split(/","/);

					var name = fields[0];
					var team = fields[1];
					var positions = fields[2].split(/,/);

					var player = players.find(player => nameToId(player.name) == nameToId(name));

					if (player) {
						player.team = team;
						player.position = positions.filter(position => staticPositions.includes(position));
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
			.get('https://spreadsheets.google.com/feeds/cells/16SHgSkREFEYmPuLg35KDSIdJ72MrEkYb1NKXSaoqSTc/2/public/full?alt=json')
			.then(response => {
				var dataJson = JSON.parse(response.text);
				var cells = dataJson.feed.entry;

				var players = [];

				cells.forEach(cell => {
					if (cell.gs$cell.col == '3' && cell.gs$cell.row != '1') {
						players.push({ name: cell.content.$t });
					}
				});

				resolve(players);
			});
	});
};

var nameToId = function(name) {
	return name.toLowerCase().replace(/[^a-z]/g, '');
};

var positionSort = function(a, b) {
	return staticPositions.indexOf(a) - staticPositions.indexOf(b);
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
