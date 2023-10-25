/*
	This outputs any time it sees that a team has the highest PF and lowest PA starting in Week 7 or later each season.
*/

var dotenv = require('dotenv').config({ path: '/app/.env' });

var mongoose = require('mongoose');
mongoose.Promise = global.Promise;
mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });

var Game = require('../models/Game');

var seasons = {};

Game.find({ type: 'regular', winner: { '$exists': true } }).sort({ season: 1, week: 1 }).then(games => {
	var gamesBySeasonAndWeek = games.reduce(reduceGamesBySeasonAndWeek, {});

	var seasons = Object.keys(gamesBySeasonAndWeek);

	seasons.forEach(seasonId => {
		console.group(seasonId);

		var weeks = gamesBySeasonAndWeek[seasonId];

		var runningTotals = weeks.reduce(reduceSeasonToRunningTotals, []);

		console.groupEnd();
	});

	mongoose.disconnect();
});

function reduceGamesBySeasonAndWeek(gamesBySeasonAndWeek, game) {
	var season = game.season;
	var i = game.week - 1;

	gamesBySeasonAndWeek[season] = gamesBySeasonAndWeek[season] ?? [];

	gamesBySeasonAndWeek[season][i] = gamesBySeasonAndWeek[season][i] ?? [];

	gamesBySeasonAndWeek[season][i].push(game);

	return gamesBySeasonAndWeek;
}

var GLOBAL = 0;

function reduceSeasonToRunningTotals(runningTotals, games) {
	var week = games[0].week;

	var flatPerformances = games.reduce(reduceGameToFlatPerformances, []);

	var newRunningTotals = runningTotals.concat(flatPerformances).reduce(sumPerformances, []);

	if (week >= 7) {
		var highestPf = newRunningTotals.reduce(findHighestPf);
		var lowestPa = newRunningTotals.reduce(findLowestPf);

		if (highestPf === lowestPa) {
			var { owner, pf, pa, record } = highestPf;

			console.log(`Week ${week}: ${owner} (${record.wins}-${record.losses}-${record.ties}) / ${pf.toFixed(2)} PF / ${pa.toFixed(2)} PA`);
		}
	}

	return newRunningTotals;
}

function reduceGameToFlatPerformances(flatPerformances, game) {
	var sidePairs = [ { us: 'away', them: 'home' }, { us: 'home', them: 'away' } ];

	sidePairs.forEach(({ us, them }) => {
		flatPerformances.push({
			owner: game[us].name,
			pf: game[us].score,
			pa: game[them].score,
			record: game[us].record.straight.cumulative
		});
	});

	return flatPerformances;
}

function sumPerformances(runningTotals, performance) {
	var existingRunningTotal = runningTotals.find(runningTotal => runningTotal.owner === performance.owner);

	if (!existingRunningTotal) {
		runningTotals.push(performance);
	}
	else {
		Object.assign(existingRunningTotal, addPerformances(existingRunningTotal, performance));
	}

	return runningTotals;
}

function addPerformances(a, b) {
	return {
		owner: a.owner,
		pf: a.pf + b.pf,
		pa: a.pa + b.pa,
		record: {
			wins: Math.max(a.record.wins, b.record.wins),
			losses: Math.max(a.record.losses, b.record.losses),
			ties: Math.max(a.record.ties, b.record.ties)
		}
	};
}

function findHighestPf(highest, current) {
	if (!highest || current.pf > highest.pf) {
		return current;
	}

	return highest;
}

function findLowestPf(lowest, current) {
	if (!lowest || current.pa < lowest.pa) {
		return current;
	}

	return lowest;
}
