var mongoose = require('mongoose');
mongoose.Promise = global.Promise;
//mongoose.connect('mongodb://localhost:27017/pso', { useMongoClient: true });

var request = require('superagent');
var cheerio = require('cheerio');

var seasonIds = [2008, 2009, 2010, 2011, 2012, 2013, 2014, 2015, 2016];
var matchupPeriodIds = [15, 16];
var players = {};

var schedulePromises = [];

seasonIds.forEach(function(seasonId) {
	matchupPeriodIds.forEach(function(matchupPeriodId) {
		schedulePromises.push(new Promise(function(resolveSchedule, rejectSchedule) {
			request.get('http://games.espn.com/ffl/scoreboard?leagueId=122885&matchupPeriodId=' + matchupPeriodId + '&seasonId=' + seasonId, function(error, response) {
				var $ = cheerio.load(response.text);
				var boxscorePromises = [];

				$('div#scoreboardMatchups table').first().find('table.matchup div.boxscoreLinks a').each(function(i, e) {
					if (i % 3 != 0) {
						return;
					}

					var boxscoreUrl = $(e).attr('href');

					boxscorePromises.push(new Promise(function(resolveBoxscore, rejectBoxscore) {
						request.get('http://games.espn.com' + boxscoreUrl, function(error, response) {
							var $ = cheerio.load(response.text);

							var scores = [];

							$('table[id^=playertable] tr.playerTableBgRowTotals td.appliedPoints, div.totalScore').each(function(i, e) {
								scores[i] = parseFloat($(e).text());
							});

							$('table[id^=playertable]').each(function(tableIndex, e) {
								var $playerTable = $(e);

								$playerTable.find('td[id^=playername]').each(function(playerIndex, e) {
									var $this = $(e);
									var playerId = $this.attr('id').split('_')[1];

									if (!players[playerId]) {
										players[playerId] = {
											name: null,
											playoffStarts: 0,
											firstRoundStarts: 0,
											championshipStarts: 0,
											championships: 0,
											runnerUps: 0,
											thirdPlaceGames: 0
										};
									}

									var player = players[playerId];

									if (matchupPeriodId == 15) {
										player.playoffStarts++;
										player.firstRoundStarts++;

										if ((tableIndex == 0 && scores[1] > scores[0]) || (tableIndex == 1 && scores[0] > scores[1])) {
											player.thirdPlaceGames++;
										}
									}
									else if (matchupPeriodId == 16) {
										player.playoffStarts++;
										player.championshipStarts++;

										if ((tableIndex == 0 && scores[0] > scores[1]) || (tableIndex == 1 && scores[1] > scores[0])) {
											player.championships++;
										}
										else {
											player.runnerUps++;
										}
									}

									if (!player.name) {
										var name = $this.find('a').text();

										if (!name) {
											name = $this.text().split(',')[0];
										}
										player.name = name;
									}
								});
							});

							resolveBoxscore(null);
						});
					}));

					Promise.all(boxscorePromises).then(function() {
						resolveSchedule();
					});
				});
			});
		}));
	});
});

Promise.all(schedulePromises).then(function() {
	var playerArray = [];
	var sortBy = 'championships';

	Object.keys(players).forEach(function(key) {
		playerArray.push(players[key]);
	});

	playerArray.sort(function(a, b) {
		if (a[sortBy] < b[sortBy]) {
			return 1;
		}
		else if (a[sortBy] > b[sortBy]) {
			return -1;
		}
		else {
			return 0;
		}
	});

	console.log(playerArray);
});
