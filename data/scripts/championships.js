load('./regimes.js');

var championshipsMap = function() {
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

db.games.mapReduce(
	championshipsMap,
	championshipsReduce,
	{
		out: 'championships',
		query: championshipsQuery,
		sort: {
			season: 1,
			week: 1
		},
		scope: {
			regimes: regimes
		}
	}
);
