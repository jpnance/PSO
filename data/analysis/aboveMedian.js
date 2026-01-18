var aboveMedianMap = function() {
	if (this.away.record.allPlay.week.wins > this.away.record.allPlay.week.losses) {
		emit(this.season + ' ' + this.away.name, 1);
	}

	if (this.home.record.allPlay.week.wins > this.home.record.allPlay.week.losses) {
		emit(this.season + ' ' + this.home.name, 1);
	}
};

var aboveMedianReduce = function(key, results) {
	var games = 0;

	results.forEach(result => {
		games += result;
	});

	return games;
};

var aboveMedianQuery = {
	type: 'regular',
	'away.score': { '$exists': true },
	'home.score': { '$exists': true }
};

db.games.mapReduce(aboveMedianMap, aboveMedianReduce, { out: 'aboveMedian', query: aboveMedianQuery, sort: { season: 1, week: 1 } });
