module.exports = function(app) {
	app.get('/', function(request, response) {
		response.redirect('https://thedynastyleague.wordpress.com/');
	});

	app.get('/lol', function(request, response) {
		var Game = require('./models/Game');

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

		Game.find().then(games => {
			var history = {};
			var owners = {};
			var leaders = {
				regularSeasonWins: {
					description: 'Regular Season Wins',
					franchises: {}
				},
				weeklyScoringTitles: {
					description: 'Weekly Scoring Titles',
					franchises: {}
				}
			};
			var stats = [];

			games.forEach(game => {
				if (!history[game.season]) {
					history[game.season] = {};
				}

				if (!history[game.season][game.week]) {
					history[game.season][game.week] = {};
				}

				if (!history[game.season][game.week][game.away.franchiseId]) {
					history[game.season][game.week][game.away.franchiseId] = {
						franchise: game.away,
						opponent: game.home
					};
				}

				if (!history[game.season][game.week][game.home.franchiseId]) {
					history[game.season][game.week][game.home.franchiseId] = {
						franchise: game.home,
						opponent: game.away
					};
				}

				if (!owners[game.season]) {
					owners[game.season] = {};
				}

				if (!owners[game.season][game.away.franchiseId]) {
					owners[game.season][game.away.franchiseId] = game.away.name;
				}

				if (!owners[game.season][game.home.franchiseId]) {
					owners[game.season][game.home.franchiseId] = game.home.name;
				}

				if (!leaders.regularSeasonWins.franchises[game.away.franchiseId]) {
					leaders.regularSeasonWins.franchises[game.away.franchiseId] = 0;
				}

				if (!leaders.regularSeasonWins.franchises[game.home.franchiseId]) {
					leaders.regularSeasonWins.franchises[game.home.franchiseId] = 0;
				}

				if (!leaders.weeklyScoringTitles.franchises[game.away.franchiseId]) {
					leaders.weeklyScoringTitles.franchises[game.away.franchiseId] = 0;
				}

				if (!leaders.weeklyScoringTitles.franchises[game.home.franchiseId]) {
					leaders.weeklyScoringTitles.franchises[game.home.franchiseId] = 0;
				}

				if (!stats[game.season]) {
					stats[game.season] = {
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

				if (game.type == 'regular' && game.away.score && game.home.score) {
					leaders.regularSeasonWins.franchises[game.away.franchiseId] += game.away.record.straight.week.wins;
					leaders.regularSeasonWins.franchises[game.home.franchiseId] += game.home.record.straight.week.wins;

					if (game.away.record.allPlay.week.losses == 0) {
						leaders.weeklyScoringTitles.franchises[game.away.franchiseId] += 1;
					}

					if (game.home.record.allPlay.week.losses == 0) {
						leaders.weeklyScoringTitles.franchises[game.home.franchiseId] += 1;
					}
				}

				if (game.type != 'consolation' && game.away.score && game.home.score) {
					stats[game.season].total.scores.push(game.away.score);
					stats[game.season].total.scores.push(game.home.score);

					stats[game.season].weeks[game.week].scores.push(game.away.score);
					stats[game.season].weeks[game.week].scores.push(game.home.score);
				}
			});

			stats.forEach(season => {
				season.weeks.forEach(week => {
					week.average = average(week.scores);
					week.stdev = stdev(week.scores, week.average);
				});

				season.total.average = average(season.total.scores);
				season.total.stdev = stdev(season.total.scores, season.total.average);
			});

			response.render('history', { history: history, owners: owners, leaders: leaders, stats: stats });
		});
	});
};
