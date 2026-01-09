var dotenv = require('dotenv').config({ path: '/app/.env' });

var request = require('superagent');

var Game = require('./models/Game');

var mongoose = require('mongoose');
mongoose.promise = global.Promise;
mongoose.connect(process.env.MONGODB_URI);

if (process.argv.length < 3) {
	console.log('Invalid season');
	console.log('Usage: node index.js <season>');
	process.exit();
}

var season = parseInt(process.argv[2]);

var PSO = require('../pso.js');

var weekScores = {};

var newWeekPromise = function(week) {
	return new Promise(function(resolve, reject) {
		request
			.get('https://api.sleeper.app/v1/league/' + PSO.sleeperLeagueIds[season] + '/matchups/' + week)
			.then((response) => {
				var gamePromises = [];

				var sleeperMatchups = [];
				var matchups = [];

				response.body.forEach((team) => {
					if (team.matchup_id === null) {
						return;
					}

					if (!sleeperMatchups[team.matchup_id || 99]) {
						sleeperMatchups[team.matchup_id || 99] = [];
					}

					var psoTeam = {}

					psoTeam.franchiseId = team.roster_id;
					psoTeam.name = PSO.franchiseNames[team.roster_id][season];
					psoTeam.score = team.custom_points ? parseFloat(team.custom_points.toFixed(2)) : parseFloat(team.points.toFixed(2));

					sleeperMatchups[team.matchup_id].push(psoTeam);
				});

				sleeperMatchups.forEach((sleeperMatchup, i) => {
					var matchup = {};

					matchup.season = season;
					matchup.week = week;

					matchup.away = sleeperMatchup[0];
					matchup.home = sleeperMatchup[1];

					if (week <= 15) {
						matchup.type = 'regular';
					}
					else if (week == 16) {
						if (i == 1 || i == 2) {
							matchup.type = 'semifinal';
						}
						else {
							return;
						}
					}
					else if (week == 17) {
						// seems like matchup_id == 1 is the championship game;
						// etc. for matchup_id == 2 for the third-place game
						if (i == 1) {
							matchup.type = 'championship';
						}
						else if (i == 2) {
							matchup.type = 'thirdPlace';
						}
						else {
							return;
						}
					}

					if (matchup.away.score == 0 && matchup.home.score == 0) {
						delete matchup.away.score;
						delete matchup.home.score;
					}
					else {
						if (!weekScores[week]) {
							weekScores[week] = { scores: [], straight: {}, allPlay: {}, stern: {} };
						}

						weekScores[week].scores.push(matchup.away.score, matchup.home.score);

						if (matchup.away.score > matchup.home.score) {
							weekScores[week].straight[matchup.away.score] = { wins: 1, losses: 0, ties: 0 };
							weekScores[week].stern[matchup.away.score] = { wins: 1, losses: 0, ties: 0 };

							weekScores[week].straight[matchup.home.score] = { wins: 0, losses: 1, ties: 0 };
							weekScores[week].stern[matchup.home.score] = { wins: 0, losses: 1, ties: 0 };

							matchup.winner = matchup.away;
							matchup.loser = matchup.home;
						}
						else if (matchup.home.score > matchup.away.score) {
							weekScores[week].straight[matchup.home.score] = { wins: 1, losses: 0, ties: 0 };
							weekScores[week].stern[matchup.home.score] = { wins: 1, losses: 0, ties: 0 };

							weekScores[week].straight[matchup.away.score] = { wins: 0, losses: 1, ties: 0 };
							weekScores[week].stern[matchup.away.score] = { wins: 0, losses: 1, ties: 0 };

							matchup.winner = matchup.home;
							matchup.loser = matchup.away;
						}
						else {
							weekScores[week].straight[matchup.home.score] = { wins: 0, losses: 0, ties: 1 };
							weekScores[week].stern[matchup.home.score] = { wins: 0, losses: 0, ties: 1 };

							weekScores[week].straight[matchup.away.score] = { wins: 0, losses: 0, ties: 1 };
							weekScores[week].stern[matchup.away.score] = { wins: 0, losses: 0, ties: 1 };
						}
					}

					var conditions = {
						season: matchup.season,
						week: matchup.week,
						'away.franchiseId': matchup.away.franchiseId,
						'home.franchiseId': matchup.home.franchiseId
					};

					gamePromises.push(Game.findOneAndUpdate(conditions, matchup, { upsert: true }));

					//matchups.push(matchup);
				});

				Promise.all(gamePromises).then(() => { resolve(week); });
			});
		}
	)
};

var weekPromises = [];

for (var week = 1; week <= Math.max(15, PSO.getWeek()); week++) {
	weekPromises.push(newWeekPromise(week));
}

Promise.all(weekPromises).then((values) => {
	Object.keys(weekScores).forEach(week => {
		weekScores[week].scores.sort((a, b) => a - b);

		weekScores[week].scores.forEach((score, i) => {
			var differentScores = weekScores[week].scores.filter(thisScore => thisScore != score);
			var thisScoreOccurrences = weekScores[week].scores.length - differentScores.length;
			var higherScores = weekScores[week].scores.filter(thisScore => thisScore > score);
			var lowerScores = weekScores[week].scores.filter(thisScore => thisScore < score);
			var equalScores = weekScores[week].scores.filter(thisScore => thisScore == score);

			weekScores[week].allPlay[score] = { wins: lowerScores.length, losses: higherScores.length, ties: equalScores.length - 1 };

			if (higherScores.length > lowerScores.length) {
				weekScores[week].stern[score].losses = Math.min(2, weekScores[week].stern[score].losses + 1);
			}
			else if (lowerScores.length > higherScores.length) {
				weekScores[week].stern[score].wins = Math.min(2, weekScores[week].stern[score].wins + 1);
			}
			else {
				weekScores[week].stern[score].ties = Math.min(2, weekScores[week].stern[score].ties + 1);
			}
		});
	});

	Game.find({ season: season }).sort({ week: 1 }).then(values => {
		var morePromises = [];
		var cumulativeRecord = {};

		cumulativeRecord[season] = {};

		values.forEach(game => {
			if (!cumulativeRecord[season][game.away.franchiseId]) {
				cumulativeRecord[season][game.away.franchiseId] = {
					straight: { wins: 0, losses: 0, ties: 0 },
					allPlay: { wins: 0, losses: 0, ties: 0 },
					stern: { wins: 0, losses: 0, ties: 0 }
				};
			}

			if (!cumulativeRecord[season][game.home.franchiseId]) {
				cumulativeRecord[season][game.home.franchiseId] = {
					straight: { wins: 0, losses: 0, ties: 0 },
					allPlay: { wins: 0, losses: 0, ties: 0 },
					stern: { wins: 0, losses: 0, ties: 0 }
				};
			}

			if (game.away.score > 0 || game.home.score > 0) {
				['away', 'home'].forEach(teamType => {
					['straight', 'allPlay', 'stern'].forEach(recordType => {
						['wins', 'losses', 'ties'].forEach(resultType => {
							cumulativeRecord[season][game[teamType].franchiseId][recordType][resultType] += weekScores[game.week][recordType][game[teamType].score][resultType];
						});

						if (!game[teamType].record) {
							game[teamType].record = {};
						}

						game[teamType].record[recordType] = {
							week: weekScores[game.week][recordType][game[teamType].score],
							cumulative: cumulativeRecord[season][game[teamType].franchiseId][recordType]
						};
					});
				});

				morePromises.push(game.save());
			}
		});

		Promise.all(morePromises).then(() => { mongoose.disconnect(); });
	});
});
