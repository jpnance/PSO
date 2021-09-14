var seasonSummariesMap = function() {
	['away', 'home'].forEach((ownerType) => {
		//var seasonOwner = { season: this.season, this[ownerType].name };
		var seasonOwner = this.season + ' ' + this[ownerType].name;
		var data = {
			records: [ this[ownerType].record.straight.cumulative.wins + '-' + this[ownerType].record.straight.cumulative.losses + '-' + this[ownerType].record.straight.cumulative.ties ],
			playoffs: this.type == 'semifinal',
			titleGame: this.type == 'championship',
			champion: this.type == 'championship' && this.winner.name == this[ownerType].name
		};

		emit(seasonOwner, data);
	});
};

var seasonSummariesReduce = function(key, results) {
	var sumReducer = (a, b) => parseInt(a) + parseInt(b);

	var seasonSummary = { records: [], playoffs: false, titleGame: false, champion: false };

	results.forEach((result) => {
		result.records.forEach((record) => {
			seasonSummary.records.push(record);
		});

		if (result.playoffs) {
			seasonSummary.playoffs = true;
		}

		if (result.titleGame) {
			seasonSummary.titleGame = true;
		}

		if (result.champion) {
			seasonSummary.champion = true;
		}
	});

	seasonSummary.records.sort((a, b) => {
		var aGames = a.split('-').reduce(sumReducer);
		var bGames = b.split('-').reduce(sumReducer);

		return a - b;
	});

	return seasonSummary;
};

var seasonSummariesQuery = {
	'away.score': { '$exists': true },
	'home.score': { '$exists': true }
};

db.games.mapReduce(seasonSummariesMap, seasonSummariesReduce, { out: 'seasonSummaries', query: seasonSummariesQuery, sort: { season: 1, week: 1 } });
