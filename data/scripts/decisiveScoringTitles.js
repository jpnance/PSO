/*
	This displays the margin of victory in every game that involved a regular season weekly scoring title.

	I don't remember why I was interested in this.
*/

var decisiveScoringTitlesMap = function() {
	var awayScore = this.away.score;
	var homeScore = this.home.score;

	if (this.season < 2012) {
		awayScore /= 10;
		homeScore /= 10;
	}

	if (this.away.record.allPlay.week.losses == 0 || this.away.record.allPlay.week.losses == 1) {
		emit(this.season + '-' + this.week, { owner: this.away.name, score: awayScore });
	}

	if (this.home.record.allPlay.week.losses == 0 || this.home.record.allPlay.week.losses == 1) {
		emit(this.season + '-' + this.week, { owner: this.home.name, score: homeScore });
	}

};

var decisiveScoringTitlesReduce = function(key, results) {
	printjson(key);
	printjson(results);

	if (results.length > 1) {
		if (results[0].score > results[1].score) {
			return { owner: results[0].owner, score: results[0].score - results[1].score };
		}
		else {
			return { owner: results[1].owner, score: results[1].score - results[0].score };
		}
	}
};

var decisiveScoringTitlesQuery = {
	type: 'regular',
	'away.score': { '$exists': true },
	'home.score': { '$exists': true },
	'away.record': { '$exists': true },
	'home.record': { '$exists': true }
};

db.games.mapReduce(decisiveScoringTitlesMap, decisiveScoringTitlesReduce, { out: 'decisiveScoringTitles', query: decisiveScoringTitlesQuery, sort: { season: 1, week: 1 } });
