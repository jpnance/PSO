var dotenv = require('dotenv').config({ path: __dirname + '/../../.env' });
var mongoose = require('mongoose');

var LeagueConfig = require('../../models/LeagueConfig');

mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });

var currentSeason = parseInt(process.env.SEASON, 10);

async function seed() {
	console.log('Seeding league config for season', currentSeason, '...\n');
	
	var clearExisting = process.argv.includes('--clear');
	if (clearExisting) {
		console.log('Clearing existing config...');
		await LeagueConfig.deleteMany({});
	}
	
	// Check if config already exists
	var existing = await LeagueConfig.findById('pso');
	if (existing) {
		console.log('Config already exists for season', existing.season);
		console.log('Use --clear to reset, or update via /admin');
		process.exit(0);
	}
	
	// Compute default dates based on Labor Day
	var defaults = LeagueConfig.computeDefaultDates(currentSeason);
	
	// Create config for current season with computed defaults
	var config = await LeagueConfig.create({
		_id: 'pso',
		season: currentSeason,
		
		// Offseason
		tradeWindow: defaults.tradeWindow,
		
		// NFL dates
		nflDraft: defaults.nflDraft,
		nflSeason: defaults.nflSeason,
		
		// Pre-season (tentative until confirmed)
		cutDay: defaults.cutDay,
		cutDayTentative: true,
		draftDay: defaults.draftDay,
		draftDayTentative: true,
		contractsDue: defaults.contractsDue,
		contractsDueTentative: true,
		
		// Regular season
		faab: defaults.faab,
		tradeDeadline: defaults.tradeDeadline,
		playoffs: defaults.playoffs,
		
		// End of season
		deadPeriod: defaults.deadPeriod
	});
	
	function formatDate(d) {
		return d ? d.toISOString().split('T')[0] : 'null';
	}
	
	console.log('Created config:');
	console.log('  Season:', config.season);
	console.log('  Phase:', config.getPhase());
	console.log('  Hard Cap Active:', config.isHardCapActive());
	console.log('  Trades Enabled:', config.areTradesEnabled());
	console.log('\nSchedule:');
	console.log('  Trade Window:', formatDate(config.tradeWindow));
	console.log('  NFL Draft:', formatDate(config.nflDraft));
	console.log('  Cut Day:', formatDate(config.cutDay), config.cutDayTentative ? '(tentative)' : '');
	console.log('  Draft Day:', formatDate(config.draftDay), config.draftDayTentative ? '(tentative)' : '');
	console.log('  Contracts Due:', formatDate(config.contractsDue), config.contractsDueTentative ? '(tentative)' : '');
	console.log('  NFL Season:', formatDate(config.nflSeason));
	console.log('  FAAB:', formatDate(config.faab));
	console.log('  Trade Deadline:', formatDate(config.tradeDeadline));
	console.log('  Playoffs:', formatDate(config.playoffs));
	console.log('  Dead Period:', formatDate(config.deadPeriod));
	console.log('\nAdjust dates via /admin if needed.');
	
	process.exit(0);
}

seed().catch(function(err) {
	console.error('Error:', err);
	process.exit(1);
});
