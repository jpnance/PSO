/*
	This was a quick way to find the high score of each regular season.
*/

var dotenv = require('dotenv').config({ path: '/app/.env' });

var mongoose = require('mongoose');
mongoose.Promise = global.Promise;
mongoose.connect(process.env.MONGODB_URI);

var Game = require('../models/Game');

var data = {};

Game.find({ type: 'regular', winner: { '$exists': true } }).sort({ data: 1, week: 1 }).then(games => {
	games.forEach(game => {
		if (!data[game.season]) {
			data[game.season] = { name: null, score: 0 };
		}

		if (game.winner.score > data[game.season].score) {
			data[game.season].name = game.winner.name;
			data[game.season].score = game.winner.score;
		}
	});

	//console.log(JSON.stringify(data, null, '    '));
	console.log(data);
	mongoose.disconnect();
});
