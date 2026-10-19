var dotenv = require('dotenv').config({ path: '/app/.env' });

var fs = require('fs');
var path = require('path');
var request = require('superagent');

var PSO = require('../../config/pso.js');

const siteData = {
	pso: {
		staticPositions: ['QB', 'RB', 'WR', 'TE', 'DL', 'LB', 'DB', 'K'],
		sheetLink: 'https://sheets.googleapis.com/v4/spreadsheets/1nas3AqWZtCu_UZIV77Jgxd9oriF1NQjzSjFWW86eong/values/Rostered',
		dataRetrievalFunction: newSleeperJsonPromise,
	},
	colbys: {
		staticPositions: ['PG', 'SG', 'SF', 'PF', 'C'],
		sheetLink: 'https://sheets.googleapis.com/v4/spreadsheets/16SHgSkREFEYmPuLg35KDSIdJ72MrEkYb1NKXSaoqSTc/values/Rostered',
		fantraxLink: 'https://www.fantrax.com/fxpa/downloadPlayerStats?leagueId=' + PSO.fantraxLeagueId + '&statusOrTeamFilter=ALL',
		colbysCsvPath: path.join(__dirname, '../../prep/colbys.csv'),
		dataRetrievalFunction: newFantraxPromise,
	}
};

function fantraxGet(url) {
	return request
		.get(url)
		.set('Cookie', process.env.FANTRAX_COOKIES || '')
		.set('User-Agent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36')
		.set('Accept', 'text/csv,text/plain,*/*')
		.set('Referer', 'https://www.fantrax.com/fantasy/league/' + PSO.fantraxLeagueId + '/players');
}

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

function newSleeperJsonPromise(players) {
	return new Promise(function(resolve, reject) {
		var sleeperData = Object.values(require('../../public/data/sleeper-data.json')).filter((sleeperPlayerData) => sleeperPlayerData.active);

		var mergedPlayers = [];

		players.forEach((player) => {
			var sleeperPlayer = sleeperData.filter((sleeperPlayerData) => {
				return sleeperPlayerData.search_full_name == player.name.replace(/[\. '-]/g, '').toLowerCase() && sleeperPlayerData.fantasy_positions.includes(player.positions[0]);
			});

			if (sleeperPlayer.length == 1) {
				mergedPlayers.push({
					name: player.name,
					positions: sleeperPlayer[0].fantasy_positions,
				});
			}
			else {
				console.error(player);
				console.error(player.name.replace(/[\. '-]/g, '').toLowerCase());
				console.error(sleeperPlayer.filter((sp) => sp.search_full_name == 'chrisjones'));

				process.exit();
			}
		});

		resolve(mergedPlayers);
	});
}

function applyFantraxCsvToPlayers(players, csvText) {
	csvText.trim().split(/\n/).forEach((csvLine, i) => {
		if (i == 0) {
			return;
		}

		var fields = csvLine.replace(/^\"/, '').split(/","/);

		var name = fields[1];
		var positions = fields[3].split(/,/);

		var playersWithName = players.filter(player => nameToId(player.name) == nameToId(name));

		if (playersWithName.length > 1) {
			return;
		}

		var player = playersWithName[0];

		if (player) {
			player.positions = positions.filter(position => siteData[parameters.site].staticPositions.includes(position));
		}
	});

	return players;
}

function loadColbysCsvFallback(players) {
	var csvPath = siteData.colbys.colbysCsvPath;

	if (!fs.existsSync(csvPath)) {
		return Promise.reject(new Error('Fantrax blocked the download and ' + csvPath + ' is missing. Export Players CSV from Fantrax into prep/colbys.csv.'));
	}

	applyFantraxCsvToPlayers(players, fs.readFileSync(csvPath, 'utf8'));
	return Promise.resolve(players);
}

function newFantraxPromise(players) {
	return fantraxGet(siteData[parameters.site].fantraxLink)
		.then(response => {
			var csvLines = (response.text || response.body || '').toString();
			return applyFantraxCsvToPlayers(players, csvLines);
		})
		.catch(function(err) {
			if (parameters.site !== 'colbys') {
				throw err;
			}

			var status = err.status || (err.response && err.response.status);
			var isCloudflare = status === 403 || (err.response && err.response.text && err.response.text.includes('Just a moment'));

			if (isCloudflare) {
				console.error('Fantrax returned Cloudflare challenge; falling back to prep/colbys.csv');
			}
			else {
				console.error('Fantrax download failed (' + (status || 'unknown') + '); falling back to prep/colbys.csv');
			}

			return loadColbysCsvFallback(players);
		});
}

function newSheetsPromise(fantraxId) {
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

				if (parameters.site == 'pso') {
					rows.shift();
				}

				rows.shift();

				if (parameters.site == 'pso') {
					rows.pop();
				}

				rows.forEach((row, i) => {
					players.push({ row: i, name: row[1], positions: row[2].split('/') });
				});

				resolve(players);
			});
	});
}

function nameToId(name) {
	return name.toLowerCase().replace(/[^a-z]/g, '');
}

function positionSort(a, b) {
	return siteData[parameters.site].staticPositions.indexOf(a) - siteData[parameters.site].staticPositions.indexOf(b);
}

newSheetsPromise().then(players => {
	return siteData[parameters.site].dataRetrievalFunction(players);
}).then(players => {
	players.forEach(player => {
		if (player.positions) {
			console.log(player.positions.sort(positionSort).join('/'));
		}
		else {
			console.log('???');
		}
	});
}).catch(function(err) {
	console.error(err.message || err);
	process.exit(1);
});
