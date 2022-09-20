var dotenv = require('dotenv').config({ path: '/app/.env' });

var request = require('superagent');

var PSO = require('../pso.js');

const siteData = {
	sheetLink: 'https://sheets.googleapis.com/v4/spreadsheets/1nas3AqWZtCu_UZIV77Jgxd9oriF1NQjzSjFWW86eong/values/Cash',
};

var newSheetsPromise = function() {
	return new Promise(function(resolve, reject) {
		request
			.get(siteData.sheetLink)
			.query({ alt: 'json', key: process.env.GOOGLE_API_KEY })
			.then(response => {
				var dataJson = JSON.parse(response.text);

				var cash = [];
				var owners = [];
				var season = null;

				dataJson.values.forEach((row, i) => {
					if (i == 0) {
						row.forEach((value, i) => {
							if (i == 0 || i == 1) {
								return;
							}
							else {
								owners.push(value);
							}
						});
					}

					if (row.includes('Buy-outs')) {
						season = parseInt(row[0]);
					}

					if (row.includes('Remaining')) {
						row.forEach((value, i) => {
							if (i == 0 || i == 1) {
								return;
							}
							else {
								cash.push({
									season: season,
									owner: owners[i],
									remaining: parseInt(row[i].replace('$', ''))
								});
							}
						});
					}
				});

				resolve(cash);
			});
	});
};

newSheetsPromise().then((cash) => {
	console.log(JSON.stringify(cash));
});
