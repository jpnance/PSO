var flukyGamesMap = function() {
	if (this.away.record.straight.week.losses == 1 && this.away.record.allPlay.week.wins > this.away.record.allPlay.week.losses) {
		emit(this.season + ' ' + this.away.name, { wins: 0, losses: 1 });
	}
	else if (this.away.record.straight.week.wins == 1 && this.away.record.allPlay.week.wins < this.away.record.allPlay.week.losses) {
		emit(this.season + ' ' + this.away.name, { wins: 1, losses: 0 });
	}

	if (this.home.record.straight.week.losses == 1 && this.home.record.allPlay.week.wins > this.home.record.allPlay.week.losses) {
		emit(this.season + ' ' + this.home.name, { wins: 0, losses: 1 });
	}
	else if (this.home.record.straight.week.wins == 1 && this.home.record.allPlay.week.wins < this.home.record.allPlay.week.losses) {
		emit(this.season + ' ' + this.home.name, { wins: 1, losses: 0 });
	}
};

var flukyGamesReduce = function(key, results) {
	var games = { wins: 0, losses: 0 };

	results.forEach(result => {
		games.wins += result.wins;
		games.losses += result.losses;
	});

	return games;
};

var flukyGamesQuery = {
	type: 'regular',
	'away.score': { '$exists': true },
	'home.score': { '$exists': true }
};

db.games.mapReduce(flukyGamesMap, flukyGamesReduce, { out: 'flukyGames', query: flukyGamesQuery, sort: { season: 1, week: 1 } });
