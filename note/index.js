var dotenv = require('dotenv').config({ path: '/app/.env' });

var fs = require('fs');
var request = require('superagent');

var PSO = require('../pso.js');
var Game = require('../models/Game');
var Leaders = require('../models/Leaders');

var mongoose = require('mongoose');
mongoose.promise = global.Promise;
mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });

if (process.argv.length < 3) {
	console.log('Invalid week');
	console.log('Usage: node index.js <week> [co-host name] [last week co-host name]');
	process.exit();
}

var week = parseInt(process.argv[2]);
var cohost = process.argv[3];
var lastWeekCohost = process.argv[4] || cohost;

function csvToRpoMap(csv) {
	var lines = csv.split(/\n/)
	lines.shift();

	var map = {};

	lines.forEach(line => {
		var fields = line.replace(/^"/, '').replace(/"$/, '').split(/","/);

		if (fields[4] == 'Status') {
			return;
		}

		var owner = PSO.fantraxAbbreviations[fields[5]];

		if (!map[owner]) {
			map[owner] = [];
		}

		map[owner].push({
			name: fields[1],
			points: parseFloat(fields[10])
		});
	});

	return map;
}

function niceRate(rate) {
	var roundedRate = rate.toFixed(3);

	if (roundedRate[0] == '1') {
		return '1.000';
	}
	else {
		return roundedRate.substring(1);
	}
}

function ordinal(number) {
	if (number % 100 == 11) {
		return number + 'th';
	}

	if (number % 100 == 12) {
		return number + 'th';
	}

	if (number % 100 == 13) {
		return number + 'th';
	}

	if (number % 10 == 1) {
		return number + 'st';
	}

	if (number % 10 == 2) {
		return number + 'nd';
	}

	if (number % 10 == 3) {
		return number + 'rd';
	}

	return number + 'th';
}

function isJaguarGame(franchiseOne, franchiseTwo) {
	var jaguarOwners = ['Keyon', 'Luke', 'Patrick', 'Schex'];

	return jaguarOwners.includes(franchiseOne) && jaguarOwners.includes(franchiseTwo);
}

var dataPromises = [
	Game.find({ season: process.env.SEASON }).sort({ week: 1 }),
	Leaders.WeeklyScoringTitles.find().sort({ value: -1 }),
	require('./rpo-data.json').filter((rpo) => rpo.week == week - 1),
	request.get('https://api.sleeper.app/v1/league/817129464579350528/matchups/' + (week - 1))
];

