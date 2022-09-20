var dotenv = require('dotenv').config({ path: '/app/.env' });

var Game = require('../models/Game');

var mongoose = require('mongoose');
mongoose.promise = global.Promise;
mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });

var calledIt = { weeks: {} };
var trials = 1000;

Game.find({ type: 'regular', 'away.score': { '$exists': true }, 'home.score': { '$exists': true } }).sort({ season: 1, week: 1 }).then(games => {
	for (var i = 0; i < trials; i++) {
		var season = null;
		var franchiseSeasonStats = {};

		games.forEach(game => {
			if (!season || game.season != season) {
				season = game.season;
				franchiseSeasonStats = {};
			}

			['away', 'home'].forEach(side => {
				if (!franchiseSeasonStats[game[side].name]) {
					franchiseSeasonStats[game[side].name] = {
						scores: [],
						average: null,
						stdev: null
					}
				}

				//game[side].fakeScore = generateScore(franchiseSeasonStats[game[side].name].average, franchiseSeasonStats[game[side].name].stdev);
				game[side].fakeScore = Math.random() + (game[side].record.allPlay.cumulative.wins - game[side].record.allPlay.week.wins);

				franchiseSeasonStats[game[side].name].scores.push(game[side].score);

				franchiseSeasonStats[game[side].name].average = average(franchiseSeasonStats[game[side].name].scores);
				franchiseSeasonStats[game[side].name].stdev = stdev(franchiseSeasonStats[game[side].name].scores, franchiseSeasonStats[game[side].name].average);
			});

			if (game.week > 0) {
				if (!calledIt[game.week]) {
					calledIt[game.week] = { wins: 0, losses: 0 };
				}

				if ((game.away.fakeScore > game.home.fakeScore && game.away.score > game.home.score) || (game.home.fakeScore > game.away.fakeScore && game.home.score > game.away.score)) {
					calledIt[game.week].wins += 1;
				}
				else {
					calledIt[game.week].losses += 1;
				}
			}
		});
	}

	console.log(calledIt);
	mongoose.disconnect();
});


function average(scores) {
	var sum = 0;

	scores.forEach(score => {
		sum += score;
	});

	return sum / scores.length;
}

function stdev(scores, average) {
	var variance = 0;

	scores.forEach(score => {
		variance += Math.pow(score - average, 2);
	});

	return Math.sqrt(variance / (scores.length - 1));
}

function generateScore(average, stdev) {
	if (!stdev) {
		return average;
	}

	var sum = 0;

	for (var i = 0; i < 12; i++) {
		sum += Math.random();
	}

	return ((sum - 6) * (stdev / 2)) + average;
}
