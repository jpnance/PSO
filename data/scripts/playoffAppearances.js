load('./regimes.js');

var playoffAppearancesMap = function() {
	var awayKey = regimes[this.away.name] || this.away.name;
	var homeKey = regimes[this.home.name] || this.home.name;

	emit(awayKey, 1);
	emit(homeKey, 1);
};

var playoffAppearancesReduce = function(key, results) {
	var appearances = 0;

	results.forEach(result => {
		appearances += result;
	});

	return appearances;
};

var playoffAppearancesQuery = {
	'type': 'semifinal'
};

db.games.mapReduce(
	playoffAppearancesMap,
	playoffAppearancesReduce,
	{
		out: 'playoffAppearances',
		query: playoffAppearancesQuery,
		sort: {
			season: 1,
			week: 1
		},
		scope: {
			regimes: regimes
		},
	}
);
