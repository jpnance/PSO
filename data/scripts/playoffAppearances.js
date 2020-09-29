var playoffAppearancesMap = function() {
	var regimes = {
		'Charles': 'James/Charles',
		'Brett/Luke': 'Luke',
		'Jake/Luke': 'Luke',
		'John': 'John/Zach',
		'Koci': 'Koci/Mueller',
		'Pat/Quinn': 'Patrick',
		'Schex/Jeff': 'Schex',
		'Schexes': 'Schex',
		'Syed': 'Syed/Kuan',
		'Syed/Terence': 'Syed/Kuan'
	};

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
	'week': { '$gt': 14 },
	'type': 'semifinal'
};

db.games.mapReduce(playoffAppearancesMap, playoffAppearancesReduce, { out: 'playoffAppearances', query: playoffAppearancesQuery, sort: { season: 1, week: 1 } });
