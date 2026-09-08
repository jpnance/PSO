#!/usr/bin/env node
/**
 * Output the season to fetch results for based on contracts due date.
 * 
 * Before contracts due: previous season (still wrapping up last year)
 * After contracts due: current season (new season underway)
 */

var mongoose = require('mongoose');
mongoose.Promise = global.Promise;

var LeagueConfig = require('../models/LeagueConfig');

mongoose.connect(process.env.MONGODB_URI || 'mongodb://pso-mongo:27017/pso').then(async function() {
	var config = await LeagueConfig.findById('pso');
	
	if (!config) {
		console.error('No LeagueConfig found');
		process.exit(1);
	}
	
	var now = new Date();
	var season;
	
	if (config.contractsDue && now >= config.contractsDue) {
		season = config.season;
	} else {
		season = config.season - 1;
	}
	
	console.log(season);
	mongoose.disconnect();
}).catch(function(err) {
	console.error(err);
	process.exit(1);
});
