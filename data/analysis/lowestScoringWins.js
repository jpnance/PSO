const dotenv = require('dotenv').config({ path: '/app/.env' });

const mongoose = require('mongoose');
mongoose.connect(process.env.MONGODB_URI);

const Game = require('../models/Game');

Game.aggregate([
	{
		$match: {
			type: 'regular',
			'away.score': { $exists: true },
			'home.score': { $exists: true }
		}
	},
	{
		$project: {
			_id: {
				$concat: [
					{ $toString: '$season' },
					'-',
					{ $toString: '$week' },
					'-',
					'$winner.name',
					'-',
					'$loser.name'
				]
			},
			// Weight pre-2012 scores at 0.1x to deprioritize them
			value: {
				$multiply: [
					'$winner.score',
					{ $cond: [{ $lt: ['$season', 2012] }, 0.1, 1] }
				]
			}
		}
	},
	{
		$out: 'lowestScoringWins'
	}
]).then(() => {
	mongoose.disconnect();
	process.exit();
}).catch(err => {
	console.error(err);
	mongoose.disconnect();
	process.exit(1);
});
