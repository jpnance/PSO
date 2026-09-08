// Timezone helpers for Eastern Time deadline handling
//
// Key dates are stored as their actual deadline timestamps in UTC.
// Different date types have different conventional times:
//   - cutDay: 11:59pm ET (cuts due by end of day)
//   - tradeDeadline: 9pm ET
//   - Other dates: midnight ET (phase changes at start of day)

/**
 * Get the UTC offset for ET at a given moment (accounts for DST).
 * Returns hours to ADD to ET to get UTC (4 for EDT, 5 for EST).
 * @param {Date} date - Reference date for DST determination
 * @returns {number} Offset hours (4 or 5)
 */
function getETOffsetHours(date) {
	var formatter = new Intl.DateTimeFormat('en-US', {
		timeZone: 'America/New_York',
		timeZoneName: 'shortOffset'
	});
	var parts = formatter.formatToParts(date);
	var offsetPart = parts.find(function(p) { return p.type === 'timeZoneName'; });
	var offsetStr = offsetPart ? offsetPart.value : 'GMT-5';
	var match = offsetStr.match(/GMT([+-]?\d+)/);
	return match ? -parseInt(match[1]) : 5;
}

/**
 * Convert a date input to midnight ET on that day, as UTC.
 * Use for dates where the phase changes at the START of that day.
 * 
 * @param {string|Date} dateInput - Date string (YYYY-MM-DD) or Date object
 * @returns {Date|null} Midnight ET as UTC timestamp
 */
function toMidnightET(dateInput) {
	if (!dateInput) return null;
	
	var d = new Date(dateInput);
	if (isNaN(d.getTime())) return null;
	
	var year = d.getUTCFullYear();
	var month = d.getUTCMonth();
	var day = d.getUTCDate();
	
	// Use noon to safely determine DST for that day
	var noon = new Date(Date.UTC(year, month, day, 12, 0, 0));
	var offset = getETOffsetHours(noon);
	
	return new Date(Date.UTC(year, month, day, offset, 0, 0));
}

/**
 * Convert a date input to 11:59:59pm ET on that day, as UTC.
 * Use for end-of-day deadlines like cut day.
 * 
 * @param {string|Date} dateInput - Date string (YYYY-MM-DD) or Date object
 * @returns {Date|null} 11:59:59pm ET as UTC timestamp
 */
function toEndOfDayET(dateInput) {
	if (!dateInput) return null;
	
	var d = new Date(dateInput);
	if (isNaN(d.getTime())) return null;
	
	var year = d.getUTCFullYear();
	var month = d.getUTCMonth();
	var day = d.getUTCDate();
	
	var noon = new Date(Date.UTC(year, month, day, 12, 0, 0));
	var offset = getETOffsetHours(noon);
	
	// 23:59:59 ET
	return new Date(Date.UTC(year, month, day, 23 + offset, 59, 59));
}

/**
 * Convert a date input to 9pm ET on that day, as UTC.
 * Use for trade deadline.
 * 
 * @param {string|Date} dateInput - Date string (YYYY-MM-DD) or Date object
 * @returns {Date|null} 9pm ET as UTC timestamp
 */
function to9pmET(dateInput) {
	if (!dateInput) return null;
	
	var d = new Date(dateInput);
	if (isNaN(d.getTime())) return null;
	
	var year = d.getUTCFullYear();
	var month = d.getUTCMonth();
	var day = d.getUTCDate();
	
	var noon = new Date(Date.UTC(year, month, day, 12, 0, 0));
	var offset = getETOffsetHours(noon);
	
	// 21:00 ET
	return new Date(Date.UTC(year, month, day, 21 + offset, 0, 0));
}

/**
 * Convert a UTC timestamp back to date string (YYYY-MM-DD) in ET.
 * Use for displaying stored deadlines in admin forms.
 * 
 * @param {Date} utcTimestamp - Stored deadline timestamp
 * @returns {string|null} Date string in YYYY-MM-DD format
 */
