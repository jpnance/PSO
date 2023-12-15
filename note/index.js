var dotenv = require('dotenv').config({ path: '/app/.env' });

var fs = require('fs');
var request = require('superagent');

var PSO = require('../pso.js');
var Game = require('../models/Game');
var Leaders = require('../models/Leaders');
var note = require('./lib.js');

var mongoose = require('mongoose');
mongoose.promise = global.Promise;
mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });

if (process.argv.length < 3) {
	console.log('Invalid week');
	console.log('Usage: node index.js <week> <co-host name> <last week co-host name> <last week\'s games order> <this week\'s games order> <RPO score overrides>');
	process.exit();
}

var season = process.env.SEASON;
var sleeperLeagueId = PSO.sleeperLeagueIds[season];

var week = parseInt(process.argv[2]);
var cohost = process.argv[3];
var lastWeekCohost = process.argv[4] || cohost;
var lastWeekGamesOrder = process.argv[5]?.split(',').map((index) => parseInt(index));
var thisWeekGamesOrder = process.argv[6]?.split(',').map((index) => parseInt(index));
var rpoPointsOverrides = process.argv[7]?.split(',').map(pair => pair.split('=')).reduce((rpoPointsOverrideMap, pair) => {
	rpoPointsOverrideMap[pair[0]] = parseFloat(pair[1]);
	return rpoPointsOverrideMap;
}, {}) || {};

var percentagesData = JSON.parse(fs.readFileSync('../public/data/percentages.json', { encoding: 'utf8' }));

var dataPromises = [
	Game.find({ season: season }).sort({ week: 1 }),
	Leaders.WeeklyScoringTitles.find().sort({ value: -1 }),
	require('./rpo-data.json').filter((rpo) => rpo.season == season && rpo.week == week - 1),
	request.get(`https://api.sleeper.app/v1/league/${sleeperLeagueId}/matchups/${week - 1}`)
];

Promise.all(dataPromises).then(function(values) {
	console.log(note.execute(season, week, cohost, lastWeekCohost, lastWeekGamesOrder, thisWeekGamesOrder, rpoPointsOverrides, percentagesData, values));
	mongoose.disconnect();
}).catch(error => {
	console.log(error);
	process.exit(1);
});
