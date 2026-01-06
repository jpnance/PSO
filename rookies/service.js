var positionOrder = ['QB', 'RB', 'WR', 'TE', 'DL', 'LB', 'DB', 'K'];

var salaries = {
	'2026': { 'DB': 2, 'DL': 2, 'K': 1, 'LB': 1, 'QB': 40, 'RB': 20, 'TE': 11, 'WR': 17 },
	'2025': { 'DB': 2, 'DL': 2, 'K': 1, 'LB': 1, 'QB': 44, 'RB': 21, 'TE': 9, 'WR': 16 },
	'2024': { 'DB': 2, 'DL': 2, 'K': 1, 'LB': 1, 'QB': 40, 'RB': 23, 'TE': 9, 'WR': 16 },
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
	'2010': { 'DB': 1, 'DL': 2, 'K': 1, 'LB': 2, 'QB': 24, 'RB': 28, 'TE': 4, 'WR': 15 },
	'2009': { 'DB': 13, 'DL': 14, 'K': 3, 'LB': 14, 'QB': 125, 'RB': 271, 'TE': 53, 'WR': 138 }
};

var seasons = Object.keys(salaries).sort((a, b) => b - a);

function computeSalary(season, firstRoundValue, round) {
	if (season <= 2009) {
		// Linear decay: 100% in round 1 down to 10% in round 10
		return Math.ceil(firstRoundValue * (11 - round) / 10);
	} else {
		// Exponential halving: value / 2^(round-1)
		return Math.ceil(firstRoundValue / Math.pow(2, round - 1));
	}
}

exports.rookieSalaries = function(request, response) {
	var defaultSeason = seasons[0];
	var requestedSeason = request.query.season || defaultSeason;
	
	// Validate requested season exists
	if (!salaries[requestedSeason]) {
		requestedSeason = defaultSeason;
	}
	
	// Current year as quick pill, rest in "Older" dropdown
	var quickSeasons = [seasons[0]];
	var olderSeasons = seasons.slice(1);
	
	response.render('rookies', {
		pageTitle: requestedSeason + ' Rookie Salaries',
		activePage: 'rookies',
		season: requestedSeason,
		salaries: salaries,
		seasons: seasons,
		quickSeasons: quickSeasons,
		olderSeasons: olderSeasons,
		positionOrder: positionOrder,
		computeSalary: computeSalary
	});
};
