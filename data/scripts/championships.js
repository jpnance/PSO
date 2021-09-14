var championshipsMap = function() {
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

	var winnerKey = regimes[this.winner.name] || this.winner.name;

	emit(winnerKey, 1);
};

var championshipsReduce = function(key, results) {
	var championships = 0;

	results.forEach(result => {
		championships += result;
	});

	return championships;
};

var championshipsQuery = {
	'type': 'championship'
};

db.games.mapReduce(championshipsMap, championshipsReduce, { out: 'championships', query: championshipsQuery, sort: { season: 1, week: 1 } });
