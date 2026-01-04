var mongoose = require('mongoose');
var Schema = mongoose.Schema;

// ========== Date Computation Helpers ==========

// Compute Labor Day (first Monday in September) for a given year
function getLaborDay(year) {
	var sept1 = new Date(year, 8, 1); // September 1
	var dayOfWeek = sept1.getDay();
	// Days until Monday (1)
	var daysUntilMonday = (1 - dayOfWeek + 7) % 7;
	return new Date(year, 8, 1 + daysUntilMonday);
}

// Get the Nth day-of-week after a date (0 = first occurrence after)
// targetDay: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
function getDayAfter(baseDate, targetDay, weeksAfter) {
	var date = new Date(baseDate);
	var dayOfWeek = date.getDay();
	var daysUntil = (targetDay - dayOfWeek + 7) % 7;
	if (daysUntil === 0) daysUntil = 7; // Next week if already on that day
	date.setDate(date.getDate() + daysUntil + (weeksAfter * 7));
	return date;
}

// Get the Nth day-of-week before a date (0 = first occurrence before)
function getDayBefore(baseDate, targetDay, weeksBefore) {
	var date = new Date(baseDate);
	var dayOfWeek = date.getDay();
	var daysSince = (dayOfWeek - targetDay + 7) % 7;
	if (daysSince === 0) daysSince = 7; // Previous week if already on that day
	date.setDate(date.getDate() - daysSince - (weeksBefore * 7));
	return date;
}

// Compute all default dates for a given season based on Labor Day
function computeDefaultDates(season) {
	var laborDay = getLaborDay(season);
	var prevLaborDay = getLaborDay(season - 1);
	
	return {
		tradeWindowOpens: getDayAfter(prevLaborDay, 6, 22),    // 23rd Saturday after prev Labor Day
		cutDay: getDayBefore(laborDay, 0, 2),                   // 3rd Sunday before Labor Day
		auctionDay: getDayBefore(laborDay, 6, 1),               // 2nd Saturday before Labor Day
		contractsDue: laborDay,                                  // Labor Day
		regularSeasonStarts: getDayAfter(laborDay, 3, 0),       // 1st Wed after Labor Day
		tradeDeadline: getDayAfter(laborDay, 3, 9),             // 10th Wed after Labor Day
		playoffFAStarts: getDayAfter(laborDay, 3, 15),          // 16th Wed after Labor Day
		championshipDay: getDayAfter(laborDay, 3, 17)           // 18th Wed after Labor Day
	};
}

// ========== Schema ==========

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

var LeagueConfig = mongoose.model('LeagueConfig', leagueConfigSchema);

// Expose the date computation helper as a static method
LeagueConfig.computeDefaultDates = computeDefaultDates;

module.exports = LeagueConfig;
