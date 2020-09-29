var weeklyScoringTitlesMap = function() {
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

	var winner, loser;

	if (this.away.score > this.home.score) {
		winner = this.away;
		loser = this.home;
	}
	else if (this.home.score > this.away.score) {
		winner = this.home;
		loser = this.away;
	}

	if (winner.record.allPlay.week.losses == 0) {
		var key = regimes[winner.name] || winner.name;

		emit(key, 1);
	}
};

var weeklyScoringTitlesReduce = function(key, results) {
	var scoringTitles = 0;

	results.forEach(result => {
		scoringTitles += result;
	});

	return scoringTitles;
};

var weeklyScoringTitlesQuery = {
	type: 'regular',
	'away.score': { '$exists': true },
	'home.score': { '$exists': true }
};

db.games.mapReduce(weeklyScoringTitlesMap, weeklyScoringTitlesReduce, { out: 'weeklyScoringTitles', query: weeklyScoringTitlesQuery, sort: { season: 1, week: 1 } });
