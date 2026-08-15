#!/usr/bin/env node

var fs = require('fs');
var path = require('path');

var scheduleFile = process.argv[2] || path.join(__dirname, '../public/data/nfl-schedule.json');
var outputFile = process.argv[3] || path.join(__dirname, '../public/data/nfl-bye-weeks.json');

var schedule = JSON.parse(fs.readFileSync(scheduleFile, 'utf8'));

var teams = [];
var teamWeeks = [];

schedule.forEach(function(game) {
	if (!teams.includes(game.away)) {
		teams.push(game.away);
	}
	if (!teams.includes(game.home)) {
		teams.push(game.home);
	}

	var teamWeek = teamWeeks.find(function(tw) { return tw.week === game.week; });
	if (!teamWeek) {
		teamWeek = { week: game.week, teams: [] };
		teamWeeks.push(teamWeek);
	}

	if (!teamWeek.teams.includes(game.away)) {
		teamWeek.teams.push(game.away);
	}
	if (!teamWeek.teams.includes(game.home)) {
		teamWeek.teams.push(game.home);
	}
});

var byeWeeks = {};
teams.forEach(function(team) {
	var byeWeek = teamWeeks.find(function(tw) { return !tw.teams.includes(team); });
	if (byeWeek) {
		byeWeeks[team] = byeWeek.week;
	}
});

var season = new Date().getFullYear();
if (new Date().getMonth() < 3) {
	season--;
}

var output = {
	season: season,
	teams: byeWeeks
};

fs.writeFileSync(outputFile, JSON.stringify(output, null, '\t'));
console.log('Wrote bye weeks for', Object.keys(byeWeeks).length, 'teams to', outputFile);
