var lowestScoringWinsMap = function() {
	var key = [this.season, this.week, this.winner.name, this.loser.name].join('-');

	emit(key, this.winner.score * (this.season < 2012 ? 0.1 : 1));
};

var lowestScoringWinsReduce = function(key, results) {
	return results;
};

var lowestScoringWinsQuery = {
	type: 'regular',
	'away.score': { '$exists': true },
	'home.score': { '$exists': true }
};

db.games.mapReduce(lowestScoringWinsMap, lowestScoringWinsReduce, { out: 'lowestScoringWins', query: lowestScoringWinsQuery, sort: { season: 1, week: 1 } });
