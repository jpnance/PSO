var regularSeasonAllPlayMap = function() {
	var awayAllPlayPct = this.away.record.allPlay.cumulative.wins / (this.away.record.allPlay.cumulative.wins + this.away.record.allPlay.cumulative.losses);
	var homeAllPlayPct = this.home.record.allPlay.cumulative.wins / (this.home.record.allPlay.cumulative.wins + this.home.record.allPlay.cumulative.losses);

	emit(this.season + ' ' + this.away.name, { wins: this.away.record.allPlay.cumulative.wins, losses: this.away.record.allPlay.cumulative.losses, ties: this.away.record.allPlay.cumulative.ties, winPct: awayAllPlayPct });
	emit(this.season + ' ' + this.home.name, { wins: this.home.record.allPlay.cumulative.wins, losses: this.home.record.allPlay.cumulative.losses, ties: this.home.record.allPlay.cumulative.ties, winPct: homeAllPlayPct });
};

var regularSeasonAllPlayReduce = function(key, results) {
};

var regularSeasonAllPlayQuery = {
	type: 'regular',
	week: 14,
	'away.score': { '$exists': true },
	'home.score': { '$exists': true }
};

db.games.mapReduce(regularSeasonAllPlayMap, regularSeasonAllPlayReduce, { out: 'regularSeasonAllPlay', query: regularSeasonAllPlayQuery, sort: { season: 1, week: 1 } });
