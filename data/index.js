var dotenv = require('dotenv').config({ path: __dirname + '/../.env' });

var request = require('superagent');

var Game = require('./models/Game');

var mongoose = require('mongoose');
mongoose.promise = global.Promise;
mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true, useFindAndModify: false });

if (process.argv.length < 3) {
	console.log('Invalid season');
	console.log('Usage: node index.js <season>');
	process.exit();
}

var season = parseInt(process.argv[2]);

var PSO = require('../pso.js');

var weekScores = {};

var hackScores = {
	5: {
		1: 127.69,
		2: 141.63,
		3: 121.50,
		4: 162.85,
		5: 153.10,
		6: 193.07,
		7: 120.56,
		8: 133.59,
		9: 158.22,
		10: 146.18,
		11: 143.44,
		12: 170.38
	},
	6: {
		1: 155.34,
		2: 110.16,
		3: 129.70,
		4: 111.04,
		5: 102.64,
		6: 145.64,
		7: 121.88,
		8: 186.99,
		9: 180.10,
		10: 114.46,
		11: 106.30,
		12: 113.04
	}
};

var newWeekPromise = function(week) {
	return new Promise(function(resolve, reject) {
		request
			.post('https://www.fantrax.com/fxpa/req?leagueId=eju35f9ok7xr9cvt')
			.set('Content-Type', 'text/plain')
			.set('Cookie', process.env.FANTRAX_COOKIES)
			.send(JSON.stringify({ msgs: [ { data: { newView: true, period: week }, method: 'getLiveScoringStats' } ] }))
			.then(response => {
				console.log(week);
				var dataJson = JSON.parse(response.text);
				var teamStatsMap = dataJson.responses[0].data.statsPerTeam.statsMap;
				var matchupsRaw = dataJson.responses[0].data.matchups;
				var matchups = [];

				var gamePromises = [];

				matchupsRaw.forEach(matchupRaw => {
					var teamIds = matchupRaw.split('_');
					var matchup = {};

					matchup.season = season;
					matchup.week = week;

					matchup.away = { franchiseId: PSO.fantraxIds[teamIds[0]] };
					matchup.home = { franchiseId: PSO.fantraxIds[teamIds[1]] };

					matchup.away.name = PSO.franchiseNames[matchup.away.franchiseId][season];
					matchup.home.name = PSO.franchiseNames[matchup.home.franchiseId][season];

					matchup.away.score = teamStatsMap[teamIds[0]].ACTIVE.totalFpts;
					matchup.home.score = teamStatsMap[teamIds[1]].ACTIVE.totalFpts;

					if (week <= 14) {
						matchup.type = 'regular';
					}
					/*
					else if (week == 15) {
						if (game.playoffTierType == 'WINNERS_BRACKET') {
							matchup.type = 'semifinal';
						}
						else {
							matchup.type = 'consolation';
						}
					}
					else if (week == 16) {
						if (game.playoffTierType == 'WINNERS_BRACKET') {
							matchup.type = 'championship';
						}
						else if (game.playoffTierType == 'WINNERS_CONSOLATION_LADDER') {
							matchup.type = 'thirdPlace';
						}
						else {
							matchup.type = 'consolation';
						}
					}
					*/

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
