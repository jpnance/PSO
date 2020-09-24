var marginOfVictoryMap = function() {
	var key = [this.season, this.week, this.winner.name, this.loser.name].join('-');

	emit(key, Math.abs(this.home.score - this.away.score) * (this.season < 2012 ? 0.1 : 1));
};

var marginOfVictoryReduce = function(key, results) {
	return results;
};

var marginOfVictoryQuery = {
	type: 'regular',
	'away.score': { '$exists': true },
	'home.score': { '$exists': true }
};

db.games.mapReduce(marginOfVictoryMap, marginOfVictoryReduce, { out: 'marginOfVictory', query: marginOfVictoryQuery, sort: { season: 1, week: 1 } });
