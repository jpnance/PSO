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
	// Filter to final week only (week 15, or week 14 for 2021 and earlier)
	{
		$match: {
			$expr: {
				$eq: [
					'$week',
					{ $cond: [{ $lte: ['$season', 2021] }, 14, 15] }
				]
			}
		}
	},
	// Create entries for both home and away teams
	{
		$project: {
			entries: [
				{
					key: { $concat: [{ $toString: '$season' }, ' ', '$home.name'] },
					wins: '$home.record.allPlay.cumulative.wins',
					losses: '$home.record.allPlay.cumulative.losses',
					ties: '$home.record.allPlay.cumulative.ties'
				},
				{
					key: { $concat: [{ $toString: '$season' }, ' ', '$away.name'] },
					wins: '$away.record.allPlay.cumulative.wins',
					losses: '$away.record.allPlay.cumulative.losses',
					ties: '$away.record.allPlay.cumulative.ties'
				}
			]
		}
	},
	{ $unwind: '$entries' },
	{
		$project: {
			_id: '$entries.key',
			value: {
				wins: '$entries.wins',
				losses: '$entries.losses',
				ties: '$entries.ties',
				winPct: {
					$divide: [
						'$entries.wins',
						{ $add: ['$entries.wins', '$entries.losses'] }
					]
				}
			}
		}
	},
	// Group to deduplicate (each team appears once per final week)
	{
		$group: {
			_id: '$_id',
			value: { $first: '$value' }
		}
	},
	{
		$out: 'regularSeasonAllPlay'
	}
]).then(() => {
	mongoose.disconnect();
	process.exit();
}).catch(err => {
	console.error(err);
	mongoose.disconnect();
	process.exit(1);
});
