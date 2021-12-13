var fs = require('fs');
var pug = require('pug');
var compiledPug = pug.compileFile('views/simulator-table.pug');

var PSO = require('../pso');

var fileStats = null;
var fileData = null;
var simulationData = null;
var lastModified = null;
var resultsCache = {};

var niceFinish = function(finish) {
	switch (parseInt(finish)) {
		case 1: return '1st';
		case 2: return '2nd';
		case 3: return '3rd';
		default: return finish + 'th';
	}
};

var parseConditions = function(conditionsString) {
	var uncommas = conditionsString.split(/,/);
	var conditions = [];

	uncommas.forEach(uncomma => {
		var conditionPair = uncomma.split(/:/);
		var week = parseInt(conditionPair[0]);
		var franchiseId = parseInt(conditionPair[1]);

		if (!week || week < 1 || week > 15) {
			return;
		}

		if (!franchiseId || franchiseId < 1 || franchiseId > 12) {
			return;
		}

		conditions.push({ week: week, winner: franchiseId });
	});

	conditions.sort(function(a, b) {
		if (a.week < b.week) {
			return -1;
		}
		else if (a.week > b.week) {
			return 1;
		}
		else {
			if (a.winner < b.winner) {
				return -1;
			}
			else if (a.winner > b.winner) {
				return 1;
			}
			else {
				return 0;
			}
		}
	});

	return conditions;
};

module.exports.clearCache = function(request, response) {
	resultsCache = {};
	response.redirect('/simulator');
};

module.exports.filterByConditions = function(request, response) {
	try {
		fileStats = fs.statSync('public/data/simulations.json');
	}
	catch (error) {
		console.log('no');
		response.status(500).send({ error: error, message: 'Unable to get file stats for simulations.json' });
		return;
	}

	if (!lastModified || (fileStats.mtimeMs != lastModified)) {
		try {
			fileData = fs.readFileSync('public/data/simulations.json', 'utf8');

			simulationData = JSON.parse(fileData);
			lastModified = fileStats.mtimeMs;
			resultsCache = {};
		}
		catch (error) {
			console.log('wos');
			response.status(500).send({ error: error, message: 'Unable to read simulations.json' });
			return;
		}
	}


	var conditions = parseConditions(request.params.conditions || '');
	var conditionsCacheKey = JSON.stringify(conditions);

	if (conditionsCacheKey == '') {
		conditionsCacheKey = 'default';
	}

	if (resultsCache[conditionsCacheKey]) {
		response.send(resultsCache[conditionsCacheKey]);
		return;
	}

	var filteredSimulations = simulationData.simulations.filter(simulation => {
		var truthiness = true;

		conditions.forEach(condition => {
			if (!simulation.w[condition.week]) {
				return;
			}

			truthiness = truthiness && simulation.w[condition.week].includes(condition.winner);
		});

		return truthiness;
	});

	var pugResults = [];
	var ownerSummary = {};

	Object.keys(PSO.franchises).forEach(franchiseId => {
		ownerSummary[franchiseId] = {
			decision: 0,
			firstPick: 0,
			in: 0,
			losses: 0,
			nineWinMisses: 0,
			nineWins: 0,
			tenWinMisses: 0,
			tenWins: 0,
			out: 0,
			elevenWinMisses: 0,
			elevenWins: 0,
			topPick: 0,
			wins: 0,
			finish: 0,
			finishes: {}
		};
	});

	filteredSimulations.forEach(filteredSimulation => {
		filteredSimulation.s.forEach((standing, i) => {
			if (standing.w >= 11) {
				ownerSummary[standing.id].elevenWins++;
			}
			else if (standing.w == 10) {
				ownerSummary[standing.id].tenWins++;
			}
			else if (standing.w == 9) {
				ownerSummary[standing.id].nineWins++;
			}

			if (i == 0) {
				ownerSummary[standing.id].decision++;
			}

			if (i < 4) {
				ownerSummary[standing.id].in++;
			}
			else if (i >= 4) {
				if (standing.w >= 11) {
					ownerSummary[standing.id].elevenWinMisses++;
				}
				else if (standing.w == 10) {
					ownerSummary[standing.id].tenWinMisses++;
				}
				else if (standing.w == 9) {
					ownerSummary[standing.id].nineWinMisses++;
				}

				ownerSummary[standing.id].out++;
			}

			if (i == 4) {
				ownerSummary[standing.id].firstPick++;
			}

			ownerSummary[standing.id].finish += (i + 1);

			if (!ownerSummary[standing.id].finishes[i + 1]) {
				ownerSummary[standing.id].finishes[i + 1] = 0;
			}

			ownerSummary[standing.id].finishes[i + 1]++;
		});
	});

	Object.keys(PSO.franchises).forEach(franchiseId => {
		var name = PSO.franchises[franchiseId];
		var summary = ownerSummary[franchiseId];

		var inPct = summary.in / filteredSimulations.length;
		var outPct = summary.out / filteredSimulations.length;
		var decisionPct = summary.decision / filteredSimulations.length;
		var firstPickPct = summary.firstPick / filteredSimulations.length;
		var averageFinish = summary.finish / filteredSimulations.length;
		var nineWinMissRate = (summary.nineWinMisses > 0) ? (summary.nineWinMisses / summary.nineWins) : '--';
		var tenWinMissRate = (summary.tenWinMisses > 0) ? (summary.tenWinMisses / summary.tenWins) : '--';
		var elevenWinMissRate = (summary.elevenWinMisses > 0) ? (summary.elevenWinMisses / summary.elevenWins) : '--';

		var possibleFinishes = Object.keys(summary.finishes).sort((a, b) => a - b);
		var finishesString = '';

		var startFinish = null, endFinish = null;

		if (possibleFinishes.length == 1) {
			finishesString = niceFinish(possibleFinishes[0]);
		}
		else {
			for (var i = 0; i < possibleFinishes.length; i++) {
				if (i == 0) {
					startFinish = possibleFinishes[i];
				}
				else if (possibleFinishes[i] - possibleFinishes[i - 1] > 1) {
					if (finishesString.length > 0) {
						finishesString += ', ';
					}

					finishesString += niceFinish(startFinish) + (endFinish ? '-' + niceFinish(endFinish) : '');
					startFinish = possibleFinishes[i];
					endFinish = null;
				}
				else {
					endFinish = possibleFinishes[i];
				}
			}

			if (finishesString.length > 0) {
				finishesString += ', ';
			}

			finishesString += niceFinish(startFinish) + (endFinish ? '-' + niceFinish(endFinish) : '');
		}

		for (var n = 1; n <= 12; n++) {
			if (!summary.finishes[n]) {
				summary.finishes[n] = 0;
			}
		}

		pugResults.push({ owner: { name: name, wins: simulationData.owners[franchiseId].wins, losses: simulationData.owners[franchiseId].losses, finishes: summary.finishes }, playoffs: inPct, decision: decisionPct, firstPick: firstPickPct, avgFinish: averageFinish, nineAndOut: nineWinMissRate, tenAndOut: tenWinMissRate, elevenAndOut: elevenWinMissRate, finishesString: finishesString });
	});

	pugResults.sort(function(a, b) {
		if (a.owner.name < b.owner.name) {
			return -1;
		}
		else if (a.owner.name > b.owner.name) {
			return 1;
		}
		else {
			return 0;
		}
	});

	resultsCache[conditionsCacheKey] = compiledPug({ results: pugResults, options: { trials: filteredSimulations.length } });

	response.send(resultsCache[conditionsCacheKey]);
	return;
};
