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
	
	// Create config for current season
	// Dates are left null - set via admin UI once known
	var config = await LeagueConfig.create({
		_id: 'pso',
		season: currentSeason,
		
		// All dates start as null/tentative
		tradeWindowOpens: null,
		cutDay: null,
		cutDayTentative: true,
		auctionDay: null,
		auctionDayTentative: true,
		contractsDue: null,
		contractsDueTentative: true,
		regularSeasonStarts: null,
		tradeDeadline: null,
		playoffFAStarts: null,
		championshipDay: null
	});
	
	console.log('Created config:');
	console.log('  Season:', config.season);
	console.log('  Phase:', config.getPhase());
	console.log('  Hard Cap Active:', config.isHardCapActive());
	console.log('  Trades Enabled:', config.areTradesEnabled());
	console.log('\nSet dates via /admin or update the config directly.');
	
	process.exit(0);
}

seed().catch(function(err) {
	console.error('Error:', err);
	process.exit(1);
});
