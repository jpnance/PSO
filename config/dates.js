/**
 * Canonical league dates.
 *
 * All dates are stored as ISO date strings (YYYY-MM-DD).
 * Draft times are stored as ET (e.g., "noon", "1pm", "8pm").
 * Consumers are responsible for converting to UTC.
 *
 * See also: doc/summer-meetings.txt (human-readable reference)
 */

module.exports.auctionDates = {
	2008: 'August 18',
	2009: 'August 16',
	2010: 'August 22',
	2011: 'August 20',
	2012: 'August 25',
	2013: 'August 24',
	2014: 'August 23',
	2015: 'August 28',
	2016: 'August 20',
	2017: 'August 19',
	2018: 'August 25',
	2019: 'August 24',
	2020: 'August 29',
	2021: 'August 28',
	2022: 'August 27',
	2023: 'August 26',
	2024: 'August 24',
	2025: 'August 23'
};

// No rookie draft in 2008 (inaugural season, auction only)
module.exports.draftDates = {
	2009: { date: 'August 15', time: '8pm' },
	2010: { date: 'August 21', time: '8pm' },
	2011: { date: 'August 20', time: 'noon' },
	2012: { date: 'August 23', time: '8pm' },
	2013: { date: 'August 24', time: '11am' },
	2014: { date: 'August 23', time: 'noon' },
	2015: { date: 'August 28', time: '1pm' },
	2016: { date: 'August 20', time: '1pm' },
	2017: { date: 'August 19', time: '1pm' },
	2018: { date: 'August 25', time: '1pm' },
	2019: { date: 'August 24', time: 'noon' },
	2020: { date: 'August 24', time: 'noon' },
	2021: { date: 'August 14', time: 'noon' },
	2022: { date: 'August 27', time: '1pm' },
	2023: { date: 'August 26', time: '11am' },
	2024: { date: 'August 24', time: '11am' },
	2025: { date: 'August 23', time: '11am' }
};

module.exports.contractDueDates = {
	2008: 'August 24',
	2009: 'September 2',
	2010: 'August 31',
	2011: 'August 26',
	2012: 'September 1',
	2013: 'August 31',
	2014: 'August 31',
	2015: 'September 5',
	2016: 'August 28',
	2017: 'August 27',
	2018: 'September 1',
	2019: 'September 1',
	2020: 'September 7',
	2021: 'September 6',
	2022: 'September 5',
	2023: 'September 4',
	2024: 'September 2',
	2025: 'September 1'
};

// Cut due dates: deadline to drop players to get under the roster limit.
// Default time is 11:59pm ET unless otherwise specified.
module.exports.cutDueDates = {
	2009: { date: 'July 29', time: '5pm' },
	2010: 'August 14',
	2011: 'August 12',
	2012: 'August 17',
	2013: 'August 17',
	2014: 'August 16',
	2015: 'August 22',
	2016: 'August 13',
	2017: 'August 12',
	2018: 'August 18',
	2019: 'August 17',
	2020: 'August 22',
	2021: 'August 7',
	2022: 'August 14',
	2023: 'August 20',
	2024: 'August 18',
	2025: 'August 17'
};

// 2012 expansion draft was a separate event
module.exports.expansionDraftDate = {
	2012: { date: 'August 21', time: '8pm' }
};

/**
 * Convert "August 24" to "YYYY-MM-DD" for a given year.
 */
function toISODate(year, dateStr) {
	var parsed = parseMonthDay(dateStr);
	return year + '-' + String(parsed.month + 1).padStart(2, '0') + '-' + String(parsed.day).padStart(2, '0');
}

/**
 * Parse a date string like "August 24" into month/day numbers.
 * Returns { month: 7, day: 24 } (0-indexed month for Date.UTC)
 */
function parseMonthDay(dateStr) {
	var months = {
		'January': 0, 'February': 1, 'March': 2, 'April': 3,
		'May': 4, 'June': 5, 'July': 6, 'August': 7,
		'September': 8, 'October': 9, 'November': 10, 'December': 11
	};
	var parts = dateStr.split(/\s+/);
	return { month: months[parts[0]], day: parseInt(parts[1]) };
}

