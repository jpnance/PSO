var dotenv = require('dotenv').config({ path: '/app/.env' });

var request = require('superagent');

var PSO = require('../config/pso.js');

var schedule = {};

var newWeekSchedulePromise = (weekId) => {
	return new Promise((resolve, reject) => {
		request('https://api.sleeper.app/v1/league/' + PSO.sleeperLeagueIds[process.env.SEASON] + '/matchups/' + i)
			.then((response) => {
				var rosters = response.body;

				var week =
					rosters
						.reduce((matchups, roster) => {
							var matchupId = roster.matchup_id - 1;
							if (!matchups[matchupId]) {
								matchups[matchupId] = [];
							}

							matchups[matchupId].push({
								franchiseId: roster.roster_id,
								name: PSO.franchises[roster.roster_id]
							});

							return matchups;
						}, []);

				resolve(week);
			});
	});
};

var weekSchedulePromises = [];

for (var i = 1; i <= 15; i++) {
	weekSchedulePromises.push(newWeekSchedulePromise(i));
}

Promise.all(weekSchedulePromises).then((weekSchedules) => {
	weekSchedules.forEach((weekSchedule, i) => {
		schedule[i + 1] = weekSchedule;
	})

	console.log(JSON.stringify(schedule, null, '  '));
});
