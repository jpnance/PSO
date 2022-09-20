var dotenv = require('dotenv').config({ path: '/app/.env' });

var request = require('superagent');

var PSO = require('../pso.js');

const siteData = {
	sheetLink: 'https://sheets.googleapis.com/v4/spreadsheets/1nas3AqWZtCu_UZIV77Jgxd9oriF1NQjzSjFWW86eong/values/',
};

var newSheetsPromise = function(season) {
	return new Promise(function(resolve, reject) {
		request
			.get(siteData.sheetLink + season + ' Draft')
			.query({ alt: 'json', key: process.env.GOOGLE_API_KEY })
			.then(response => {
				var dataJson = JSON.parse(response.text);

				var picks = [];

				dataJson.values.forEach((row, i) => {
					if (!row[3]) {
						picks.push({
							season: season,
							number: parseInt(row[0]),
							round: parseInt(row[1]),
							owner: row[2],
							origin: row[4],
							player: row[3]
						});
					}
				});

				resolve(picks);
			});
	});
};

var season = new Date().getFullYear();
var sheetsPromises = [];

[ season, season + 1, season + 2 ].forEach((year) => {
	sheetsPromises.push(newSheetsPromise(year));
});

Promise.all(sheetsPromises).then((values) => {
	var allPicks = [];

	values.forEach((picks) => {
		picks.forEach((pick) => {
			allPicks.push(pick);
		});
	});

	console.log(JSON.stringify(allPicks));
});
