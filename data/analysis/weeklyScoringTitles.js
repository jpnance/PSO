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
	// Determine winner and check allPlay losses
	{
		$addFields: {
			winnerData: {
				$cond: [
					{ $gt: ['$away.score', '$home.score'] },
					'$away',
					'$home'
				]
			}
		}
	},
	// Only count games where the winner had 0 allPlay losses (scoring title)
	{
		$match: {
			'winnerData.record.allPlay.week.losses': 0
		}
	},
	{
		$addFields: {
			regimeKey: regimeSwitch('$winnerData.name')
		}
	},
	{
		$group: {
			_id: '$regimeKey',
			value: { $sum: 1 }
		}
	},
	{
		$out: 'weeklyScoringTitles'
	}
]).then(() => {
	mongoose.disconnect();
	process.exit();
}).catch(err => {
	console.error(err);
	mongoose.disconnect();
	process.exit(1);
});
