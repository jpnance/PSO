var recordOccurrencesMap = function() {
	var homeRecord = this.home.record.straight.cumulative.wins + '-' + this.home.record.straight.cumulative.losses + '-' + this.home.record.straight.cumulative.ties;
	var awayRecord = this.away.record.straight.cumulative.wins + '-' + this.away.record.straight.cumulative.losses + '-' + this.away.record.straight.cumulative.ties;

	emit(homeRecord, { owners: [ this.season + ' ' + this.home.name ] });
	emit(awayRecord, { owners: [ this.season + ' ' + this.away.name ] });
};

var recordOccurrencesReduce = function(key, results) {
	var owners = [];

	results.forEach(owner => {
		owners = owners.concat(owner.owners);
	});

	return { owners: owners };
};

var recordOccurrencesQuery = {
	type: 'regular',
	'away.record': { '$exists': true },
	'home.record': { '$exists': true }
};

db.games.mapReduce(recordOccurrencesMap, recordOccurrencesReduce, { out: 'recordOccurrences', query: recordOccurrencesQuery, sort: { season: 1, week: 1 } });
