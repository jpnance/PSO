var dotenv = require('dotenv').config({ path: '/app/.env' });

var fs = require('fs');

var PSO = require('../../config/pso.js');
var Game = require('../../models/Game');
var Leaders = require('../../models/Leaders');

var mongoose = require('mongoose');
mongoose.promise = global.Promise;
mongoose.connect(process.env.MONGODB_URI);

var args = process.argv.slice(2);
var outputHtml = args.includes('--html');

args = args.filter((arg) => arg != '--html');

if (args.length < 1) {
	console.log('Invalid week');
	console.log('Usage: node index.js <week> <co-host name> <last week co-host name> <last week\'s games order> <this week\'s games order> [--html]');
	process.exit();
}

var season = PSO.season;

var week = parseInt(args[0]);
var cohost = args[1];
var lastWeekCohost = args[2] || cohost;
var lastWeekGamesOrder = args[3]?.split(',').map((index) => parseInt(index));
var thisWeekGamesOrder = args[4]?.split(',').map((index) => parseInt(index));

var openLists = 0;

function escapeHtml(text) {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Markdown by default; --html produces nested <ul> that pastes into Google Docs as a real list
function bullet(depth, text) {
	if (!outputHtml) {
		console.log('  '.repeat(depth) + '- ' + text);
		return;
	}

	while (openLists <= depth) {
		console.log('<ul>');
		openLists++;
	}

	while (openLists > depth + 1) {
		console.log('</ul>');
		openLists--;
	}

	console.log('<li>' + escapeHtml(text) + '</li>');
}

function endBullets() {
	while (openLists > 0) {
		console.log('</ul>');
		openLists--;
	}
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
	var jaguarOwners = ['Keyon', 'Luke', 'Patrick', 'Schexes'];

	return jaguarOwners.includes(franchiseOne) && jaguarOwners.includes(franchiseTwo);
}

var dataPromises = [
	Game.find({ season: season }).sort({ week: 1 }),
	Leaders.WeeklyScoringTitles.find().sort({ value: -1 })
];

Promise.all(dataPromises).then(function(values) {
	var games = values[0];
	var scoringTitles = values[1];

	if (week > 7) {
		var percentagesData = JSON.parse(fs.readFileSync('../../public/data/percentages.json', 'utf8'));

		Object.keys(percentagesData).forEach(franchiseId => {
			['playoffs', 'decision'].forEach((outcome) => {
				percentagesData[franchiseId][outcome].tripleSlash = niceRate(percentagesData[franchiseId][outcome].neutral.rate) + '/' + niceRate(percentagesData[franchiseId][outcome].withWin.rate) + '/' + niceRate(percentagesData[franchiseId][outcome].withLoss.rate);
			});
		});
	}

	var lastWeek = games.filter(game => game.week == week - 1);
	var thisWeek = games.filter(game => game.week == week);
	var nextWeeks = games.filter(game => game.week >= week && game.week <= week + 2);

	if (!lastWeekGamesOrder) {
		console.log('Specify the order in which to include the games last week as a CSV string (e.g. 1,3,5,2,4,6).');

		lastWeek.forEach((lastWeekGame, i) => {
			console.log(i + 1, lastWeekGame.away.name, 'vs.', lastWeekGame.home.name);
		});

		process.exit();
	}

	if (!thisWeekGamesOrder) {
		console.log('Specify the order in which to include the games this week as a CSV string (e.g. 1,3,5,2,4,6).');

		thisWeek.forEach((thisWeekGame, i) => {
			console.log(i + 1, thisWeekGame.away.name, 'vs.', thisWeekGame.home.name);
		});

		process.exit();
	}

	var orderedLastWeek = [];

	lastWeekGamesOrder.forEach((gameId) => {
		orderedLastWeek.push(lastWeek[gameId - 1]);
	});

	lastWeek = orderedLastWeek;

	var orderedThisWeek = [];

	thisWeekGamesOrder.forEach((gameId) => {
		orderedThisWeek.push(thisWeek[gameId - 1]);
	});

	thisWeek = orderedThisWeek;

	if (week > 1) {
		var highScorerAllPlayWins = (week <= 16) ? 11 : 3;
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

	bullet(0, 'SOUND EFFECTS');
	bullet(0, 'DID ANY TEAMS GET ELIMINATED THIS WEEK?');
	bullet(0, 'Intro');
	bullet(1, 'Welcome to the PSO Show for ' + introWeek + ' of the ' + PSO.season + ' season!');
	bullet(1, 'I am Patrick, joined, as always, by ' + (cohost || 'WHO_IS_YOUR_COHOST'));

	if (week > 1) {
		bullet(0, 'Week ' + (week - 1) + ' Recaps');

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

			bullet(1, winner.name + ' ' + (winner.name.indexOf('/') != -1 ? 'defeat' : 'defeats') + ' ' + loser.name + ', ' + winner.score.toFixed(2) + ' to ' + loser.score.toFixed(2));

			if (isJaguarGame(winner.name, loser.name)) {
				bullet(2, 'JAGUAR GAME');
			}

			bullet(2, winner.name);
			bullet(3, winner.name + ' to ' + winner.record.straight.cumulative.wins + '-' + winner.record.straight.cumulative.losses + (week > 7 && week < 16 ? ' (' + percentagesData[winner.franchiseId].playoffs.tripleSlash + ')' : ''));
			if (nextWeeksGamesFor[winner.name]) {
				bullet(3, nextGamesString + ': ' + nextWeeksGamesFor[winner.name].join(', '));
			}

			bullet(2, loser.name);
			bullet(3, loser.name + ' to ' + loser.record.straight.cumulative.wins + '-' + loser.record.straight.cumulative.losses + (week > 7 && week < 16 ? ' (' + percentagesData[loser.franchiseId].playoffs.tripleSlash + ')' : ''));

			if (nextWeeksGamesFor[loser.name]) {
				bullet(3, nextGamesString + ': ' + nextWeeksGamesFor[loser.name].join(', '));
			}

			bullet(2, 'Pat projection: WHICH_TEAM (RIGHTWRONG); ' + (lastWeekCohost || 'LAST_WEEK_COHOST') + ' prediction: WHICH_TEAM (RIGHTWRONG)');
		});

		bullet(1, 'Prognostication Stats');
		bullet(2, 'Pat\'s projections');
		bullet(3, 'This week: PATS_PROJECTIONS_RECORD_THIS_WEEK');
		bullet(3, 'Overall: PATS_PROJECTIONS_OVERALL_RECORD');
		bullet(2, 'The World\'s predictions');
		bullet(3, 'This week: WORLD_PREDICTIONS_RECORD_THIS_WEEK');
		bullet(3, 'Overall: WORLD_PREDICTIONS_OVERALL_RECORD');
	}

	bullet(0, 'Transactions');
	bullet(0, 'Discussion Topic: IS_THERE_ONE');

	var previewWeek = 'Week ' + week;

	if (week == 16) {
		previewWeek = 'the Semifinals';
	}
	else if (week == 17) {
		previewWeek = 'the Championship Round';
	}

	if (week < 18) {
		bullet(0, 'Game Previews for ' + previewWeek);

		thisWeek.forEach(game => {
			var away = game.away;
			var home = game.home;

			if (week == 1) {
				bullet(1, away.name + ' vs. ' + home.name);
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
					bullet(1, away.name + ' (' + away.record.straight.cumulative.wins + '-' + away.record.straight.cumulative.losses + ', ' + percentagesData[away.franchiseId].playoffs.tripleSlash + ', ' + Math.round(percentagesData[away.franchiseId].results[week].rate * 100) + '%) vs. ' + home.name + ' (' + home.record.straight.cumulative.wins + '-' + home.record.straight.cumulative.losses + ', ' + percentagesData[home.franchiseId].playoffs.tripleSlash + ', ' + Math.round(percentagesData[home.franchiseId].results[week].rate * 100) + '%)');
				}
				else {
					bullet(1, away.name + ' (' + away.record.straight.cumulative.wins + '-' + away.record.straight.cumulative.losses + ') vs. ' + home.name + ' (' + home.record.straight.cumulative.wins + '-' + home.record.straight.cumulative.losses + ')');
				}
			}

			if (isJaguarGame(away.name, home.name)) {
				bullet(2, 'JAGUAR GAME');
			}

			if (week > 7 && week < 16) {
				bullet(2, 'Playoff interest level: ' + (percentagesData[away.franchiseId].playoffs.interestLevel + percentagesData[home.franchiseId].playoffs.interestLevel).toFixed(3));
				bullet(2, 'Decision interest level: ' + (percentagesData[away.franchiseId].decision.interestLevel + percentagesData[home.franchiseId].decision.interestLevel).toFixed(3));
			}

			bullet(2, 'NOTE_ABOUT_' + away.name.toUpperCase().replace(/\//, ''));
			bullet(2, 'NOTE_ABOUT_' + home.name.toUpperCase().replace(/\//, ''));
			bullet(2, 'HOST_1 takes ' + away.name);
			bullet(2, 'HOST_2 takes ' + home.name);
			bullet(2, 'Pat projection: PAT_PROJECTION');
			bullet(2, (cohost || 'COHOST') + ' prediction');
		});
	}

	if (week > 1) {
		bullet(0, 'High Scorer\'s Corner: ' + highScorerLastWeek.winner.name);
		bullet(1, 'APPLAUSE');
		bullet(1, highScorerLastWeek.winner.name + ' scored ' + highScorerLastWeek.winner.score.toFixed(2));
		bullet(1, ordinal(highScorerSeason.length) + ' scoring title this season');
		bullet(1, ordinal(highScorerAllTime.value) + ' scoring title all-time (WHAT_RANK overall)');
		bullet(1, 'HIGH_SCORERS_CORNER_DITTY');
	}

	bullet(0, 'Co-Host\'s Final Thoughts');

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

	bullet(0, 'Plugs');
	bullet(1, 'Slash Scuttlebot');
	bullet(1, 'Websites');
	bullet(1, 'And that is it');
	bullet(1, 'For ' + (cohost || 'COHOST') + ', I am Patrick. Good luck with your fantasy in ' + outroWeek + '! We will talk to you ' + outroNextWeek + '!');

	endBullets();

	mongoose.disconnect();
}).catch(error => {
	console.log(error);
	process.exit(1);
});
