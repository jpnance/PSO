var dotenv = require('dotenv').config({ path: __dirname + '/../.env' });

var request = require('superagent');

var PSO = require('../pso.js');

const siteData = {
	sheetLink: 'https://sheets.googleapis.com/v4/spreadsheets/1nas3AqWZtCu_UZIV77Jgxd9oriF1NQjzSjFWW86eong/values/Rostered',
};


var newSheetsPromise = function() {
	return new Promise(function(resolve, reject) {
		request
			.get(siteData.sheetLink)
			.query({ alt: 'json', key: process.env.GOOGLE_API_KEY })
			.then(response => {
				var dataJson = JSON.parse(response.text);

				var players = [];

				dataJson.values.forEach((row, i) => {
					if (i < 2 || i == dataJson.values.length - 1) {
						return;
					}

					players.push({
						owner: row[0],
						name: row[1],
						positions: row[2].split('/'),
						start: parseInt(row[3]) || 'FA',
						end: parseInt(row[4]),
						salary: row[5] ? parseInt(row[5].replace('$', '')) : null
					});
				});

				resolve(players);
			});
	});
};

newSheetsPromise().then((players) => {
	console.log(JSON.stringify(players));
});
