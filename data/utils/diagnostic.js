var diagnosticMap = function() {
	emit(this.season, {
		total: 1,
		weeks: {
			1: this.week == 1 ? 1 : 0,
			2: this.week == 2 ? 1 : 0,
			3: this.week == 3 ? 1 : 0,
			4: this.week == 4 ? 1 : 0,
			5: this.week == 5 ? 1 : 0,
			6: this.week == 6 ? 1 : 0,
			7: this.week == 7 ? 1 : 0,
			8: this.week == 8 ? 1 : 0,
			9: this.week == 9 ? 1 : 0,
			10: this.week == 10 ? 1 : 0,
			11: this.week == 11 ? 1 : 0,
			12: this.week == 12 ? 1 : 0,
			13: this.week == 13 ? 1 : 0,
			14: this.week == 14 ? 1 : 0,
			15: this.week == 15 ? 1 : 0,
			16: this.week == 16 ? 1 : 0
		}
	})
};

var diagnosticReduce = function(key, results) {
	var games = {
		total: 0,
		weeks: {
			1: this.week == 1 ? 1 : 0,
			2: this.week == 2 ? 1 : 0,
			3: this.week == 3 ? 1 : 0,
			4: this.week == 4 ? 1 : 0,
			5: this.week == 5 ? 1 : 0,
			6: this.week == 6 ? 1 : 0,
			7: this.week == 7 ? 1 : 0,
			8: this.week == 8 ? 1 : 0,
			9: this.week == 9 ? 1 : 0,
			10: this.week == 10 ? 1 : 0,
			11: this.week == 11 ? 1 : 0,
			12: this.week == 12 ? 1 : 0,
			13: this.week == 13 ? 1 : 0,
			14: this.week == 14 ? 1 : 0,
			15: this.week == 15 ? 1 : 0,
			16: this.week == 16 ? 1 : 0
		}
	};

	if (results.length) {
		results.forEach(result => {
			games.total += result.total;

			Object.keys(result.weeks).forEach(week => {
				games.weeks[week] += result.weeks[week];
			});
		});
	}
	else {
		games = results;
	}

	return games;
};

var diagnosticQuery = {
};

db.games.mapReduce(diagnosticMap, diagnosticReduce, { out: 'diagnostic', query: diagnosticQuery, sort: { season: 1, week: 1 } });
