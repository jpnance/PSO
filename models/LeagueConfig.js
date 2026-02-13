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

// Get the last occurrence of a day-of-week in a given month
// targetDay: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
function getLastDayOfMonth(year, month, targetDay) {
	// Start from the last day of the month
	var lastDay = new Date(year, month + 1, 0);
	var dayOfWeek = lastDay.getDay();
	var daysBack = (dayOfWeek - targetDay + 7) % 7;
	return new Date(year, month + 1, -daysBack);
}

// Compute all default dates for a given season based on Labor Day
function computeDefaultDates(season) {
	var laborDay = getLaborDay(season);
	var prevLaborDay = getLaborDay(season - 1);
	
	return {
		tradeWindow: getDayAfter(prevLaborDay, 6, 22),          // 23rd Saturday after prev Labor Day
		nflDraft: getLastDayOfMonth(season, 3, 4),              // Last Thursday of April
		cutDay: getDayBefore(laborDay, 0, 2),                   // 3rd Sunday before Labor Day
		draftDay: getDayBefore(laborDay, 6, 1),                 // 2nd Saturday before Labor Day
		contractsDue: laborDay,                                  // Labor Day
		faab: getDayAfter(laborDay, 3, 0),                      // 1st Wed after Labor Day
		nflSeason: getDayAfter(laborDay, 4, 0),                 // Thursday after Labor Day
		tradeDeadline: getDayAfter(laborDay, 3, 9),             // 10th Wed after Labor Day
		playoffs: getDayAfter(laborDay, 3, 15),                 // 16th Wed after Labor Day
		deadPeriod: getDayAfter(laborDay, 3, 17)                // 18th Wed after Labor Day
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
	tradeWindow: { type: Date },                // ~late Jan (Saturday before Super Bowl)
	
	// NFL dates
	nflDraft: { type: Date },                   // Last Thursday of April
	
	// Pre-season crunch
	cutDay: { type: Date },                     // ~late Aug (1 week before auction)
	cutDayTentative: { type: Boolean, default: true },
	
	draftDay: { type: Date },                   // ~late Aug (2 weeks before NFL Week 1)
	draftDayTentative: { type: Boolean, default: true },
	
	contractsDue: { type: Date },               // 8 days after auction (Sunday)
	contractsDueTentative: { type: Boolean, default: true },
	
	// Regular season
	faab: { type: Date },                       // Wednesday before NFL Week 1
	nflSeason: { type: Date },                  // Thursday after Labor Day
	tradeDeadline: { type: Date },              // Wednesday between NFL Weeks 9-10
	playoffs: { type: Date },                   // After NFL Week 15
	
	// End of season
	deadPeriod: { type: Date },                 // Tuesday after NFL Week 17
	
	// Sitewide banner
	banner: { type: String, default: '' },
	bannerStyle: { type: String, enum: ['info', 'warning', 'danger'], default: 'info' }
});

// Compute current phase based on dates
// Phase progression through a season:
//   dead-period → early-offseason → pre-season → regular-season → post-deadline → playoff-fa → dead-period
// dead-period occurs twice: after playoffs end (before rollover) and after rollover (before trade window)
leagueConfigSchema.methods.getPhase = function() {
	var today = new Date();
	
	// After playoffs end - dead period until rollover
	if (this.deadPeriod && today >= this.deadPeriod) {
		return 'dead-period';
	}
	
	// Before trade window opens (after rollover) - still dead period
	if (this.tradeWindow && today < this.tradeWindow) {
		return 'dead-period';
	}
	
	if (!this.cutDay || today < this.cutDay) {
		return 'early-offseason';
	}
	
	if (!this.faab || today < this.faab) {
		return 'pre-season';
	}
	
	if (!this.tradeDeadline || today < this.tradeDeadline) {
		return 'regular-season';
	}
	
	if (!this.playoffs || today < this.playoffs) {
		return 'post-deadline';
	}
	
	if (!this.deadPeriod || today < this.deadPeriod) {
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

// Are cuts (drops) currently allowed?
// Cuts are NOT allowed between Cut Day and FAAB (pre-season phase),
// and NOT allowed during the dead period.
// See rules: "Cut Day will occur prior to either of the drafts,
// after which drops will not be allowed until after Free Agent Auction."
leagueConfigSchema.methods.areCutsEnabled = function() {
	var phase = this.getPhase();
	// Cuts allowed: early-offseason (before cut day), regular-season, post-deadline, playoff-fa
	// Cuts NOT allowed: pre-season (cut day through FAAB), dead-period
	return ['early-offseason', 'regular-season', 'post-deadline', 'playoff-fa'].includes(phase);
};

var LeagueConfig = mongoose.model('LeagueConfig', leagueConfigSchema);

// Expose the date computation helper as a static method
LeagueConfig.computeDefaultDates = computeDefaultDates;

// Static constants
LeagueConfig.ROSTER_LIMIT = 35;

module.exports = LeagueConfig;
