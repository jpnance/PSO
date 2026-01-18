/*
	This provides a quick overview of each regimes record in the playoffs.
*/

var dotenv = require('dotenv').config({ path: '/app/.env' });

var mongoose = require('mongoose');
mongoose.Promise = global.Promise;
mongoose.connect(process.env.MONGODB_URI);

var Game = require('../models/Game');
var PSO = require('../../config/pso');

Game.find({}).then(games => {
	const playoffRecords =
		games
			.filter(isPlayoffGame)
			.filter(isFinal)
			.reduce(aggregateResults, []);

	console.log(playoffRecords.map(formatPlayoffRecord).join('\n\n'));

	mongoose.disconnect();
});

function isPlayoffGame(game) {
	return ['semifinal', 'championship', 'thirdPlace'].includes(game.type);
}

function isFinal(game) {
	return game.winner.franchiseId && game.loser.franchiseId;
}

function extractUnique(key) {
	return (list, current) => {
		if (!list.includes(current[key])) {
			list.push(current[key]);
		}

		return list;
	};
}

function aggregateResults(results, current) {
	['away', 'home'].forEach((side) => {
		const { season, type, winner, loser } = current;
		const { name, franchiseId } = current[side];

		const regime = PSO.regimes[name];

		let result = results.find(by('name', regime));

		if (!result) {
			result = {
				name: regime,
				wins: 0,
				losses: 0,
				finishes: [],
			};

			results.push(result);
		}

		result = result ?? { wins: 0, losses: 0, finishes: [] };

		if (winner.franchiseId === franchiseId) {
			result.wins++;

			if (type === 'thirdPlace') {
				result.finishes.push({ season: season, place: 3 });
			}
			else if (type === 'championship') {
				result.finishes.push({ season: season, place: 1 });
			}
		}
		else if (loser.franchiseId === franchiseId) {
			result.losses++;

			if (type === 'thirdPlace') {
				result.finishes.push({ season: season, place: 4 });
			}
			else if (type === 'championship') {
				result.finishes.push({ season: season, place: 2 });
			}
		}
	});

	return results;
}

function by(key, value) {
	return (item) => item[key] === value;
}

function formatPlayoffRecord(playoffRecord) {
	const { name, wins, losses, finishes } = playoffRecord;

	const output = [
		`${name} ${wins}-${losses}`,
		...finishes.map(formatFinish),
	];

	return output.join('\n');
}

function formatFinish(finish) {
	const { place, season } = finish;

	return `${ordinal(place)} in ${season}`;
}

function ordinal(number) {
	switch (number) {
		case 1: return '1st';
		case 2: return '2nd';
		case 3: return '3rd';
		case 4: return '4th';
	}
}
