var regularSeasonWinsMap = function() {
	var winner, loser;

	if (this.away.score > this.home.score) {
		winner = this.away;
		loser = this.home;
	}
	else if (this.home.score > this.away.score) {
		winner = this.home;
		loser = this.away;
	}

	emit(this.winner.franchiseId, 1);
};

var regularSeasonWinsReduce = function(key, results) {
	var wins = 0;

	results.forEach(result => {
		wins += result;
	});

	return wins;
};

var regularSeasonWinsQuery = {
	type: 'regular',
	'away.score': { '$exists': true },
	'home.score': { '$exists': true }
};

db.games.mapReduce(regularSeasonWinsMap, regularSeasonWinsReduce, { out: 'regularSeasonWins', query: regularSeasonWinsQuery, sort: { season: 1, week: 1 } });
