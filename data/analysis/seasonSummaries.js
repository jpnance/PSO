const dotenv = require('dotenv').config({ path: '/app/.env' });

const mongoose = require('mongoose');
mongoose.connect(process.env.MONGODB_URI);

const Game = require('../models/Game');

Game.aggregate([
	{
		$match: {
			'away.score': { $exists: true },
			'home.score': { $exists: true },
			'type': { $ne: 'consolation' }
		}
	},
	{
		$sort: { season: 1, week: 1 }
	},
	// Create entries for both away and home teams
	{
		$project: {
			season: 1,
			type: 1,
			winner: '$winner.name',
			entries: [
				{
					key: { $concat: [{ $toString: '$season' }, ' ', '$away.name'] },
					name: '$away.name',
					score: '$away.score',
					record: {
						$concat: [
							{ $toString: '$away.record.straight.cumulative.wins' },
							'-',
							{ $toString: '$away.record.straight.cumulative.losses' },
							'-',
							{ $toString: '$away.record.straight.cumulative.ties' }
						]
					}
				},
				{
					key: { $concat: [{ $toString: '$season' }, ' ', '$home.name'] },
					name: '$home.name',
					score: '$home.score',
					record: {
						$concat: [
							{ $toString: '$home.record.straight.cumulative.wins' },
							'-',
							{ $toString: '$home.record.straight.cumulative.losses' },
							'-',
							{ $toString: '$home.record.straight.cumulative.ties' }
						]
					}
				}
			]
		}
	},
	{ $unwind: '$entries' },
	{
		$group: {
			_id: '$entries.key',
			scores: { $push: '$entries.score' },
			records: { $push: '$entries.record' },
			playoffs: {
				$max: { $cond: [{ $eq: ['$type', 'semifinal'] }, true, false] }
			},
			titleGame: {
				$max: { $cond: [{ $eq: ['$type', 'championship'] }, true, false] }
			},
			champion: {
				$max: {
					$cond: [
						{
							$and: [
								{ $eq: ['$type', 'championship'] },
								{ $eq: ['$winner', '$entries.name'] }
							]
						},
						true,
						false
					]
				}
			}
		}
	},
	{
		$project: {
			_id: 1,
			value: {
				scores: '$scores',
				records: '$records',
				playoffs: '$playoffs',
				titleGame: '$titleGame',
				champion: '$champion'
			}
		}
	},
	{
		$out: 'seasonSummaries'
	}
]).then(() => {
	mongoose.disconnect();
	process.exit();
}).catch(err => {
	console.error(err);
	mongoose.disconnect();
	process.exit(1);
});