/**
 * Parse a time string like "noon", "1pm", "8pm", "11am" into ET hour.
 */
function parseTimeET(timeStr) {
	if (timeStr === 'noon') return 12;
	var m = timeStr.match(/^(\d+)(am|pm)$/);
	if (!m) return 12; // default to noon
	var hour = parseInt(m[1]);
	if (m[2] === 'pm' && hour !== 12) hour += 12;
	if (m[2] === 'am' && hour === 12) hour = 0;
	return hour;
}

/**
 * Get the auction date for a given year as a UTC Date object.
 * Auctions are at noon ET (16:00 UTC during EDT).
 */
module.exports.getAuctionDate = function(year) {
	var str = module.exports.auctionDates[year];
	if (!str) return null;
	var parsed = parseMonthDay(str);
	// Noon ET in August = 16:00 UTC (EDT)
	return new Date(Date.UTC(year, parsed.month, parsed.day, 16, 0, 0));
};

/**
 * Get the draft date for a given year as a UTC Date object.
 */
module.exports.getDraftDate = function(year) {
	var entry = module.exports.draftDates[year];
	if (!entry) return null;
	var parsed = parseMonthDay(entry.date);
	var hourET = parseTimeET(entry.time);
	// All drafts are in August (EDT = UTC-4)
	return new Date(Date.UTC(year, parsed.month, parsed.day, hourET + 4, 0, 0));
};

/**
 * Get the contract due date for a given year as a UTC Date object.
 * Due dates are end-of-day ET.
 */
module.exports.getContractDueDate = function(year) {
	var str = module.exports.contractDueDates[year];
	if (!str) return null;
	var parsed = parseMonthDay(str);
	// End of day ET (~11:59 PM = 03:59 UTC next day, use 04:00 UTC)
	return new Date(Date.UTC(year, parsed.month, parsed.day + 1, 4, 0, 0));
};

/**
 * Get all auction dates as { year: Date } map.
 */
module.exports.getAllAuctionDates = function() {
	var dates = {};
	Object.keys(module.exports.auctionDates).forEach(function(y) {
		dates[parseInt(y)] = module.exports.getAuctionDate(parseInt(y));
	});
	return dates;
};

/**
 * Get all draft dates as { year: Date } map.
 */
module.exports.getAllDraftDates = function() {
	var dates = {};
	Object.keys(module.exports.draftDates).forEach(function(y) {
		dates[parseInt(y)] = module.exports.getDraftDate(parseInt(y));
	});
	return dates;
};

/**
 * Get auction date as "YYYY-MM-DD" string.
 */
module.exports.getAuctionDateISO = function(year) {
	var str = module.exports.auctionDates[year];
	return str ? toISODate(year, str) : null;
};

/**
 * Get contract due date as "YYYY-MM-DD" string.
 */
module.exports.getContractDueDateISO = function(year) {
	var str = module.exports.contractDueDates[year];
	return str ? toISODate(year, str) : null;
};

/**
 * Get the cut due date for a given year as a UTC Date object.
 * Default deadline is 11:59pm ET (03:59 UTC next day) unless entry specifies a time.
 */
module.exports.getCutDueDate = function(year) {
	var entry = module.exports.cutDueDates[year];
	if (!entry) return null;

	if (typeof entry === 'string') {
		// Default: 11:59pm ET → 03:59 UTC next day (round to 4:00 AM UTC)
		var parsed = parseMonthDay(entry);
		return new Date(Date.UTC(year, parsed.month, parsed.day + 1, 4, 0, 0));
	}

	// Object with { date, time } — specific deadline time
	var parsed = parseMonthDay(entry.date);
	var hourET = parseTimeET(entry.time);
	// August = EDT = UTC-4
	return new Date(Date.UTC(year, parsed.month, parsed.day, hourET + 4, 0, 0));
};
