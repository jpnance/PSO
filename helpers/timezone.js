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

module.exports = {
	getETOffsetHours: getETOffsetHours,
	toMidnightET: toMidnightET,
	toEndOfDayET: toEndOfDayET,
	to9pmET: to9pmET,
	toDateStringET: toDateStringET
};
