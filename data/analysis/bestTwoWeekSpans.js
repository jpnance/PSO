var dotenv = require('dotenv').config({ path: '/app/.env' });

var mongoose = require('mongoose');
mongoose.Promise = global.Promise;
mongoose.connect(process.env.MONGODB_URI);

var Game = require('../models/Game');

Game.find({ season: { '$gte': 2012 }, type: { '$in': ['regular', 'semifinal', 'thirdPlace', 'championship'] }, winner: { '$exists': true } }).sort({ week: 1 }).then(games => {
	var scores = games.reduce(extractIndividualScores, []);
	//var twoWeekSpans = [ { name: 'KoMu', season: 2024, weeks: '14 & 15', score: 412.4 } ];

	var twoWeekSpans = [];

	scores.forEach(thisWeekScore => {
		if (thisWeekScore.week == 1) {
			return;
		}
		else {
			var lastWeekScore = scores.find(score => score.season == thisWeekScore.season && score.week == thisWeekScore.week - 1 && score.owner == thisWeekScore.owner);

			twoWeekSpans.push({
				season: thisWeekScore.season,
				weeks: `${weekNameInSeason(lastWeekScore.week, lastWeekScore.type)} & ${weekNameInSeason(thisWeekScore.week, thisWeekScore.type)}`,
				owner: thisWeekScore.owner,
				points: lastWeekScore.points + thisWeekScore.points
			});
		}
	});

	twoWeekSpans.sort((a, b) => b.points - a.points);

	console.log(JSON.stringify(twoWeekSpans, null, '\t'));
	//console.log(JSON.stringify(twoWeekSpans.filter(span => !span.weeks.match(/Semifinal/)), null, '\t')); // regular season only
	//console.log(JSON.stringify(twoWeekSpans.filter(span => span.weeks.match(/^Semifinal/)), null, '\t')); // playoffs only
	mongoose.disconnect();
});

function extractIndividualScores(scores, game) {
	['away', 'home'].forEach(side => {
		scores.push({
			season: game.season,
			week: game.week,
			type: game.type,
			owner: game[side].name,
			points: game[side].score
		});
	});

	return scores;
}

function weekNameInSeason(week, type) {
	if (type == 'regular') {
		return week;
	}
	else if (type == 'semifinal') {
		return 'Semifinals';
	}
	else if (type == 'thirdPlace') {
		return 'Third Place Game';
	}
	else if (type == 'championship') {
		return 'Championship';
	}
}
