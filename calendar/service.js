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
			key: 'tradeWindow',
			name: 'Trade Window',
			date: config.tradeWindow,
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
			description: 'Last day to cut players until after contracts are due; hard cap goes into effect',
			tentative: config.cutDayTentative
		},
		{
			key: 'draftDay',
			name: 'Draft Day',
			date: config.draftDay,
			description: 'Annual rookie draft and free agent auction',
			tentative: config.draftDayTentative
		},
		{
			key: 'contractsDue',
			name: 'Contracts Due',
			date: config.contractsDue,
			description: 'Contract terms submitted for new acquisitions',
			tentative: config.contractsDueTentative
		},
		{
			key: 'faab',
			name: 'In-Season Free Agency Begins',
			date: config.faab,
			description: 'FAAB begins running on this Wednesday and will continue every Thursday, Friday, Saturday, Sunday, and Monday at 12pm ET',
			tentative: false
		},
		{
			key: 'nflSeason',
			name: 'NFL Season Kicks Off',
			date: config.nflSeason,
			description: 'First game of the NFL regular season',
			tentative: false,
			isNfl: true
		},
		{
			key: 'tradeDeadline',
			name: 'Trade Deadline',
			date: config.tradeDeadline,
			description: 'Last day to execute trades for the season',
			tentative: false
		},
		{
			key: 'playoffs',
			name: 'Playoffs',
			date: config.playoffs,
			description: 'All non-playoff teams are locked out of free agency',
			tentative: false
		},
		{
			key: 'deadPeriod',
			name: 'Dead Period',
			date: config.deadPeriod,
			description: 'Season concludes; no transactions until trade window reopens',
			tentative: false
		}
	];
	
	// Add status to each event and sort by date
	return events
		.map(function(event) {
			return Object.assign({}, event, {
				formattedDate: formatDate(event.date),
				shortDate: formatShortDate(event.date),
				isPast: isPast(event.date),
				isToday: isToday(event.date),
				isUpcoming: isUpcoming(event.date)
			});
		})
		.sort(function(a, b) {
			// Events without dates go to the end
			if (!a.date && !b.date) return 0;
			if (!a.date) return 1;
			if (!b.date) return -1;
			return new Date(a.date) - new Date(b.date);
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
			nextEvent: nextEvent,
			pageTitle: config.season + ' Calendar - PSO',
			activePage: 'calendar'
		});
	} catch (err) {
		console.error(err);
		response.status(500).send('Error loading calendar');
	}
}

module.exports = {
	calendar: calendar
};
