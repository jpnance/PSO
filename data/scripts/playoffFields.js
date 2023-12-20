/*
	This provides a quick overview of the playoff fields each season, especially with regards to all-play record.
*/

var dotenv = require('dotenv').config({ path: '/app/.env' });

var mongoose = require('mongoose');
mongoose.Promise = global.Promise;
mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });

var Game = require('../models/Game');

Game.find({}).then(games => {
	const seasons = games.reduce(extractUniqueSeasons, []);

	seasons.forEach((season) => {
		const prePlayoffTeams =
			games
				.filter(forSeason(season))
				.filter(forWeek(lastRegularSeasonWeekFor(season)))
				.reduce(extractTeams, []);

		const playoffTeams =
			games
				.filter(forSeason(season))
				.filter(forType('semifinal'))
				.reduce(extractTeams, [])
				.map(hydrateWithRecords(prePlayoffTeams));

		const reportableTeams =
			playoffTeams
				.map(toReportableTeam)
				.sort(byAllPlay);

		reportableTeams.push(reportableTeams.reduce(aggregateForSeason, { name: 'Total' }));

		console.log(season);
		console.group();
		console.log(reportableTeams.map(formatReportableTeam).join('\n'));
		console.groupEnd();
		console.log();
	});

	mongoose.disconnect();
});

function extractUniqueSeasons(seasons, game) {
	if (!seasons.includes(game.season)) {
		seasons.push(game.season);
	}

	return seasons;
}

function forSeason(season) {
	return (game) => game.season === season;
}

function forType(type) {
	return (game) => game.type === type;
}

function lastRegularSeasonWeekFor(season) {
	return season < 2021 ? 14 : 15;
}
function forWeek(week) {
	return (game) => game.week === week;
}

function extractTeams(teams, game) {
	teams.push(game.away);
	teams.push(game.home);

	return teams;
}

function toReportableTeam(team) {
	return {
		name: team.name,
		straight: team.record.straight.cumulative,
		allPlay: team.record.allPlay.cumulative,
	};
}

function recordBeforeThisWeek(record) {
	return {
		wins: record.cumulative.wins - (record.week.wins ?? 0),
		losses: record.cumulative.losses - (record.week.losses ?? 0),
		ties: record.cumulative.ties - (record.week.ties ?? 0),
	};
}

function formatRecord(record) {
	const { wins, losses, ties } = record;
	const winningPercentage = winningPercentageForRecord(record);

	return `${wins}-${losses}-${ties} (${winningPercentage.toFixed(3)})`;
}

function formatReportableTeam(reportableTeam) {
	const { name, straight, allPlay } = reportableTeam;

	return `${name}: ${formatRecord(straight)}, ${formatRecord(allPlay)}`;
}

function aggregateForSeason(seasonTotal, current) {
	return {
		name: seasonTotal.name,
		straight: addRecords(seasonTotal.straight, current.straight),
		allPlay: addRecords(seasonTotal.allPlay, current.allPlay),
	};
}

function addRecords(recordOne = { wins: 0, losses: 0, ties: 0 }, recordTwo = { wins: 0, losses: 0, ties: 0 }) {
	const result = {};

	['wins', 'losses', 'ties'].forEach((stat) => {
		result[stat] = recordOne[stat] + recordTwo[stat];
	});

	return result;
}

function byAllPlay(teamOne, teamTwo) {
	return winningPercentageForRecord(teamTwo.allPlay) - winningPercentageForRecord(teamOne.allPlay);
}

function winningPercentageForRecord(record) {
	const { wins, losses } = record;

	return wins / (wins + losses);
}

function hydrateWithRecords(preTeams) {
	return (team) => {
		const preTeam = preTeams.find(byFranchiseId(team.franchiseId));

		Object.assign(team.record, preTeam.record);

		return team;
	};
}

function byFranchiseId(franchiseId) {
	return (team) => team.franchiseId === franchiseId;
}
