var dotenv = require('dotenv').config({ path: '/app/.env' });

var Game = require('./models/Game');

var mongoose = require('mongoose');
mongoose.promise = global.Promise;
mongoose.connect(process.env.MONGODB_URI);

var seasonWeekScores = {};

Game.find({ type: { '$in': [ 'regular', 'semifinal', 'thirdPlace', 'championship' ] } }).sort({ season: 1, week: 1 }).then(games => {
	games.forEach(game => {
		console.log(game.season, game.week);
		if (!game.away.score && !game.home.score) {
			return;
		}

		if (!seasonWeekScores[game.season]) {
			seasonWeekScores[game.season] = {};
		}

		if (!seasonWeekScores[game.season][game.week]) {
			seasonWeekScores[game.season][game.week] = {
				scores: [],
				straight: [],
				allPlay: [],
				stern: []
			};
		}

		seasonWeekScores[game.season][game.week].scores.push(game.away.score, game.home.score);

		if (game.away.score > game.home.score) {
			seasonWeekScores[game.season][game.week].straight[game.away.score] = { wins: 1, losses: 0, ties: 0 };
			seasonWeekScores[game.season][game.week].stern[game.away.score] = { wins: 1, losses: 0, ties: 0 };

			seasonWeekScores[game.season][game.week].straight[game.home.score] = { wins: 0, losses: 1, ties: 0 };
			seasonWeekScores[game.season][game.week].stern[game.home.score] = { wins: 0, losses: 1, ties: 0 };

			game.winner = game.away;
			game.loser = game.home;
		}
		else if (game.home.score > game.away.score) {
			seasonWeekScores[game.season][game.week].straight[game.home.score] = { wins: 1, losses: 0, ties: 0 };
			seasonWeekScores[game.season][game.week].stern[game.home.score] = { wins: 1, losses: 0, ties: 0 };

			seasonWeekScores[game.season][game.week].straight[game.away.score] = { wins: 0, losses: 1, ties: 0 };
			seasonWeekScores[game.season][game.week].stern[game.away.score] = { wins: 0, losses: 1, ties: 0 };

			game.winner = game.home;
			game.loser = game.away;
		}
		else {
			seasonWeekScores[game.season][game.week].straight[game.home.score] = { wins: 0, losses: 0, ties: 1 };
			seasonWeekScores[game.season][game.week].stern[game.home.score] = { wins: 0, losses: 0, ties: 1 };

			seasonWeekScores[game.season][game.week].straight[game.away.score] = { wins: 0, losses: 0, ties: 1 };
			seasonWeekScores[game.season][game.week].stern[game.away.score] = { wins: 0, losses: 0, ties: 1 };
		}
	});

	Object.keys(seasonWeekScores).forEach(season => {
		Object.keys(seasonWeekScores[season]).forEach(week => {
			seasonWeekScores[season][week].scores.sort((a, b) => a - b);

			seasonWeekScores[season][week].scores.forEach((score, i) => {
				var differentScores = seasonWeekScores[season][week].scores.filter(thisScore => thisScore != score);
				var thisScoreOccurrences = seasonWeekScores[season][week].scores.length - differentScores.length;
				var higherScores = seasonWeekScores[season][week].scores.filter(thisScore => thisScore > score);
				var lowerScores = seasonWeekScores[season][week].scores.filter(thisScore => thisScore < score);
				var equalScores = seasonWeekScores[season][week].scores.filter(thisScore => thisScore == score);

				seasonWeekScores[season][week].allPlay[score] = { wins: lowerScores.length, losses: higherScores.length, ties: equalScores.length - 1 };

				if (higherScores.length > lowerScores.length) {
					seasonWeekScores[season][week].stern[score].losses = Math.min(2, seasonWeekScores[season][week].stern[score].losses + 1);
				}
				else if (lowerScores.length > higherScores.length) {
					seasonWeekScores[season][week].stern[score].wins = Math.min(2, seasonWeekScores[season][week].stern[score].wins + 1);
				}
				else {
					seasonWeekScores[season][week].stern[score].ties = Math.min(2, seasonWeekScores[season][week].stern[score].ties + 1);
				}
			});
		});
	});

	var morePromises = [];
	var cumulativeRecord = {};

	games.forEach(game => {
		if (!cumulativeRecord[game.season]) {
			cumulativeRecord[game.season] = {};
		}

		if (!cumulativeRecord[game.season][game.away.franchiseId]) {
			cumulativeRecord[game.season][game.away.franchiseId] = {
				straight: { wins: 0, losses: 0, ties: 0 },
				allPlay: { wins: 0, losses: 0, ties: 0 },
				stern: { wins: 0, losses: 0, ties: 0 }
			};
		}

		if (!cumulativeRecord[game.season][game.home.franchiseId]) {
			cumulativeRecord[game.season][game.home.franchiseId] = {
				straight: { wins: 0, losses: 0, ties: 0 },
				allPlay: { wins: 0, losses: 0, ties: 0 },
				stern: { wins: 0, losses: 0, ties: 0 }
			};
		}

		if (game.away.score > 0 || game.home.score > 0) {
			['away', 'home'].forEach(teamType => {
				['straight', 'allPlay', 'stern'].forEach(recordType => {
					['wins', 'losses', 'ties'].forEach(resultType => {
						cumulativeRecord[game.season][game[teamType].franchiseId][recordType][resultType] += game.seasonWeekScores[game.season][game.week][recordType][game[teamType].score][resultType];
					});

					if (!game[teamType].record) {
						game[teamType].record = {};
					}

					game[teamType].record[recordType] = {
						week: weekScores[game.week][recordType][game[teamType].score],
						cumulative: cumulativeRecord[game.season][game[teamType].franchiseId][recordType]
					};
				});
			});

			//morePromises.push(game.save());
		}
	});

	Promise.all(morePromises).then(() => { mongoose.disconnect(); });

	process.exit();
});

/*
var weekPromises = [];

for (var week = 1; week <= 14; week++) {
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
*/
