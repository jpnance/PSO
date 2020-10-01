var highestScoringLossesMap = function() {
	var key = [this.season, this.week, this.winner.name, this.loser.name].join('-');

	emit(key, this.loser.score * (this.season < 2012 ? 0.1 : 1));
};

var highestScoringLossesReduce = function(key, results) {
	return results;
};

var highestScoringLossesQuery = {
	type: 'regular',
	'away.score': { '$exists': true },
	'home.score': { '$exists': true }
};

db.games.mapReduce(highestScoringLossesMap, highestScoringLossesReduce, { out: 'highestScoringLosses', query: highestScoringLossesQuery, sort: { season: 1, week: 1 } });