function toDateStringET(utcTimestamp) {
	if (!utcTimestamp) return null;
	// en-CA locale gives YYYY-MM-DD format
	return new Date(utcTimestamp).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

/**
 * Convert a date input to noon (12pm) ET on that day, as UTC.
 * Use for FAAB processing time.
 * 
 * @param {string|Date} dateInput - Date string (YYYY-MM-DD) or Date object
 * @returns {Date|null} Noon ET as UTC timestamp
 */
function toNoonET(dateInput) {
	if (!dateInput) return null;
	
	var d = new Date(dateInput);
	if (isNaN(d.getTime())) return null;
	
	var year = d.getUTCFullYear();
	var month = d.getUTCMonth();
	var day = d.getUTCDate();
	
	var noon = new Date(Date.UTC(year, month, day, 12, 0, 0));
	var offset = getETOffsetHours(noon);
	
	// 12:00 ET
	return new Date(Date.UTC(year, month, day, 12 + offset, 0, 0));
}

/**
 * Check if a given date is a FAAB processing day.
 * FAAB runs at noon ET on Thu, Fri, Sat, Sun, Mon, plus the special
 * Wednesday before NFL season (stored in config.faab).
 * 
 * @param {Date} date - The date to check
 * @param {Date} [specialWednesday] - The special pre-season Wednesday (config.faab)
 * @returns {boolean}
 */
function isFAABDay(date, specialWednesday) {
	// Get day of week in ET
	var etDate = new Date(date.toLocaleString('en-US', { timeZone: 'America/New_York' }));
	var day = etDate.getDay(); // 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
	
	// Thu(4), Fri(5), Sat(6), Sun(0), Mon(1)
	if ([0, 1, 4, 5, 6].includes(day)) return true;
	
	// Special Wednesday from config
	if (day === 3 && specialWednesday) {
		var dateStr = toDateStringET(date);
		var specialStr = toDateStringET(specialWednesday);
		if (dateStr === specialStr) return true;
	}
	
	return false;
}

/**
 * Find the next FAAB processing time at or after a given timestamp.
 * 
 * @param {Date} after - Find FAAB time at or after this timestamp
 * @param {Date} [specialWednesday] - The special pre-season Wednesday (config.faab)
 * @returns {Date} The next FAAB processing time (noon ET)
 */
function nextFAABTime(after, specialWednesday) {
	var candidate = new Date(after);
	
	// Start by getting noon ET on the same day
	var noonToday = toNoonET(candidate);
	
	// If we're past noon today, start checking tomorrow
	if (candidate > noonToday) {
		candidate = new Date(noonToday.getTime() + 24 * 60 * 60 * 1000);
	} else {
		candidate = noonToday;
	}
	
	// Find next FAAB day (max 7 iterations)
	for (var i = 0; i < 7; i++) {
		if (isFAABDay(candidate, specialWednesday)) {
			return candidate;
		}
		candidate = new Date(candidate.getTime() + 24 * 60 * 60 * 1000);
	}
	
	// Shouldn't happen, but return candidate anyway
	return candidate;
}

/**
 * Anchor a timestamp to the most recent FAAB processing time.
 * Used for waiver transactions - Sleeper might report 12:03pm but we
 * record it as exactly noon.
 * 
 * @param {Date} timestamp - The Sleeper transaction timestamp
 * @param {Date} [specialWednesday] - The special pre-season Wednesday (config.faab)
 * @returns {Date} The anchored FAAB time (noon ET on that day)
 */
function anchorToFAABTime(timestamp, specialWednesday) {
	var noon = toNoonET(timestamp);
	
	// Only anchor if this is actually a FAAB day
	if (isFAABDay(noon, specialWednesday)) {
		return noon;
	}
	
	// Not a FAAB day - return original timestamp
	return timestamp;
}

module.exports = {
	getETOffsetHours: getETOffsetHours,
	toMidnightET: toMidnightET,
	toEndOfDayET: toEndOfDayET,
	to9pmET: to9pmET,
	toNoonET: toNoonET,
	toDateStringET: toDateStringET,
	isFAABDay: isFAABDay,
	nextFAABTime: nextFAABTime,
	anchorToFAABTime: anchorToFAABTime
};
