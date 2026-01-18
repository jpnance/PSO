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

const regimeSwitchBranches = Object.entries(regimeMapping).map(([from, to]) => ({
	case: { $eq: ['$winner.name', from] },
	then: to
}));

Game.aggregate([
	{
		$match: {
			type: 'championship',
			'away.score': { $exists: true },
			'home.score': { $exists: true }
		}
	},
	{
		$addFields: {
			regimeKey: {
				$switch: {
					branches: regimeSwitchBranches,
					default: '$winner.name'
				}
			}
		}
	},
	{
		$group: {
			_id: '$regimeKey',
			value: { $sum: 1 }
		}
	},
	{
		$out: 'championships'
	}
]).then(() => {
	mongoose.disconnect();
	process.exit();
}).catch(err => {
	console.error(err);
	mongoose.disconnect();
	process.exit(1);
});
