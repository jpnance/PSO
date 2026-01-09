var dotenv = require('dotenv').config({ path: '/app/.env' });

var mongoose = require('mongoose');
mongoose.Promise = global.Promise;
mongoose.connect(process.env.MONGODB_URI);

var Game = require('../models/Game');

var seasonWeeks = [];

Game.find({ type: 'regular', winner: { '$exists': true } }).sort({ week: 1 }).then(games => {
	games.forEach(game => {
		if (game.season < 2012) {
			return;
		}

		var seasonWeek = seasonWeeks.find(seasonWeek => seasonWeek.season == game.season && seasonWeek.week == game.week);

		if (!seasonWeek) {
			week = {
				season: game.season,
				week: game.week,
				scores: [],
			};

			seasonWeeks.push(week);
		}

		week.scores.push(game.home.score);
		week.scores.push(game.away.score);

		week.scores.sort((a, b) => b - a);

		week.pointsClear = week.scores[0] - week.scores[1]
	});

	seasonWeeks.sort((a, b) => b.pointsClear - a.pointsClear);

	console.log(JSON.stringify(seasonWeeks, null, '  '));
	mongoose.disconnect();
});
