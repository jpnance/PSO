var dotenv = require('dotenv').config({ path: '/app/.env' });

var fs = require('fs');

var PSO = require('../pso.js');
var Game = require('../models/Game');

var mongoose = require('mongoose');
mongoose.promise = global.Promise;
mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });

var percentagesData = JSON.parse(fs.readFileSync('../public/data/percentages.json', 'utf8'));

Game.find({ season: process.env.SEASON }).sort({ week: 1 }).then(games => {
	var thisWeeksGames = games.filter(game => game.week == 8);

	thisWeeksGames.forEach(game => {
		var opponents = ['away', 'home'].map(key => {
			var playoffsData = percentagesData[game[key].franchiseId]['playoffs'];
			var tripleSlash = niceRate(playoffsData.neutral.rate) + '/' + niceRate(playoffsData.withWin.rate) + '/' + niceRate(playoffsData.withLoss.rate);

			var interestLevel = playoffsData.interestLevel;

			return {
				name: game[key].name,
				tripleSlash: tripleSlash,
				interestLevel: interestLevel
			};
		})

		var tripleSlashes = opponents.map(opponent => `${opponent.name} (${opponent.tripleSlash})`).join(' vs. ');

		var totalInterestLevel = opponents.reduce((totalInterestLevel, opponent) => {
			return totalInterestLevel + opponent.interestLevel;
		}, 0);

		console.log(`${tripleSlashes}: ${totalInterestLevel}`);
	});

	mongoose.disconnect();
});

function niceRate(rate) {
	var roundedRate = rate.toFixed(3);

	if (roundedRate[0] == '1') {
		return '1.000';
	}
	else {
		return roundedRate.substring(1);
	}
}
