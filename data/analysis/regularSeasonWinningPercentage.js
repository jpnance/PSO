const dotenv = require('dotenv').config({ path: '/app/.env' });

const mongoose = require('mongoose');
mongoose.connect(process.env.MONGODB_URI);

const Game = require('../models/Game');

// Regime mapping: normalize historical franchise names
const regimeMapping = {
	'Brett/Luke': 'Luke',
	'Jake/Luke': 'Luke',
	'James/Charles': 'Charles',
	'John/Zach': 'John',
	'Koci': 'Koci/Mueller',
	'Mitch/Mike': 'Mitch',
	'Pat/Quinn': 'Patrick',
	'Schex/Jeff': 'Schex',
	'Syed/Kuan': 'Syed',
	'Syed/Terence': 'Syed'
};

function regimeSwitch(field) {
	const branches = Object.entries(regimeMapping).map(([from, to]) => ({
		case: { $eq: [field, from] },
		then: to
	}));
	return { $switch: { branches, default: field } };
}

Game.aggregate([
	{
		$match: {
			type: 'regular',
			'away.score': { $exists: true },
			'home.score': { $exists: true }
		}
	},
	// Create entries for both winner (1 win) and loser (1 loss)
	{
		$project: {
			entries: [
				{ name: '$winner.name', wins: 1, losses: 0 },
				{ name: '$loser.name', wins: 0, losses: 1 }
			]
		}
	},
	{ $unwind: '$entries' },
	{
		$addFields: {
			regimeKey: regimeSwitch('$entries.name')
		}
	},
	{
		$group: {
			_id: '$regimeKey',
			wins: { $sum: '$entries.wins' },
			losses: { $sum: '$entries.losses' }
		}
	},
	{
		$project: {
			_id: 1,
			value: {
				$round: [{ $divide: ['$wins', { $add: ['$wins', '$losses'] }] }, 3]
			}
		}
	},
	{
		$out: 'regularSeasonWinningPercentage'
	}
]).then(() => {
	mongoose.disconnect();
	process.exit();
}).catch(err => {
	console.error(err);
	mongoose.disconnect();
	process.exit(1);
});
