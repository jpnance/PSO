var dotenv = require('dotenv').config({ path: __dirname + '/../.env' });

var request = require('superagent');

var PSO = require('../pso.js');

var newFantraxPromise = function(fantraxId) {
	return new Promise(function(resolve, reject) {
		request
			.post('https://www.fantrax.com/fxpa/req?leagueId=' + PSO.fantraxLeagueId)
			.set('Content-Type', 'text/plain')
			.send(JSON.stringify({ msgs: [ { data: { leagueId: PSO.fantraxLeagueId, teamId: fantraxId, view: 'STATS' }, method: 'getTeamRosterInfo' } ] }))
			.then(response => {
				//console.log(response.text);
				var dataJson = JSON.parse(response.text);
				var rawBudget = dataJson.responses[0].data.miscData.salaryInfo.info[1].value;
				var cleanBudget = parseFloat(rawBudget.replace(/,/, ''));

				resolve({ fantraxId: fantraxId, fantraxBudget: cleanBudget });
			});
		}
	)
};

var newSheetsPromise = function(fantraxId) {
	return new Promise(function(resolve, reject) {
		request
			.get('https://sheets.googleapis.com/v4/spreadsheets/1nas3AqWZtCu_UZIV77Jgxd9oriF1NQjzSjFWW86eong/values/Cash')
			.query({ alt: 'json', key: process.env.GOOGLE_API_KEY })
			.then(response => {
				var dataJson = JSON.parse(response.text);
				var cleanBudget = parseFloat(dataJson.values[6][PSO.sheetsBudgetCells[fantraxId]].replace(/\$/, ''));

				resolve({ fantraxId: fantraxId, sheetsBudget: cleanBudget });
			});
	});
};

var newPostPromise = function(fantraxId, budget) {
	return new Promise(function(resolve, reject) {
		request
			.post('https://www.fantrax.com/newui/fantasy/teamAdjustment.go?leagueId=' + PSO.fantraxLeagueId)
			.set('Content-Type', 'application/x-www-form-urlencoded')
			.set('Cookie', process.env.FANTRAX_COOKIES)
			.send({ teamId: fantraxId })
			.send({ isSubmit: 'y' })
			.send({ freeAgentBudget: budget })
			.then(() => {
				resolve();
			});
	});
};

var teamData = {};
var teamPromises = [];

Object.keys(PSO.fantraxIds).forEach(fantraxId => {
	teamData[fantraxId] = {};

	teamPromises.push(newFantraxPromise(fantraxId));
	teamPromises.push(newSheetsPromise(fantraxId));
});

Promise.all(teamPromises).then((values) => {
	var postPromises = [];

	values.forEach(value => {
		if (value.fantraxBudget != null) {
			teamData[value.fantraxId].fantraxBudget = value.fantraxBudget;
		}
		else if (value.sheetsBudget != null) {
			teamData[value.fantraxId].sheetsBudget = value.sheetsBudget;
		}
	});

	Object.keys(teamData).forEach(fantraxId => {
		var franchise = teamData[fantraxId];

		if (franchise.fantraxBudget - 1000 != franchise.sheetsBudget) {
			if (process.argv.includes('update')) {
				postPromises.push(newPostPromise(fantraxId, franchise.sheetsBudget + 1000));
			}
			else {
				console.log(fantraxId, franchise);
			}
		}
	});

	Promise.all(postPromises).then(() => {
		process.exit();
	});
});
