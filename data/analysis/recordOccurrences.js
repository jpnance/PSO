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
	// Create entries for both home and away teams with their records
	{
		$project: {
			entries: [
				{
					record: {
						$concat: [
							{ $toString: '$home.record.straight.cumulative.wins' },
							'-',
							{ $toString: '$home.record.straight.cumulative.losses' },
							'-',
							{ $toString: '$home.record.straight.cumulative.ties' }
						]
					},
					owner: { $concat: [{ $toString: '$season' }, ' ', '$home.name'] }
				},
				{
					record: {
						$concat: [
							{ $toString: '$away.record.straight.cumulative.wins' },
							'-',
							{ $toString: '$away.record.straight.cumulative.losses' },
							'-',
							{ $toString: '$away.record.straight.cumulative.ties' }
						]
					},
					owner: { $concat: [{ $toString: '$season' }, ' ', '$away.name'] }
				}
			]
		}
	},
	{ $unwind: '$entries' },
	{
		$group: {
			_id: '$entries.record',
			value: { $push: '$entries.owner' }
		}
	},
	// Wrap in object to match original mapReduce output format
	{
		$project: {
			_id: 1,
			value: { owners: '$value' }
		}
	},
	{
		$out: 'recordOccurrences'
	}
]).then(() => {
	mongoose.disconnect();
	process.exit();
}).catch(err => {
	console.error(err);
	mongoose.disconnect();
	process.exit(1);
});
