var totalMatchupScoreMap = function() {
	var totalMatchupScore = this.away.score + this.home.score;

	if (this.season < 2012) {
		totalMatchupScore /= 10;
	}

	emit(this.season + '-' + this.week + '-' + this.away.name + '-' + this.home.name, { type: this.type, total: totalMatchupScore });
};

var totalMatchupScoreReduce = function(key, results) {
};

var totalMatchupScoreQuery = {
	'away.score': { '$exists': true },
	'home.score': { '$exists': true }
};

db.games.mapReduce(totalMatchupScoreMap, totalMatchupScoreReduce, { out: 'totalMatchupScore', query: totalMatchupScoreQuery, sort: { season: 1, week: 1 } });
