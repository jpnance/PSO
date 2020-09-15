var dotenv = require('dotenv').config({ path: '../.env' });

var request = require('superagent');

var Game = require('./models/Game');

var mongoose = require('mongoose');
mongoose.promise = global.Promise;
mongoose.connect('mongodb://localhost:27017/pso_dev', { useNewUrlParser: true, useUnifiedTopology: true, useFindAndModify: false });

if (process.argv.length < 3) {
	console.log('Invalid season');
	console.log('Usage: node index.js <season>');
	process.exit();
}

var season = parseInt(process.argv[2]);

var fantraxIds = {
	'motju5wmk7xr9dlz': 1,
	'6u9bwy3ik7xrer9z': 2,
	'hfyfddwck7xrera2': 3,
	'hgfqy84rk7xrera0': 4,
	'alzk1h56k7xrer9w': 5,
	'134ej04vk7xrer9y': 6,
	'n5ozy8wjk7xrer9m': 7,
	'fzqz34xuk7xrer9p': 8,
	'erk30j3lk7xrer9s': 9,
	'bmj6dbebk7xrer9v': 10,
	'a1p22t32k7xrer9u': 11,
	'vt5py28ck7xrer9r': 12
};

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
		2018: 'Patrick',
		2019: 'Patrick',
		2020: 'Patrick'
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
		2018: 'Koci/Mueller',
		2019: 'Koci/Mueller',
		2020: 'Koci/Mueller'
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
		2018: 'Syed/Terence',
		2019: 'Syed/Kuan',
		2020: 'Syed/Kuan'
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
		2018: 'John/Zach',
		2019: 'John/Zach',
		2020: 'John/Zach'
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
		2018: 'Trevor',
		2019: 'Trevor',
		2020: 'Trevor'
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
		2018: 'Keyon',
		2019: 'Keyon',
		2020: 'Keyon'
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
		2018: 'Brett/Luke',
		2019: 'Brett/Luke',
		2020: 'Brett/Luke'
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
		2018: 'Daniel',
		2019: 'Terence',
		2020: 'Terence'
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
		2018: 'James/Charles',
		2019: 'James/Charles',
		2020: 'James/Charles'
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
		2018: 'Schex',
		2019: 'Schex',
		2020: 'Schex'
	},
	11: {
		2012: 'Charles',
		2013: 'Charles',
		2014: 'Quinn',
		2015: 'Quinn',
		2016: 'Quinn',
		2017: 'Quinn',
		2018: 'Quinn',
		2019: 'Quinn',
		2020: 'Quinn'
	},
	12: {
		2012: 'Mitch',
		2013: 'Mitch',
		2014: 'Mitch',
		2015: 'Mitch',
		2016: 'Mitch',
		2017: 'Mitch',
		2018: 'Mitch',
		2019: 'Mitch',
		2020: 'Mitch'
	}
};

var weekScores = {};

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

					matchup.away = { franchiseId: fantraxIds[teamIds[0]] };
					matchup.home = { franchiseId: fantraxIds[teamIds[1]] };

					matchup.away.name = franchiseNames[matchup.away.franchiseId][season];
					matchup.home.name = franchiseNames[matchup.home.franchiseId][season];

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
