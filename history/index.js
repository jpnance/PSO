var dotenv = require('dotenv').config({ path: '/app/.env' });

var mongoose = require('mongoose');
mongoose.Promise = global.Promise;
mongoose.connect(process.env.MONGODB_URI);

var Game = require('../models/Game');
var Leaders = require('../models/Leaders');

var render = false;

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

var leaders = [
	{
		description: 'Regular Season Wins',
		promise: Leaders.RegularSeasonWins.find().sort({ value: -1 })
	},
	{
		description: 'Regular Season Winning Percentage',
		promise: Leaders.RegularSeasonWinningPercentage.find().sort({ value: -1 })
	},
	{
		description: 'Weekly Scoring Titles',
		promise: Leaders.WeeklyScoringTitles.find().sort({ value: -1 })
	},
	{
		description: 'Playoff Appearances',
		promise: Leaders.PlayoffAppearances.find().sort({ value: -1 })
	},
	{
		description: 'Championships',
		promise: Leaders.Championships.find().sort({ value: -1 })
	}
];

Game.find().sort({ season: 1, week: 1 }).then(games => {
	var franchises = {};
	var history = {};
	var owners = {};
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

	var leaderPromises = [];

	leaders.forEach(leader => {
		leaderPromises.push(leader.promise);
	});

	Promise.all(leaderPromises).then(function(values) {
		for (var i = 0; i < values.length; i++) {
			leaders[i].values = values[i];
		}

		if (render) {
			var fs = require('fs');
			var path = require('path');
			var pug = require('pug');
			var compiledPug = pug.compileFile(path.join(__dirname, '../views/history.pug'));
			fs.writeFileSync(path.join(__dirname, '../public/history/index.html'), compiledPug({ franchises: franchises, history: history, owners: owners, leaders: leaders, stats: stats }));
		}

		process.exit();
	});
});
