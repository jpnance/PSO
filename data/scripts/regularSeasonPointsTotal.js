/*
	This totals the regular season points scored per season per franchise.
*/

var regularSeasonPointsTotalMap = function() {
	var awayPoints = this.away.score;
	var homePoints = this.home.score;

	if (this.season < 2012) {
		awayPoints /= 10;
		homePoints /= 10;
	}

	emit(this.season + ' ' + this.away.name, awayPoints);
	emit(this.season + ' ' + this.home.name, homePoints);
};

var regularSeasonPointsTotalReduce = function(key, results) {
	var total = 0;

	results.forEach(score => {
		total += score;
	});

	return total;
};

var regularSeasonPointsTotalQuery = {
	type: 'regular',
	'away.score': { '$exists': true },
	'home.score': { '$exists': true }
};

db.games.mapReduce(regularSeasonPointsTotalMap, regularSeasonPointsTotalReduce, { out: 'regularSeasonPointsTotal', query: regularSeasonPointsTotalQuery, sort: { season: 1, week: 1 } });
