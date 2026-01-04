var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var leagueConfigSchema = new Schema({
	// Singleton document - only one config per league
	_id: { type: String, default: 'pso' },
	
	// Current season
	season: { type: Number, required: true },
	
	// Key dates for the season
	// Offseason
	tradeWindowOpens: { type: Date },           // ~late Jan (Saturday before Super Bowl)
	
	// Pre-season crunch
	cutDay: { type: Date },                     // ~late Aug (1 week before auction)
	cutDayTentative: { type: Boolean, default: true },
	
	auctionDay: { type: Date },                 // ~late Aug (2 weeks before NFL Week 1)
	auctionDayTentative: { type: Boolean, default: true },
	
	contractsDue: { type: Date },               // 8 days after auction (Sunday)
	contractsDueTentative: { type: Boolean, default: true },
	
	// Regular season
	regularSeasonStarts: { type: Date },        // Wednesday before NFL Week 1
	tradeDeadline: { type: Date },              // Wednesday between NFL Weeks 9-10
	playoffFAStarts: { type: Date },            // After NFL Week 15
	
	// End of season
	championshipDay: { type: Date }             // Tuesday after NFL Week 17
});

// Compute current phase based on dates
leagueConfigSchema.methods.getPhase = function() {
	var today = new Date();
	
	if (this.championshipDay && today >= this.championshipDay) {
		if (!this.tradeWindowOpens || today < this.tradeWindowOpens) {
			return 'dead-period';
		}
	}
	
	if (this.tradeWindowOpens && today < this.tradeWindowOpens) {
		return 'dead-period';
	}
	
	if (!this.cutDay || today < this.cutDay) {
		return 'early-offseason';
	}
	
	if (!this.regularSeasonStarts || today < this.regularSeasonStarts) {
		return 'pre-season';
	}
	
	if (!this.tradeDeadline || today < this.tradeDeadline) {
		return 'regular-season';
	}
	
	if (!this.playoffFAStarts || today < this.playoffFAStarts) {
		return 'post-deadline';
	}
	
	if (!this.championshipDay || today < this.championshipDay) {
		return 'playoff-fa';
	}
	
	return 'dead-period';
};

// Is hard cap active? (after cut day for current season)
leagueConfigSchema.methods.isHardCapActive = function() {
	if (!this.cutDay) return false;
	return new Date() >= this.cutDay;
};

// Are trades currently allowed?
leagueConfigSchema.methods.areTradesEnabled = function() {
	var phase = this.getPhase();
	return ['early-offseason', 'pre-season', 'regular-season'].includes(phase);
};

// Is free agency currently active?
leagueConfigSchema.methods.isFAEnabled = function() {
	var phase = this.getPhase();
	return ['regular-season', 'post-deadline', 'playoff-fa'].includes(phase);
};

// Is FA restricted to playoff teams?
leagueConfigSchema.methods.isFAPlayoffOnly = function() {
	return this.getPhase() === 'playoff-fa';
};

module.exports = mongoose.model('LeagueConfig', leagueConfigSchema);
