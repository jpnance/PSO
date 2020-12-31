/*
	This script just sums up all of the points scored in each regular season.
*/

var aggregateRegularSeasonPointsTotalMap = function() {
	var awayPoints = this.away.score;
	var homePoints = this.home.score;

	if (this.season < 2012) {
		awayPoints /= 10;
		homePoints /= 10;
	}

	emit(this.season, awayPoints + homePoints);
};

var aggregateRegularSeasonPointsTotalReduce = function(key, results) {
	var total = 0;

	results.forEach(score => {
		total += score;
	});

	return total;
};

var aggregateRegularSeasonPointsTotalQuery = {
	type: 'regular',
	'away.score': { '$exists': true },
	'home.score': { '$exists': true }
};

db.games.mapReduce(aggregateRegularSeasonPointsTotalMap, aggregateRegularSeasonPointsTotalReduce, { out: 'aggregateRegularSeasonPointsTotal', query: aggregateRegularSeasonPointsTotalQuery, sort: { season: 1, week: 1 } });
