var dotenv = require('dotenv').config({ path: '../.env' });

var render = false;

process.argv.forEach(function(value, index, array) {
	if (index > 1) {
		var pair = value.split(/=/);

		switch (pair[0]) {
			case 'render':
				render = true;
				break;
		}
	}
});

var defaultSeason = parseInt(process.env.SEASON) + 1;
var salaries = {
	'2023': { 'DB': 2, 'DL': 2, 'K': 2, 'LB': 1, 'QB': 30, 'RB': 25, 'TE': 14, 'WR': 16 },
	'2022': { 'DB': 1, 'DL': 2, 'K': 2, 'LB': 1, 'QB': 37, 'RB': 25, 'TE': 8, 'WR': 16 },
	'2021': { 'DB': 1, 'DL': 2, 'K': 1, 'LB': 1, 'QB': 29, 'RB': 25, 'TE': 5, 'WR': 16 },
	'2020': { 'DB': 2, 'DL': 1, 'K': 1, 'LB': 1, 'QB': 32, 'RB': 25, 'TE': 7, 'WR': 16 },
	'2019': { 'DB': 1, 'DL': 2, 'K': 1, 'LB': 1, 'QB': 38, 'RB': 25, 'TE': 10, 'WR': 16 },
	'2018': { 'DB': 2, 'DL': 3, 'K': 2, 'LB': 2, 'QB': 28, 'RB': 25, 'TE': 14, 'WR': 18 },
	'2017': { 'DB': 2, 'DL': 2, 'K': 2, 'LB': 1, 'QB': 31, 'RB': 24, 'TE': 17, 'WR': 18 },
	'2016': { 'DB': 2, 'DL': 3, 'K': 1, 'LB': 2, 'QB': 32, 'RB': 25, 'TE': 15, 'WR': 17 },
	'2015': { 'DB': 2, 'DL': 3, 'K': 1, 'LB': 1, 'QB': 24, 'RB': 27, 'TE': 15, 'WR': 17 },
	'2014': { 'DB': 2, 'DL': 2, 'K': 2, 'LB': 1, 'QB': 19, 'RB': 24, 'TE': 28, 'WR': 19 },
	'2013': { 'DB': 2, 'DL': 3, 'K': 1, 'LB': 2, 'QB': 17, 'RB': 26, 'TE': 18, 'WR': 18 },
	'2012': { 'DB': 1, 'DL': 1, 'K': 1, 'LB': 1, 'QB': 25, 'RB': 25, 'TE': 7, 'WR': 16 },
	'2011': { 'DB': 1, 'DL': 1, 'K': 1, 'LB': 2, 'QB': 25, 'RB': 25, 'TE': 3, 'WR': 26 },
	'2010': { 'DB': 1, 'DL': 2, 'K': 1, 'LB': 2, 'QB': 24, 'RB': 28, 'TE': 4, 'WR': 15 }
};

if (render) {
	var fs = require('fs');
	var pug = require('pug');
	var compiledPug = pug.compileFile('../views/rookies.pug');
	fs.writeFileSync('../public/rookies/index.html', compiledPug({ season: defaultSeason, salaries: salaries }));
}
