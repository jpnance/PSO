/*
	This was a quick way to find the first week that somebody scored 200 in each season
*/

var dotenv = require('dotenv').config({ path: '/app/.env' });

var mongoose = require('mongoose');
mongoose.Promise = global.Promise;
mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });

var Game = require('../models/Game');

var data = {};

Game.find({
	type: 'regular',
	season: { '$gte': 2012 },
	winner: { '$exists': true }
}).sort({ data: 1, week: 1 }).then(games => {
	games.forEach(game => {
		if (!data[game.season]) {
			data[game.season] = { week: null, scores: [] };
		}

		if (game.winner.score >= 200 && (!data[game.season].week || game.week < data[game.season].week)) {
			data[game.season].week = game.week;
			data[game.season].scores.push({
				owner: game.winner.name,
				score: game.winner.score
			});

			if (game.loser.score >= 200) {
				data[game.season].scores.push({
					owner: game.loser.name,
					score: game.loser.score
				});
			}
		}
	});

	//console.log(JSON.stringify(data, null, '    '));
	//console.log(data);

	Object.entries(data).forEach(formatSeasonResult);

	mongoose.disconnect();
});

function formatSeasonResult(seasonResultTuple) {
	const [season, result] = seasonResultTuple;

	console.log(`${season}: Week ${result.week}`);
	result.scores.forEach(score => {
		console.log(`${score.owner} (${score.score.toFixed(2)})`);
	});

	console.log();
}
