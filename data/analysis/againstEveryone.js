/*
	This shows everybody's head-to-head record against everyone else in the current (regular) season
*/

var dotenv = require('dotenv').config({ path: '/app/.env' });
var PSO = require('../../config/pso');

var mongoose = require('mongoose');
mongoose.Promise = global.Promise;
mongoose.connect(process.env.MONGODB_URI);

var Game = require('../models/Game');

var weeks = {};
var owners = {};

Game.find({
	season: PSO.season,
	type: 'regular',
	winner: { '$exists': true }
}).then(games => {
	var owners = games.reduce(extractOwners, []);
	var weeks = games.reduce(extractWeeks, []);

	var weekResults = games.reduce(extractWeekResults, {});

	var ownerResults = computerOwnerResults(owners, weeks, weekResults);

	displayOwnerResults(ownerResults);

	mongoose.disconnect();
});

function extractOwners(owners, game) {
	if (!owners.includes(game.winner.name)) {
		owners.push(game.winner.name);
	}

	if (!owners.includes(game.loser.name)) {
		owners.push(game.loser.name);
	}

	return owners;
}

function extractWeeks(weeks, game) {
	if (!weeks.includes(game.week)) {
		weeks.push(game.week);
	}

	return weeks;
}

function extractWeekResults(weekResults, game) {
	var { week, winner, loser } = game;

	if (!weekResults[week]) {
		weekResults[week] = [];
	}

	weekResults[week].push({ name: winner.name, score: winner.score });
	weekResults[week].push({ name: loser.name, score: loser.score });

	weekResults[week].sort(sortByScore);

	return weekResults;
}

function sortByScore(a, b) {
	return b.score - a.score;
}

function byOwnerName(name) {
	return (owner) => owner.name == name;
}

function computerOwnerResults(owners, weeks, weekResults) {
	var ownerResults = {};

	for (var i = 0; i < owners.length; i++) {
		var ownerOne = owners[i];

		if (!ownerResults[ownerOne]) {
			ownerResults[ownerOne] = {};
		}

		for (var j = 0; j < owners.length; j++) {
			if (i == j) {
				continue;
			}

			var ownerTwo = owners[j];

			if (!ownerResults[ownerOne][ownerTwo]) {
				ownerResults[ownerOne][ownerTwo] = { wins: 0, losses: 0, ties: 0 };
			}

			for (var k = 0; k < weeks.length; k++) {
				var week = weeks[k];
				var weekResult = weekResults[week];

				var ownerOneScore = weekResult.find(byOwnerName(ownerOne)).score;
				var ownerTwoScore = weekResult.find(byOwnerName(ownerTwo)).score;

				if (ownerOneScore > ownerTwoScore) {
					ownerResults[ownerOne][ownerTwo].wins++;
				}
				else if (ownerOneScore < ownerTwoScore) {
					ownerResults[ownerOne][ownerTwo].losses++;
				}
				else {
					ownerResults[ownerOne][ownerTwo].ties++;
				}
			}
		}
	}

	return ownerResults;
}

function displayOwnerResults(ownerResults) {
	var owners = Object.keys(ownerResults).sort();
	var vsOwners = owners.map((owner) => `vs. ${owner}`);

	owners.forEach((ownerOne) => {
		console.log(ownerOne);

		console.group();

		owners.forEach((ownerTwo) => {
			if (ownerOne == ownerTwo) {
				return;
			}
			else {
				var results = ownerResults[ownerOne][ownerTwo];

				console.log(`vs. ${ownerTwo}: ${results.wins}-${results.losses}-${results.ties}`);
			}
		});

		console.groupEnd();
		console.log();
	});
}
