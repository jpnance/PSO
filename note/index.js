var dotenv = require('dotenv').config({ path: '../.env' });

var Game = require('../models/Game');

var mongoose = require('mongoose');
mongoose.promise = global.Promise;
mongoose.connect('mongodb://localhost:27017/pso_dev', { useNewUrlParser: true, useUnifiedTopology: true });

if (process.argv.length < 3) {
	console.log('Invalid week');
	console.log('Usage: node index.js <week> [co-host name]');
	process.exit();
}

var week = parseInt(process.argv[2]);
var cohost = process.argv[3];

function ordinal(number) {
	if (number == 1) {
		return '1st';
	}
	else if (number == 2) {
		return '2nd';
	}
	else if (number == 3) {
		return '3rd';
	}
	else if (number <= 14) {
		return number + 'th';
	}

	return number;
};

var dataPromises = [
	Game.find({ season: process.env.SEASON }).sort({ week: 1 })
];

Promise.all(dataPromises).then(function(values) {
	var games = values[0];

	var lastWeek = games.filter(game => game.week == week - 1);
	var thisWeek = games.filter(game => game.week == week);
	var nextWeeks = games.filter(game => game.week >= week && game.week <= week + 2);
	var highScorerLastWeek = games.filter(game => game.week == (week - 1) && ((game.winner.franchiseId == game.home.franchiseId && game.home.record.allPlay.week.wins == 11) || (game.winner.franchiseId == game.away.franchiseId && game.away.record.allPlay.week.wins == 11)))[0];
	var highScorerSeason = games.filter(game => ((game.winner.franchiseId == highScorerLastWeek.winner.franchiseId && game.home.record.allPlay.week.wins == 11) || (game.winner.franchiseId == highScorerLastWeek.winner.franchiseId && game.away.record.allPlay.week.wins == 11)));

	console.log('Intro');
	console.log("\t" + 'Welcome to the PSO Show for Week ' + week + ' of the ' + process.env.SEASON + ' season!');
	console.log("\t" + 'I am Patrick, joined, as always, by ' + (cohost || 'WHO_IS_YOUR_COHOSTING'));
	console.log("\t" + 'BANTER_PROMPT');
	console.log();

	console.log('Week ' + (week - 1) + ' Recaps')

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

	lastWeek.forEach(game => {
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

		if (nextWeeksGamesFor[winner.name].length == 1) {
			nextGamesString = 'Last game';
		}
		else if (nextWeeksGamesFor[winner.name].length == 2) {
			nextGamesString = 'Last two';
		}
		else if (nextWeeksGamesFor[winner.name].length == 3 && week == 12) {
			nextGamesString = 'Last three';
		}
		else {
			nextGamesString = 'Next three';
		}

		console.log("\t" + winner.name + ' ' + (winner.name.indexOf('/') != -1 ? 'defeat' : 'defeats') + ' ' + loser.name + ', ' + winner.score.toFixed(2) + ' to ' + loser.score.toFixed(2));
		console.log("\t\t" + winner.name);
		console.log("\t\t\t" + 'HOST_1 offered PLAYER_1 and PLAYER_2');
		console.log("\t\t\t" + 'HOST_2 selected PLAYER_1 (PLAYER_1_SCORE)');
		console.log("\t\t\t" + 'HOST_1 received PLAYER_2 (PLAYER_2_SCORE)');
		console.log("\t\t\t" + winner.name + ' to ' + winner.record.straight.cumulative.wins + '-' + winner.record.straight.cumulative.losses);
		console.log("\t\t\t" + nextGamesString + ': ' + nextWeeksGamesFor[winner.name].join(', '));
		console.log("\t\t" + loser.name);
		console.log("\t\t\t" + 'HOST_2 offered PLAYER_1 and PLAYER_2');
		console.log("\t\t\t" + 'HOST_1 selected PLAYER_1 (PLAYER_1_SCORE)');
		console.log("\t\t\t" + 'HOST_2 received PLAYER_2 (PLAYER_2_SCORE)');
		console.log("\t\t\t" + loser.name + ' to ' + loser.record.straight.cumulative.wins + '-' + loser.record.straight.cumulative.losses);
		console.log("\t\t\t" + nextGamesString + ': ' + nextWeeksGamesFor[loser.name].join(', '));
		console.log("\t\t" + 'RPO_MATCHUP_SUMMARY');
		console.log("\t\t" + 'Pat projection: WHICH_TEAM (RIGHTWRONG); ' + (cohost || 'COHOST') + ' prediction: WHICH_TEAM (RIGHTWRONG)');
	});

	console.log("\t" + 'RPO Stats');
	console.log("\t\t" + 'OVERALL_SCORE');
	console.log("\t\t" + 'Selector');
	console.log("\t\t\t" + 'This week');
	console.log("\t\t\t\t" + 'Pat: MY_RPO_RECORD_THIS_WEEK');
	console.log("\t\t\t\t" + (cohost || 'COHOST') + ': ' + (cohost ? cohost.toUpperCase() : 'COHOST') + '_RPO_RECORD_THIS_WEEK');
	console.log("\t\t\t\t" + 'Total: TOTAL_RPO_RECORD_THIS_WEEK');
	console.log("\t\t\t" + 'Overall');
	console.log("\t\t\t\t" + 'Pat: MY_OVERALL_RPO_RECORD');
	console.log("\t\t\t\t" + (cohost || 'COHOST') + ': ' + (cohost ? cohost.toUpperCase() : 'COHOST') + '_OVERALL_RPO_RECORD');
	console.log("\t\t\t\t" + 'Total: TOTAL_OVERALL_RPO_RECORD');
	console.log("\t" + 'Prognostication Stats');
	console.log("\t\t" + 'Pat\'s projections');
	console.log("\t\t\t" + 'This week: PATS_PROJECTIONS_RECORD_THIS_WEEK');
	console.log("\t\t\t" + 'Overall: PATS_PROJECTIONS_OVERALL_RECORD');
	console.log("\t\t" + 'Charles\'s predictions');
	console.log("\t\t\t" + 'This week: CHARLES_PREDICTIONS_RECORD_THIS_WEEK');
	console.log("\t\t\t" + 'Overall: CHARLES_PREDICTIONS_OVERALL_RECORD');
	console.log();

	console.log('Transactions');
	console.log();

	console.log('Discussion Topic: IS_THERE_ONE');
	console.log();

	console.log('Week ' + week + ' Game Previews and Risky Player Options');

	thisWeek.forEach(game => {
		var away = game.away;
		var home = game.home;

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

		console.log("\t" + away.name + ' (' + away.record.straight.cumulative.wins + '-' + away.record.straight.cumulative.losses + ') vs. ' + home.name + ' (' + home.record.straight.cumulative.wins + '-' + home.record.straight.cumulative.losses + ')');
		console.log("\t\t" + 'NOTE_ABOUT_' + away.name.toUpperCase().replace(/\//, ''));
		console.log("\t\t" + 'NOTE_ABOUT_' + home.name.toUpperCase().replace(/\//, ''));
		console.log("\t\t" + 'HOST_1 takes ' + away.name); 
		console.log("\t\t" + 'HOST_2 takes ' + home.name);
	});

	console.log();

	console.log('High Scorer\'s Corner: ' + highScorerLastWeek.winner.name);
	console.log("\t" + highScorerLastWeek.winner.name + ' scored ' + highScorerLastWeek.winner.score.toFixed(2));
	console.log("\t" + ordinal(highScorerSeason.length) + ' scoring title this season');
	console.log("\t" + 'HIGH_SCORERS_CORNER_DITTY');
	console.log();

	console.log('Plugs');
	console.log("\t" + '@PsoScuttlebutt');
	console.log("\t" + 'Websites');
	console.log("\t" + 'Good luck with your fantasy in Week ' + week + ', everybody! We will talk to you next week!');

	mongoose.disconnect();
});
