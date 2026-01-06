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
		tradeWindowOpens: defaults.tradeWindowOpens,
		
		// NFL dates
		nflDraft: defaults.nflDraft,
		nflSeasonKickoff: defaults.nflSeasonKickoff,
		
		// Pre-season (tentative until confirmed)
		cutDay: defaults.cutDay,
		cutDayTentative: true,
		auctionDay: defaults.auctionDay,
		auctionDayTentative: true,
		contractsDue: defaults.contractsDue,
		contractsDueTentative: true,
		
		// Regular season
		regularSeasonStarts: defaults.regularSeasonStarts,
		tradeDeadline: defaults.tradeDeadline,
		playoffFAStarts: defaults.playoffFAStarts,
		
		// End of season
		championshipDay: defaults.championshipDay
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
	console.log('  Trade Window Opens:', formatDate(config.tradeWindowOpens));
	console.log('  NFL Draft:', formatDate(config.nflDraft));
	console.log('  Cut Day:', formatDate(config.cutDay), config.cutDayTentative ? '(tentative)' : '');
	console.log('  Auction Day:', formatDate(config.auctionDay), config.auctionDayTentative ? '(tentative)' : '');
	console.log('  Contracts Due:', formatDate(config.contractsDue), config.contractsDueTentative ? '(tentative)' : '');
	console.log('  NFL Season Kickoff:', formatDate(config.nflSeasonKickoff));
	console.log('  Regular Season Starts:', formatDate(config.regularSeasonStarts));
	console.log('  Trade Deadline:', formatDate(config.tradeDeadline));
	console.log('  Playoff FA Starts:', formatDate(config.playoffFAStarts));
	console.log('  Championship Day:', formatDate(config.championshipDay));
	console.log('\nAdjust dates via /admin if needed.');
	
	process.exit(0);
}

seed().catch(function(err) {
	console.error('Error:', err);
	process.exit(1);
});
