var request = require('superagent');

var Game = require('./models/Game');

var mongoose = require('mongoose');
mongoose.promise = global.Promise;
mongoose.connect('mongodb://localhost:27017/pso_dev');

if (process.argv.length < 3) {
	console.log('Invalid season');
	console.log('Usage: node index.js <season> [week to stop]');
	process.exit();
}

var season = process.argv[2];
var upToWeek = process.argv[3] || 16;

var franchiseNames = {
	1: {
		2008: 'Patrick',
		2009: 'Patrick',
		2010: 'Patrick',
		2011: 'Patrick',
		2012: 'Pat/Quinn',
		2013: 'Pat/Quinn',
		2014: 'Patrick',
		2015: 'Patrick',
		2016: 'Patrick',
		2017: 'Patrick',
		2018: 'Patrick'
	},
	2: {
		2008: 'Koci',
		2009: 'Koci',
		2010: 'Koci',
		2011: 'Koci',
		2012: 'Koci',
		2013: 'Koci/Mueller',
		2014: 'Koci/Mueller',
		2015: 'Koci/Mueller',
		2016: 'Koci/Mueller',
		2017: 'Koci/Mueller',
		2018: 'Koci/Mueller'
	},
	3: {
		2008: 'Syed',
		2009: 'Syed',
		2010: 'Syed',
		2011: 'Syed',
		2012: 'Syed',
		2013: 'Syed',
		2014: 'Syed',
		2015: 'Syed/Terence',
		2016: 'Syed/Terence',
		2017: 'Syed/Terence',
		2018: 'Syed/Terence'
	},
	4: {
		2008: 'John',
		2009: 'John',
		2010: 'John',
		2011: 'John',
		2012: 'John',
		2013: 'John',
		2014: 'John/Zach',
		2015: 'John/Zach',
		2016: 'John/Zach',
		2017: 'John/Zach',
		2018: 'John/Zach'
	},
	5: {
		2008: 'Trevor',
		2009: 'Trevor',
		2010: 'Trevor',
		2011: 'Trevor',
		2012: 'Trevor',
		2013: 'Trevor',
		2014: 'Trevor',
		2015: 'Trevor',
		2016: 'Trevor',
		2017: 'Trevor',
		2018: 'Trevor'
	},
	6: {
		2008: 'Keyon',
		2009: 'Keyon',
		2010: 'Keyon',
		2011: 'Keyon',
		2012: 'Keyon',
		2013: 'Keyon',
		2014: 'Keyon',
		2015: 'Keyon',
		2016: 'Keyon',
		2017: 'Keyon',
		2018: 'Keyon'
	},
	7: {
		2008: 'Jeff',
		2009: 'Jake/Luke',
		2010: 'Jake/Luke',
		2011: 'Jake/Luke',
		2012: 'Jake/Luke',
		2013: 'Jake/Luke',
		2014: 'Brett/Luke',
		2015: 'Brett/Luke',
		2016: 'Brett/Luke',
		2017: 'Brett/Luke',
		2018: 'Brett/Luke'
	},
	8: {
		2008: 'Daniel',
		2009: 'Daniel',
		2010: 'Daniel',
		2011: 'Daniel',
		2012: 'Daniel',
		2013: 'Daniel',
		2014: 'Daniel',
		2015: 'Daniel',
		2016: 'Daniel',
		2017: 'Daniel',
		2018: 'Daniel'
	},
	9: {
		2008: 'James',
		2009: 'James',
		2010: 'James',
		2011: 'James',
		2012: 'James',
		2013: 'James',
		2014: 'James',
		2015: 'James',
		2016: 'James',
		2017: 'James/Charles',
		2018: 'James/Charles'
	},
	10: {
		2008: 'Schexes',
		2009: 'Schexes',
		2010: 'Schexes',
		2011: 'Schexes',
		2012: 'Schex',
		2013: 'Schex',
		2014: 'Schex',
		2015: 'Schex/Jeff',
		2016: 'Schex/Jeff',
		2017: 'Schex/Jeff',
		2018: 'Schex'
	},
	11: {
		2012: 'Charles',
		2013: 'Charles',
		2014: 'Quinn',
		2015: 'Quinn',
		2016: 'Quinn',
		2017: 'Quinn',
		2018: 'Quinn'
	},
	12: {
		2012: 'Mitch',
		2013: 'Mitch',
		2014: 'Mitch',
		2015: 'Mitch',
		2016: 'Mitch',
		2017: 'Mitch',
		2018: 'Mitch'
	}
};

