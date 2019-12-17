var playoffMarginsMap = function() {
	var winner, loser;

	if (this.away.score > this.home.score) {
		winner = this.away;
		loser = this.home;
	}
	else if (this.home.score > this.away.score) {
		winner = this.home;
		loser = this.away;
	}

	var key = [this.season, this.type, this.winner.name, this.loser.name].join('-');
	emit(key, {
		winner: {
			name: winner.name,
			score: winner.score
		},
		loser: {
			name: loser.name,
			score: loser.score
		},
		margin: Math.abs(winner.score - loser.score) / (this.season < 2012 ? 10 : 1)
	});
};

var playoffMarginsReduce = function(key, results) {
};

var playoffMarginsQuery = {
	'week': { '$gt': 14 },
	'type': { '$in': [ 'semifinal', 'thirdPlace', 'championship' ] },
	'away.score': { '$exists': true },
	'home.score': { '$exists': true }
};

db.games.mapReduce(playoffMarginsMap, playoffMarginsReduce, { out: 'playoffMargins', query: playoffMarginsQuery, sort: { season: 1, week: 1 } });
