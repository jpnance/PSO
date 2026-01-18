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
			type: 'semifinal'
		}
	},
	// Unwind both teams from each game into separate documents
	{
		$project: {
			teams: ['$away.name', '$home.name']
		}
	},
	{ $unwind: '$teams' },
	{
		$addFields: {
			regimeKey: regimeSwitch('$teams')
		}
	},
	{
		$group: {
			_id: '$regimeKey',
			value: { $sum: 1 }
		}
	},
	{
		$out: 'playoffAppearances'
	}
]).then(() => {
	mongoose.disconnect();
	process.exit();
}).catch(err => {
	console.error(err);
	mongoose.disconnect();
	process.exit(1);
});
