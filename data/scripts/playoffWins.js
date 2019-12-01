var playoffWinsMap = function() {
	var regimes = {
		'Charles': 'James/Charles',
		'Jake/Luke': 'Brett/Luke',
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
	else {
		// let's just pretend this didn't happen for now
		return;
	}

	var winnerKey = regimes[winner.name] || winner.name;
	var loserKey = regimes[loser.name] || loser.name;

	// this bit is just to make sure all regimes show up, even if they haven't made the playoffs
	if (['semifinal', 'thirdPlace', 'championship'].includes(this.type)) {
		emit(winnerKey, 1);
	}
	else {
		emit(winnerKey, 0);
	}

	emit(loserKey, 0);
};

var playoffWinsReduce = function(key, results) {
	var wins = 0;

	results.forEach(result => {
		wins += result;
	});

	return wins;
};

var playoffWinsQuery = {
	'week': { '$gt': 14 },
	'away.score': { '$exists': true },
	'home.score': { '$exists': true }
};

db.games.mapReduce(playoffWinsMap, playoffWinsReduce, { out: 'playoffWins', query: playoffWinsQuery, sort: { season: 1, week: 1 } });