Promise.all(dataPromises).then(function(values) {
	var games = values[0];
	var scoringTitles = values[1];
	var weekRpos = values[2];
	var weekResults = values[3].body;

	var rpoOptions = {};
	var selectedRpos = {};
	var offeredRpos = {};
	var playerPoints = {};

	weekResults.forEach((weekResult) => {
		Object.keys(weekResult.players_points).forEach((playerId) => {
			playerPoints[playerId] = weekResult.players_points[playerId] || 0;
		});
	});

	weekRpos.forEach((rpo) => {
		if (!rpoOptions[rpo.owner]) {
			rpoOptions[rpo.owner] = [];
		}

		rpoOptions[rpo.owner].push(rpo);

		if (rpo.selected) {
			selectedRpos[rpo.owner] = rpo;
		}

		if (!rpo.selected) {
			offeredRpos[rpo.owner] = rpo;
		}

		rpo.player.points = playerPoints[rpo.player.id];
	});

	if (week > 1 && week < 16 && Object.keys(rpoOptions).length != 12) {
		throw 'We need twelve franchises represented in the RPO data for this week and we only have ' + Object.keys(rpoOptions).length;
	}
	else if (week > 1 && week >= 16 && week < 18 && Object.keys(rpoOptions).length != 4) {
		throw 'We need four franchises represented in the RPO data for this week and we only have ' + Object.keys(rpoOptions).length;
	}

	Object.keys(rpoOptions).forEach(rpoKey => {
		if (rpoOptions[rpoKey].length != 2) {
			throw 'We need two players offered for every franchise and ' + rpoKey + ' only has ' + rpoOptions[rpoKey].length;
		}
	});

	if (week > 7) {
		var percentagesData = JSON.parse(fs.readFileSync('../public/data/percentages.json', 'utf8'));

		Object.keys(percentagesData).forEach(franchiseId => {
			['playoffs', 'decision'].forEach((outcome) => {
				percentagesData[franchiseId][outcome].tripleSlash = niceRate(percentagesData[franchiseId][outcome].neutral.rate) + '/' + niceRate(percentagesData[franchiseId][outcome].withWin.rate) + '/' + niceRate(percentagesData[franchiseId][outcome].withLoss.rate);
			});
		});
	}

	var lastWeek = games.filter(game => game.week == week - 1);
	var thisWeek = games.filter(game => game.week == week);
	var nextWeeks = games.filter(game => game.week >= week && game.week <= week + 2);

	if (week > 1) {
		var highScorerAllPlayWins = (week < 16) ? 11 : 3;
		var highScorerLastWeek = games.filter(game => game.week == (week - 1) && ((game.winner.franchiseId == game.home.franchiseId && game.home.record.allPlay.week.wins == highScorerAllPlayWins) || (game.winner.franchiseId == game.away.franchiseId && game.away.record.allPlay.week.wins == highScorerAllPlayWins)))[0];
		var highScorerSeason = games.filter(game => ((game.winner.franchiseId == highScorerLastWeek.winner.franchiseId && game.home.record.allPlay.week.wins == 11) || (game.winner.franchiseId == highScorerLastWeek.winner.franchiseId && game.away.record.allPlay.week.wins == 11)));
		var highScorerAllTime = scoringTitles.filter(leader => leader._id == highScorerLastWeek.winner.name)[0];
	}

	var introWeek = 'Week ' + week;

	if (week == 16) {
		introWeek = 'the semifinals';
	}
	else if (week == 17) {
		introWeek = 'the championship round';
	}
	else if (week == 18) {
		introWeek = 'the offseason';
	}

	console.log('SOUND EFFECTS');
	console.log();
	console.log('Intro');
	console.log("\t" + 'Welcome to the PSO Show for ' + introWeek + ' of the ' + process.env.SEASON + ' season!');
	console.log("\t" + 'I am Patrick, joined, as always, by ' + (cohost || 'WHO_IS_YOUR_COHOST'));
	console.log("\t" + 'BANTER_PROMPT');
	console.log();

	if (week > 1) {
		console.log('Week ' + (week - 1) + ' Recaps');
		console.log("\t" + 'MAKE SURE THESE ARE SORTED CORRECTLY');

		var nextWeeksGamesFor = {};

		nextWeeks.forEach(nextWeeksGame => {
			if (!nextWeeksGamesFor[nextWeeksGame.away.name]) {
				nextWeeksGamesFor[nextWeeksGame.away.name] = [];
			}

			if (!nextWeeksGamesFor[nextWeeksGame.home.name]) {
				nextWeeksGamesFor[nextWeeksGame.home.name] = [];
			}

			nextWeeksGamesFor[nextWeeksGame.away.name].push(nextWeeksGame.home.name);
			nextWeeksGamesFor[nextWeeksGame.home.name].push(nextWeeksGame.away.name);
		});

		lastWeek.forEach((game, n) => {
			var winner;
			var loser;

			if (game.winner.franchiseId == game.home.franchiseId) {
				winner = game.home;
			}
			else if (game.winner.franchiseId == game.away.franchiseId) {
				winner = game.away;
			}

			if (game.loser.franchiseId == game.home.franchiseId) {
				loser = game.home;
			}
			else if (game.loser.franchiseId == game.away.franchiseId) {
				loser = game.away;
			}

			var nextGamesString;

			if (week == 17) {
				nextGamesString = 'CHAMPIONSHIP_OR_THIRD_PLACE_GAME opponent';
			}
			else if (week == 16) {
				nextGamesString = 'Semifinal opponent';
			}
			else if (week == 15) {
				nextGamesString = 'Last game';
			}
			else if (week == 14) {
				nextGamesString = 'Last two';
			}
			else if (week == 13) {
				nextGamesString = 'Last three';
			}
			else if (week <= 12) {
				nextGamesString = 'Next three';
			}

			console.log("\t" + winner.name + ' ' + (winner.name.indexOf('/') != -1 ? 'defeat' : 'defeats') + ' ' + loser.name + ', ' + winner.score.toFixed(2) + ' to ' + loser.score.toFixed(2));

			if (isJaguarGame(winner.name, loser.name)) {
				console.log("\t\tJAGUAR GAME");
			}

			console.log("\t\t" + winner.name);

			console.log("\t\t\t" + selectedRpos[winner.name].offerer + ' offered ' + selectedRpos[winner.name].player.name + ' and ' + offeredRpos[winner.name].player.name);
			console.log("\t\t\t" + selectedRpos[winner.name].selector + ' selected ' + selectedRpos[winner.name].player.name + ' (' + selectedRpos[winner.name].player.points.toFixed(2) + ')');
			console.log("\t\t\t" + selectedRpos[winner.name].offerer + ' received ' + offeredRpos[winner.name].player.name + ' (' + offeredRpos[winner.name].player.points.toFixed(2) + ')');

			console.log("\t\t\t" + winner.name + ' to ' + winner.record.straight.cumulative.wins + '-' + winner.record.straight.cumulative.losses + (week > 7 && week < 16 ? ' (' + percentagesData[winner.franchiseId].playoffs.tripleSlash + ')' : ''));
			if (nextWeeksGamesFor[winner.name]) {
				console.log("\t\t\t" + nextGamesString + ': ' + nextWeeksGamesFor[winner.name].join(', '));
			}

			console.log("\t\t" + loser.name);

			console.log("\t\t\t" + selectedRpos[loser.name].offerer + ' offered ' + selectedRpos[loser.name].player.name + ' and ' + offeredRpos[loser.name].player.name);
			console.log("\t\t\t" + selectedRpos[loser.name].selector + ' selected ' + selectedRpos[loser.name].player.name + ' (' + selectedRpos[loser.name].player.points.toFixed(2) + ')');
			console.log("\t\t\t" + selectedRpos[loser.name].offerer + ' received ' + offeredRpos[loser.name].player.name + ' (' + offeredRpos[loser.name].player.points.toFixed(2) + ')');

			console.log("\t\t\t" + loser.name + ' to ' + loser.record.straight.cumulative.wins + '-' + loser.record.straight.cumulative.losses + (week > 7 && week < 16 ? ' (' + percentagesData[loser.franchiseId].playoffs.tripleSlash + ')' : ''));

			if (nextWeeksGamesFor[loser.name]) {
				console.log("\t\t\t" + nextGamesString + ': ' + nextWeeksGamesFor[loser.name].join(', '));
			}

			console.log("\t\t" + 'RPO_MATCHUP_SUMMARY');
			console.log("\t\t" + 'Pat projection: WHICH_TEAM (RIGHTWRONG); ' + (lastWeekCohost || 'LAST_WEEK_COHOST') + ' prediction: WHICH_TEAM (RIGHTWRONG)');
		});

		console.log("\t" + 'RPO Stats');
		console.log("\t\t" + 'OVERALL_SCORE');
		console.log("\t\t" + 'Selector');
		console.log("\t\t\t" + 'This week');
		console.log("\t\t\t\t" + 'Pat: MY_RPO_RECORD_THIS_WEEK');
		console.log("\t\t\t\t" + (lastWeekCohost || 'LAST_WEEK_COHOST') + ': ' + (lastWeekCohost ? lastWeekCohost.toUpperCase() : 'LAST_WEEK_COHOST') + '_RPO_RECORD_THIS_WEEK');
		console.log("\t\t\t\t" + 'Total: TOTAL_RPO_RECORD_THIS_WEEK');
		console.log("\t\t\t" + 'Overall');
		console.log("\t\t\t\t" + 'Pat: MY_OVERALL_RPO_RECORD');
		console.log("\t\t\t\t" + 'The World: ' + 'THE_WORLD_OVERALL_RPO_RECORD');
		console.log("\t\t\t\t" + 'Total: TOTAL_OVERALL_RPO_RECORD');
		console.log("\t" + 'Prognostication Stats');
		console.log("\t\t" + 'Pat\'s projections');
		console.log("\t\t\t" + 'This week: PATS_PROJECTIONS_RECORD_THIS_WEEK');
		console.log("\t\t\t" + 'Overall: PATS_PROJECTIONS_OVERALL_RECORD');
		console.log("\t\t" + 'The World\'s predictions');
		console.log("\t\t\t" + 'This week: WORLD_PREDICTIONS_RECORD_THIS_WEEK');
		console.log("\t\t\t" + 'Overall: WORLD_PREDICTIONS_OVERALL_RECORD');
		console.log();
	}

	console.log('Transactions');
	console.log();

	console.log('Discussion Topic: IS_THERE_ONE');
	console.log();

	var previewWeek = 'Week ' + week;

	if (week == 16) {
		previewWeek = 'the Semifinals';
	}
	else if (week == 17) {
		previewWeek = 'the Championship Round';
	}

	if (week < 18) {
		console.log('Game Previews and Risky Player Options for ' + previewWeek);

		thisWeek.forEach(game => {
			var away = game.away;
			var home = game.home;

			if (week == 1) {
				console.log("\t" + away.name + ' vs. ' + home.name);
			}
			else {
				var lastWeekAway = lastWeek.filter(lastWeekGame => away.franchiseId == lastWeekGame.away.franchiseId || away.franchiseId == lastWeekGame.home.franchiseId)[0];
				var lastWeekHome = lastWeek.filter(lastWeekGame => home.franchiseId == lastWeekGame.away.franchiseId || home.franchiseId == lastWeekGame.home.franchiseId)[0];

				var awayRecordId;
				var homeRecordId;

				if (away.franchiseId == lastWeekAway.away.franchiseId) {
					awayRecordId = 'away';
				}
				else if (away.franchiseId == lastWeekAway.home.franchiseId) {
					awayRecordId = 'home';
				}
			
				if (home.franchiseId == lastWeekHome.away.franchiseId) {
					homeRecordId = 'away';
				}
				else if (home.franchiseId == lastWeekHome.home.franchiseId) {
					homeRecordId = 'home';
				}
			
				away.record = {
					straight: {
						cumulative: {
							wins: lastWeekAway[awayRecordId].record.straight.cumulative.wins,
							losses: lastWeekAway[awayRecordId].record.straight.cumulative.losses
						}
					}
				};

				home.record = {
					straight: {
						cumulative: {
							wins: lastWeekHome[homeRecordId].record.straight.cumulative.wins,
							losses: lastWeekHome[homeRecordId].record.straight.cumulative.losses
						}
					}
				};

				if (week > 7 && week < 16) {
					console.log("\t" + away.name + ' (' + away.record.straight.cumulative.wins + '-' + away.record.straight.cumulative.losses + ', ' + percentagesData[away.franchiseId].playoffs.tripleSlash + ', ' + Math.round(percentagesData[away.franchiseId].results[week].rate * 100) + '%) vs. ' + home.name + ' (' + home.record.straight.cumulative.wins + '-' + home.record.straight.cumulative.losses + ', ' + percentagesData[home.franchiseId].playoffs.tripleSlash + ', ' + Math.round(percentagesData[home.franchiseId].results[week].rate * 100) + '%)');
				}
				else {
					console.log("\t" + away.name + ' (' + away.record.straight.cumulative.wins + '-' + away.record.straight.cumulative.losses + ') vs. ' + home.name + ' (' + home.record.straight.cumulative.wins + '-' + home.record.straight.cumulative.losses + ')');
				}
			}

			if (isJaguarGame(away.name, home.name)) {
				console.log("\t\tJAGUAR GAME");
			}

			if (week > 7 && week < 16) {
				console.log("\t\t" + 'Playoff interest level: ' + (percentagesData[away.franchiseId].playoffs.interestLevel + percentagesData[home.franchiseId].playoffs.interestLevel).toFixed(3));
				console.log("\t\t" + 'Decision interest level: ' + (percentagesData[away.franchiseId].decision.interestLevel + percentagesData[home.franchiseId].decision.interestLevel).toFixed(3));
			}

			console.log("\t\t" + 'NOTE_ABOUT_' + away.name.toUpperCase().replace(/\//, ''));
			console.log("\t\t" + 'NOTE_ABOUT_' + home.name.toUpperCase().replace(/\//, ''));
			console.log("\t\t" + 'HOST_1 takes ' + away.name);
			console.log("\t\t" + 'HOST_2 takes ' + home.name);
			console.log("\t\t" + 'Pat projection: PAT_PROJECTION');
			console.log("\t\t" + (cohost || 'COHOST') + ' prediction');
		});

		console.log();
	}

	if (week > 1) {
		console.log('High Scorer\'s Corner: ' + highScorerLastWeek.winner.name);
		console.log("\tAPPLAUSE")
		console.log("\t" + highScorerLastWeek.winner.name + ' scored ' + highScorerLastWeek.winner.score.toFixed(2));
		console.log("\t" + ordinal(highScorerSeason.length) + ' scoring title this season');
		console.log("\t" + ordinal(highScorerAllTime.value) + ' scoring title all-time (WHAT_RANK overall)');
		console.log("\t" + 'HIGH_SCORERS_CORNER_DITTY');
		console.log();
	}

	console.log('Co-Host\'s Final Thoughts');
	console.log();

	var outroWeek = 'Week ' + week;

	if (week == 16) {
		outroWeek = 'the semifinals';
	}
	else if (week == 17) {
		outroWeek = 'the championship round';
	}
	else if (week == 18) {
		outroWeek = 'the offseason';
	}

	var outroNextWeek = (week != 18) ? 'next week' : 'very soon';

	console.log('Plugs');
	console.log("\t" + 'Thanks for sending in RPOs');
	console.log("\t" + '@PsoScuttlebutt');
	console.log("\t" + 'Websites');
	console.log("\t" + 'For ' + (cohost || 'COHOST') + ', I am Patrick. Good luck with your fantasy in ' + outroWeek + '! We will talk to you ' + outroNextWeek + '!');

	mongoose.disconnect();
}).catch(error => {
	console.log(error);
	process.exit(1);
});
