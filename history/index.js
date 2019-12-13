var dotenv = require('dotenv').config({ path: '../.env' });

var mongoose = require('mongoose');
mongoose.Promise = global.Promise;
mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });

var Game = require('../models/Game');

process.argv.forEach(function(value, index, array) {
	if (index > 1) {
		var pair = value.split(/=/);

		switch (pair[0]) {
			case 'render':
				render = true;
				break;
		}
	}
});

var average = (scores) => {
	var sum = 0;

	scores.forEach(score => {
		sum += score;
	});

	return sum / scores.length;
};

var stdev = (scores, average) => {
	var variance = 0;

	scores.forEach(score => {
		variance += Math.pow(score - average, 2);
	});

	return Math.sqrt(variance / (scores.length - 1));
};

Game.find().sort({ season: 1, week: 1 }).then(games => {
	var franchises = {};
	var history = {};
	var owners = {};
	var leaders = {
		regularSeasonWins: {
			description: 'Regular Season Wins',
			franchiseIds: {}
		},
		weeklyScoringTitles: {
			description: 'Weekly Scoring Titles',
			franchiseIds: {}
		}
	};
	var stats = [];

	games.forEach(game => {
		if (!franchises[game.season]) {
			franchises[game.season] = {};
		}

		if (!franchises[game.season][game.away.franchiseId]) {
			franchises[game.season][game.away.franchiseId] = game.away.name;
		}

		if (!franchises[game.season][game.home.franchiseId]) {
			franchises[game.season][game.home.franchiseId] = game.home.name;
		}

		if (!history[game.season]) {
			history[game.season] = {};
		}

		if (!history[game.season][game.week]) {
			history[game.season][game.week] = {};
		}

		if (!history[game.season][game.week][game.away.franchiseId]) {
			history[game.season][game.week][game.away.franchiseId] = {
				franchise: game.away,
				opponent: game.home,
				type: game.type
			};
		}

		if (!history[game.season][game.week][game.home.franchiseId]) {
			history[game.season][game.week][game.home.franchiseId] = {
				franchise: game.home,
				opponent: game.away,
				type: game.type
			};
		}

		if (!owners[game.season]) {
			owners[game.season] = {};
		}

		if (!owners[game.season][game.away.franchiseId]) {
			owners[game.season][game.away.franchiseId] =  { name: game.away.name, playoffs: null };
		}

		if (!owners[game.season][game.home.franchiseId]) {
			owners[game.season][game.home.franchiseId] = { name: game.home.name, playoffs: null };
		}

		if (!leaders.regularSeasonWins.franchiseIds[game.away.franchiseId]) {
			leaders.regularSeasonWins.franchiseIds[game.away.franchiseId] = 0;
		}

		if (!leaders.regularSeasonWins.franchiseIds[game.home.franchiseId]) {
			leaders.regularSeasonWins.franchiseIds[game.home.franchiseId] = 0;
		}

		if (!leaders.weeklyScoringTitles.franchiseIds[game.away.franchiseId]) {
			leaders.weeklyScoringTitles.franchiseIds[game.away.franchiseId] = 0;
		}

		if (!leaders.weeklyScoringTitles.franchiseIds[game.home.franchiseId]) {
			leaders.weeklyScoringTitles.franchiseIds[game.home.franchiseId] = 0;
		}

		if (!stats[game.season]) {
			stats[game.season] = {
				franchises: [],
				weeks: [],
				total: {
					scores: [],
					average: null,
					stdev: null
				}
			}
		}

		if (!stats[game.season].weeks[game.week]) {
			stats[game.season].weeks[game.week] = { scores: [], average: null, stdev: null };
		}

		if (!stats[game.season].franchises[game.away.franchiseId]) {
			stats[game.season].franchises[game.away.franchiseId] = { scores: [], average: null, stdev: null };
		}

		if (!stats[game.season].franchises[game.home.franchiseId]) {
			stats[game.season].franchises[game.home.franchiseId] = { scores: [], average: null, stdev: null };
		}

		if (game.type == 'regular' && game.away.score != null && game.home.score != null) {
			leaders.regularSeasonWins.franchiseIds[game.away.franchiseId] += game.away.record.straight.week.wins;
			leaders.regularSeasonWins.franchiseIds[game.home.franchiseId] += game.home.record.straight.week.wins;

			if (game.away.record.allPlay.week.losses == 0) {
				leaders.weeklyScoringTitles.franchiseIds[game.away.franchiseId] += 1;
			}

			if (game.home.record.allPlay.week.losses == 0) {
				leaders.weeklyScoringTitles.franchiseIds[game.home.franchiseId] += 1;
			}
		}

		if (game.type != 'consolation' && game.away.score != null && game.home.score != null) {
			stats[game.season].total.scores.push(game.away.score);
			stats[game.season].total.scores.push(game.home.score);

			stats[game.season].franchises[game.away.franchiseId].scores.push(game.away.score);
			stats[game.season].franchises[game.home.franchiseId].scores.push(game.home.score);

			stats[game.season].weeks[game.week].scores.push(game.away.score);
			stats[game.season].weeks[game.week].scores.push(game.home.score);
		}

		if (game.type == 'semifinal') {
			owners[game.season][game.away.franchiseId].playoffs = 'semifinalist';
			owners[game.season][game.home.franchiseId].playoffs = 'semifinalist';
		}

		if (game.type == 'thirdPlace' && game.away.score != null && game.home.score != null) {
			if (game.away.score > game.home.score) {
				owners[game.season][game.away.franchiseId].playoffs = 'third-place';
				owners[game.season][game.home.franchiseId].playoffs = 'semifinalist';
			}
			else if (game.home.score > game.away.score) {
				owners[game.season][game.away.franchiseId].playoffs = 'semifinalist';
				owners[game.season][game.home.franchiseId].playoffs = 'third-place';
			}
		}

		if (game.type == 'championship' && game.away.score != null && game.home.score != null) {
			if (game.away.score > game.home.score) {
				owners[game.season][game.away.franchiseId].playoffs = 'champion';
				owners[game.season][game.home.franchiseId].playoffs = 'runner-up';
			}
			else if (game.home.score > game.away.score) {
				owners[game.season][game.away.franchiseId].playoffs = 'runner-up';
				owners[game.season][game.home.franchiseId].playoffs = 'champion';
			}
		}
	});

	stats.forEach(season => {
		season.weeks.forEach(week => {
			week.average = average(week.scores);
			week.stdev = stdev(week.scores, week.average);
		});

		season.franchises.forEach(franchise => {
			franchise.average = average(franchise.scores);
			franchise.stdev = stdev(franchise.scores, franchise.average);
		});

		season.total.average = average(season.total.scores);
		season.total.stdev = stdev(season.total.scores, season.total.average);
	});

	if (render) {
		var fs = require('fs');
		var pug = require('pug');
		var compiledPug = pug.compileFile('../views/history.pug');
		fs.writeFileSync('../public/history/index.html', compiledPug({ franchises: franchises, history: history, owners: owners, leaders: leaders, stats: stats }));
	}

	process.exit();
});
