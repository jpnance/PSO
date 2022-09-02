load('./regimes.js');

var regularSeasonWinningPercentageMap = function() {
	var winner, loser;

	if (this.away.score > this.home.score) {
		winner = this.away;
		loser = this.home;
	}
	else if (this.home.score > this.away.score) {
		winner = this.home;
		loser = this.away;
	}

	var winnerKey = regimes[this.winner.name] || this.winner.name;
	var loserKey = regimes[this.loser.name] || this.loser.name;

	emit(winnerKey, { wins: 1, losses: 0 });
	emit(loserKey, { wins: 0, losses: 1 });
};

var regularSeasonWinningPercentageReduce = function(key, results) {
	var record = { wins: 0, losses: 0 };

	results.forEach(result => {
		record.wins += result.wins;
		record.losses += result.losses;
	});

	return record;
};

var regularSeasonWinningPercentageFinalize = function(key, reduction) {
	return (reduction.wins / (reduction.wins + reduction.losses)).toFixed(3);
};

var regularSeasonWinningPercentageQuery = {
	type: 'regular',
	'away.score': { '$exists': true },
	'home.score': { '$exists': true }
};

db.games.mapReduce(
	regularSeasonWinningPercentageMap,
	regularSeasonWinningPercentageReduce,
	{
		out: 'regularSeasonWinningPercentage',
		query: regularSeasonWinningPercentageQuery,
		finalize: regularSeasonWinningPercentageFinalize,
		sort: {
			season: 1,
			week: 1
		},
		scope: {
			regimes: regimes
		}
	}
);
