var fs = require('fs');
var PSO = require('../pso');

if (process.argv.length < 3) {
	console.log('Invalid week');
	console.log('Usage: node index.js <this week>');
	process.exit();
}

var thisWeek = parseInt(process.argv[2]);

var fileData = null;
var simulationData = null;

var franchiseData = {};

try {
	fileData = fs.readFileSync('../public/data/simulations.json', 'utf8');
	simulationData = JSON.parse(fileData);
}
catch (error) {
	response.status(500).send({ error: error, message: 'Unable to read simulations.json' });
	return;
}

/*
simulations: [ {
	"w": {
		"11": [11],
		"12":[1,4,7,12,10,5],
		"13":[12,1,4,10,8,2],
		"14":[8,1,6,10,2,4]
	},
	"s": [
		{"id":6,"w":12,"l":2},
		{"id":1,"w":11,"l":3},
		{"id":4,"w":10,"l":3},
		{"id":8,"w":9,"l":5},
		{"id":10,"w":9,"l":5},
		{"id":5,"w":7,"l":6},
		{"id":2,"w":7,"l":6},
		{"id":7,"w":7,"l":7},
		{"id":9,"w":4,"l":10},
		{"id":12,"w":3,"l":11},
		{"id":3,"w":2,"l":11},
		{"id":11,"w":1,"l":13}
	]
} ] 

{
	'Brett': {
		playoffs: {
			neutral: {
				in: 123,
				out: 123
			},
			withWin: {
				in: 12,
				out: 12
			},
			withLoss: {
				in: 234,
				out: 234
			}
		},
		wpct: {
			11: {
				wins: 123,
				losses: 123
			}
		}
	}
}

*/

Object.keys(PSO.franchises).forEach(franchiseId => {
	franchiseData[franchiseId] = {
		playoffs: {
			neutral: {
				in: 0,
				out: 0,
				total: 0
			},
			withWin: {
				in: 0,
				out: 0,
				total: 0
			},
			withLoss: {
				in: 0,
				out: 0,
				total: 0
			}
		},
		results: {}
	};
});

simulationData.simulations.forEach(simulation => {
	var weekData = simulation.w;
	var standingsData = simulation.s;

	Object.keys(franchiseData).forEach(franchiseId => {
		var thisWeekWin = weekData[thisWeek].includes(parseInt(franchiseId));

		if (standingsData.findIndex(standing => parseInt(standing.id) == parseInt(franchiseId)) < 4) {
			franchiseData[franchiseId].playoffs.neutral.in += 1;
			franchiseData[franchiseId].playoffs.neutral.total += 1;

			if (thisWeekWin) {
				franchiseData[franchiseId].playoffs.withWin.in += 1;
				franchiseData[franchiseId].playoffs.withWin.total += 1;
			}
			else {
				franchiseData[franchiseId].playoffs.withLoss.in += 1;
				franchiseData[franchiseId].playoffs.withLoss.total += 1;
			}
		}
		else {
			franchiseData[franchiseId].playoffs.neutral.out += 1;
			franchiseData[franchiseId].playoffs.neutral.total += 1;

			if (thisWeekWin) {
				franchiseData[franchiseId].playoffs.withWin.out += 1;
				franchiseData[franchiseId].playoffs.withWin.total += 1;
			}
			else {
				franchiseData[franchiseId].playoffs.withLoss.out += 1;
				franchiseData[franchiseId].playoffs.withLoss.total += 1;
			}
		}
	});

	Object.keys(weekData).forEach(week => {
		Object.keys(franchiseData).forEach(franchiseId => {
			if (!franchiseData[franchiseId].results[week]) {
				franchiseData[franchiseId].results[week] = { wins: 0, losses: 0, total: 0 };
			}

			if (weekData[week].includes(parseInt(franchiseId))) {
				franchiseData[franchiseId].results[week].wins += 1;
			}
			else {
				franchiseData[franchiseId].results[week].losses += 1;
			}

			franchiseData[franchiseId].results[week].total += 1;
		});
	});
});

Object.keys(franchiseData).forEach(franchiseId => {
	var owner = franchiseData[franchiseId];

	owner.playoffs.neutral.rate = owner.playoffs.neutral.in / owner.playoffs.neutral.total;
	owner.playoffs.withWin.rate = owner.playoffs.withWin.in / owner.playoffs.withWin.total;
	owner.playoffs.withLoss.rate = owner.playoffs.withLoss.in / owner.playoffs.withLoss.total;

	Object.keys(owner.results).forEach(week => {
		owner.results[week].rate = owner.results[week].wins / owner.results[week].total;
	});

	owner.winLeverage = owner.playoffs.withWin.rate - owner.playoffs.neutral.rate;
	owner.lossLeverage = owner.playoffs.withLoss.rate - owner.playoffs.neutral.rate;
	owner.volatility = Math.abs(owner.winLeverage - owner.lossLeverage);

	if (owner.playoffs.neutral.rate > 0) {
		owner.winLeverageVersusNeutral = owner.winLeverage / owner.playoffs.neutral.rate;
		owner.lossLeverageVersusNeutral = owner.lossLeverage / owner.playoffs.neutral.rate;
	}
	else {
		owner.winLeverageVersusNeutral = 0;
		owner.lossLeverageVersusNeutral = 0;
	}

	owner.desperation = owner.winLeverageVersusNeutral - owner.lossLeverageVersusNeutral;
	owner.volatation = 0.75 * owner.volatility + 0.25 * owner.desperation;

	owner.interestLevel = (0.5 - Math.abs(owner.results[thisWeek].rate - 0.5)) * owner.volatation;
});

fs.writeFileSync('../public/data/percentages.json', JSON.stringify(franchiseData));
//console.log(JSON.stringify(franchiseData, null, '    '));
