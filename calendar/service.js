var LeagueConfig = require('../models/LeagueConfig');

// Format date for display
function formatDate(date) {
	if (!date) return null;
	var options = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' };
	return new Date(date).toLocaleDateString('en-US', options);
}

// Format short date
function formatShortDate(date) {
	if (!date) return null;
	var options = { month: 'short', day: 'numeric' };
	return new Date(date).toLocaleDateString('en-US', options);
}

function getToday() {
	return new Date();
}

// Check if date is in the past
function isPast(date) {
	if (!date) return false;
	var today = getToday();
	today.setHours(0, 0, 0, 0);
	return new Date(date) < today;
}

// Check if date is today
function isToday(date) {
	if (!date) return false;
	var today = getToday();
	var d = new Date(date);
	return d.toDateString() === today.toDateString();
}

// Check if date is within the next 7 days
function isUpcoming(date) {
	if (!date) return false;
	var today = getToday();
	today.setHours(0, 0, 0, 0);
	var d = new Date(date);
	var weekFromNow = new Date(today);
	weekFromNow.setDate(weekFromNow.getDate() + 7);
	return d >= today && d <= weekFromNow;
}

// Get human-readable phase name
function getPhaseName(phase) {
	var names = {
		'dead-period': 'Dead Period',
		'early-offseason': 'Offseason',
		'pre-season': 'Pre-Season',
		'regular-season': 'Regular Season',
		'post-deadline': 'Post-Deadline',
		'playoff-fa': 'Playoff FA Period',
		'unknown': 'Unknown'
	};
	return names[phase] || phase;
}

// Build calendar data from config
function buildCalendarData(config) {
	var events = [
		{
			key: 'tradeWindowOpens',
			name: 'Trade Window Opens',
			date: config.tradeWindowOpens,
			description: 'Trades resume for the new season',
			tentative: false
		},
		{
			key: 'nflDraft',
			name: 'NFL Draft',
			date: config.nflDraft,
			description: 'Rookie landing spots revealed',
			tentative: false,
			isNfl: true
		},
		{
			key: 'cutDay',
			name: 'Cut Day',
			date: config.cutDay,
			description: 'Deadline to get under the salary cap',
			tentative: config.cutDayTentative
		},
		{
			key: 'auctionDay',
			name: 'Rookie Draft and Auction',
			date: config.auctionDay,
			description: 'Annual rookie draft and free agent auction',
			tentative: config.auctionDayTentative
		},
		{
			key: 'contractsDue',
			name: 'Contracts Due',
			date: config.contractsDue,
			description: 'Contract terms submitted for new acquisitions',
			tentative: config.contractsDueTentative
		},
		{
			key: 'nflSeasonKickoff',
			name: 'NFL Season Kickoff',
			date: config.nflSeasonKickoff,
			description: 'NFL regular season begins',
			tentative: false,
			isNfl: true
		},
		{
			key: 'regularSeasonStarts',
			name: 'Regular Season Starts',
			date: config.regularSeasonStarts,
			description: 'Fantasy matchups begin',
			tentative: false
		},
		{
			key: 'tradeDeadline',
			name: 'Trade Deadline',
			date: config.tradeDeadline,
			description: 'Last day to execute trades for the season',
			tentative: false
		},
		{
			key: 'playoffFAStarts',
			name: 'Playoff Free Agency Starts',
			date: config.playoffFAStarts,
			description: 'Free agency transactions lock for non-playoff teams',
			tentative: false
		},
		{
			key: 'championshipDay',
			name: 'End of the Season',
			date: config.championshipDay,
			description: 'Championship round matchups finalize and season concludes',
			tentative: false
		}
	];
	
	// Add status to each event
	return events.map(function(event) {
		return Object.assign({}, event, {
			formattedDate: formatDate(event.date),
			shortDate: formatShortDate(event.date),
			isPast: isPast(event.date),
			isToday: isToday(event.date),
			isUpcoming: isUpcoming(event.date)
		});
	});
}

// Route handler
async function calendar(request, response) {
	try {
		var config = await LeagueConfig.findById('pso');
		
		if (!config) {
			return response.status(500).send('League configuration not found');
		}
		
		var phase = config.getPhase();
		var events = buildCalendarData(config);
		
		// Find next upcoming event
		var nextEvent = events.find(function(e) {
			return e.date && !e.isPast;
		});
		
		response.render('calendar', {
			season: config.season,
			phase: phase,
			phaseName: getPhaseName(phase),
			events: events,
			nextEvent: nextEvent
		});
	} catch (err) {
		console.error(err);
		response.status(500).send('Error loading calendar');
	}
}

module.exports = {
	calendar: calendar
};
