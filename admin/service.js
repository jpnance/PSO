var LeagueConfig = require('../models/LeagueConfig');

var currentSeason = parseInt(process.env.SEASON, 10);

// Simple admin key check (set ADMIN_KEY in .env)
function isAuthorized(request) {
	var adminKey = process.env.ADMIN_KEY;
	if (!adminKey) return true; // No key configured = allow all (dev mode)
	
	var providedKey = request.query.key || request.body?.key || request.headers['x-admin-key'];
	return providedKey === adminKey;
}

// GET /admin - show config management page
async function configPage(request, response) {
	if (!isAuthorized(request)) {
		return response.status(401).send('Unauthorized');
	}
	
	var config = await LeagueConfig.findById('pso');
	if (!config) {
		config = new LeagueConfig({ _id: 'pso', season: currentSeason });
		await config.save();
	}
	
	response.render('admin', { 
		config: config,
		phase: config.getPhase(),
		hardCapActive: config.isHardCapActive(),
		tradesEnabled: config.areTradesEnabled(),
		faEnabled: config.isFAEnabled(),
		faPlayoffOnly: config.isFAPlayoffOnly()
	});
}

// POST /admin/config - update config
async function updateConfig(request, response) {
	if (!isAuthorized(request)) {
		return response.status(401).json({ error: 'Unauthorized' });
	}
	
	var config = await LeagueConfig.findById('pso');
	if (!config) {
		config = new LeagueConfig({ _id: 'pso', season: currentSeason });
	}
	
	var body = request.body;
	
	// Update dates (convert empty strings to null)
	var dateFields = [
		'tradeWindowOpens', 'cutDay', 'auctionDay', 'contractsDue',
		'regularSeasonStarts', 'tradeDeadline', 'playoffFAStarts', 'championshipDay'
	];
	
	dateFields.forEach(function(field) {
		if (body[field] !== undefined) {
			config[field] = body[field] ? new Date(body[field]) : null;
		}
	});
	
	// Update tentative flags
	config.cutDayTentative = body.cutDayTentative === 'true' || body.cutDayTentative === true;
	config.auctionDayTentative = body.auctionDayTentative === 'true' || body.auctionDayTentative === true;
	config.contractsDueTentative = body.contractsDueTentative === 'true' || body.contractsDueTentative === true;
	
	await config.save();
	
	response.redirect('/admin');
}

// POST /admin/config/advance-season - rollover to next season
async function advanceSeason(request, response) {
	if (!isAuthorized(request)) {
		return response.status(401).json({ error: 'Unauthorized' });
	}
	
	var config = await LeagueConfig.findById('pso');
	if (!config) {
		return response.status(404).json({ error: 'Config not found' });
	}
	
	// Increment season and compute new defaults
	var newSeason = config.season + 1;
	var defaults = LeagueConfig.computeDefaultDates(newSeason);
	
	config.season = newSeason;
	
	// Offseason
	config.tradeWindowOpens = defaults.tradeWindowOpens;
	
	// Pre-season (tentative until confirmed)
	config.cutDay = defaults.cutDay;
	config.cutDayTentative = true;
	config.auctionDay = defaults.auctionDay;
	config.auctionDayTentative = true;
	config.contractsDue = defaults.contractsDue;
	config.contractsDueTentative = true;
	
	// Regular season
	config.regularSeasonStarts = defaults.regularSeasonStarts;
	config.tradeDeadline = defaults.tradeDeadline;
	config.playoffFAStarts = defaults.playoffFAStarts;
	
	// End of season
	config.championshipDay = defaults.championshipDay;
	
	await config.save();
	
	response.redirect('/admin');
}

module.exports = {
	configPage: configPage,
	updateConfig: updateConfig,
	advanceSeason: advanceSeason
};
