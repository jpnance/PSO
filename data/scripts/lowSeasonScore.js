/*
	This was a quick way to find the low score of each regular season.
*/

var dotenv = require('dotenv').config({ path: '../.env' });

var mongoose = require('mongoose');
mongoose.Promise = global.Promise;
mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });

var Game = require('../models/Game');

var data = {};

Game.find({ type: 'regular', loser: { '$exists': true } }).sort({ data: 1, week: 1 }).then(games => {
	games.forEach(game => {
		if (!data[game.season]) {
			data[game.season] = { name: null, score: 10000 };
		}

		if (game.loser.score < data[game.season].score) {
			data[game.season].name = game.loser.name;
			data[game.season].score = game.loser.score;
		}
	});

	//console.log(JSON.stringify(data, null, '    '));
	console.log(data);
	mongoose.disconnect();
});