var weekPromises = [];
var weekScores = {};

for (var i = 1; i <= upToWeek; i++) {
	weekPromises.push(new Promise((resolveWeek, rejectWeek) => {
		var week = i;

		request.get('http://games.espn.go.com/ffl/scoreboard?leagueId=122885&matchupPeriodId=' + week + '&seasonId=' + season, (error, response) => {
			var gamePromises = [];
			var resultPattern = /<table class="ptsBased matchup"><tr id="teamscrg_(\d\d?)_activeteamrow">.*?<td class=".*?score"title="(.*?)".*?>.*?<\/td><\/tr><tr id="teamscrg_(\d\d?)_activeteamrow">.*?<td class=".*?score"title="(.*?)".*?>.*?<\/td><\/tr>.*?<\/td><\/tr><\/table>/g;

			var matchup = 0;

			while (match = resultPattern.exec(response.text)) {
				var away = {
					franchiseId: match[1]
				};

				var home = {
					franchiseId: match[3]
				};

				var type = 'regular';

				if (week <= 14) {
					type = 'regular';
				}
				else if (week == 15) {
					if (matchup == 0 || matchup == 1) {
						type = 'semifinal'
					}
					else {
						type = 'consolation'
					}
				}
				else if (week == 16) {
					if (matchup == 0) {
						type = 'championship';
					}
					else if (matchup == 1) {
						type = 'thirdPlace';
					}
					else {
						type = 'consolation';
					}
				}

				away.name = franchiseNames[away.franchiseId][season];
				home.name = franchiseNames[home.franchiseId][season];

				var awayScore = match[2];
				var homeScore = match[4];

				if (awayScore > 0 || homeScore > 0) {
					away.score = parseFloat(awayScore);
					home.score = parseFloat(homeScore);

					if (!weekScores[week]) {
						weekScores[week] = { scores: [], straight: {}, allPlay: {}, stern: {} };
					}

					weekScores[week].scores.push(away.score, home.score);

					if (away.score > home.score) {
						weekScores[week].straight[away.score] = { wins: 1, losses: 0, ties: 0 };
						weekScores[week].stern[away.score] = { wins: 1, losses: 0, ties: 0 };

						weekScores[week].straight[home.score] = { wins: 0, losses: 1, ties: 0 };
						weekScores[week].stern[home.score] = { wins: 0, losses: 1, ties: 0 };
					}
					else if (home.score > away.score) {
						weekScores[week].straight[home.score] = { wins: 1, losses: 0, ties: 0 };
						weekScores[week].stern[home.score] = { wins: 1, losses: 0, ties: 0 };

						weekScores[week].straight[away.score] = { wins: 0, losses: 1, ties: 0 };
						weekScores[week].stern[away.score] = { wins: 0, losses: 1, ties: 0 };
					}
					else {
						weekScores[week].straight[home.score] = { wins: 0, losses: 0, ties: 1 };
						weekScores[week].stern[home.score] = { wins: 0, losses: 0, ties: 1 };

						weekScores[week].straight[away.score] = { wins: 0, losses: 0, ties: 1 };
						weekScores[week].stern[away.score] = { wins: 0, losses: 0, ties: 1 };
					}
				}

				var conditions = {
					season: season,
					week: week,
					'away.franchiseId': away.franchiseId,
					'home.franchiseId': home.franchiseId
				};

				var game = {
					season: season,
					week: week,
					type: type,
					away: away,
					home: home
				};

				gamePromises.push(Game.findOneAndUpdate(conditions, game, { upsert: true }));

				matchup++;
			}

			Promise.all(gamePromises).then(() => { resolveWeek(null); });
		});
	}));
}

Promise.all(weekPromises).then(() => {
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
