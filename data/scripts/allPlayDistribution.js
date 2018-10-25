var allPlayDistroMap = function() {
	var winner, loser;

	if (this.away.score > this.home.score) {
		winner = this.away;
		loser = this.home;
	}
	else if (this.home.score > this.away.score) {
		winner = this.home;
		loser = this.away;
	}

	var winnerRecord = winner.record.allPlay.week.wins + '-' + winner.record.allPlay.week.losses + '-' + winner.record.allPlay.week.ties;
	var loserRecord = loser.record.allPlay.week.wins + '-' + loser.record.allPlay.week.losses + '-' + loser.record.allPlay.week.ties;

	emit(winnerRecord, { wins: 1, losses: 0, ties: 0 });
	emit(loserRecord, { wins: 0, losses: 1, ties: 0 });
};

var allPlayDistroReduce = function(key, results) {
	var wins = 0;
	var losses = 0;

	results.forEach(result => {
		wins += result.wins;
		losses += result.losses;
	});

	return { wins: wins, losses: losses, ties: 0 };
};

var allPlayDistroQuery = {
	type: 'regular',
	'away.score': { '$exists': true },
	'home.score': { '$exists': true }
};

db.games.mapReduce(allPlayDistroMap, allPlayDistroReduce, { out: 'allPlayDistro', query: allPlayDistroQuery, sort: { season: 1, week: 1 } });
