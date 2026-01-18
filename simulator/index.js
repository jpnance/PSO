var dotenv = require('dotenv').config({ path: '/app/.env' });

var fs = require('fs');
var path = require('path');
var pug = require('pug');
var compiledPug = pug.compileFile(path.join(__dirname, '../views/simulator.pug'));

var season = parseInt(process.env.SEASON);

var PSO = require('../config/pso');

var mongoOwners = {
	'Pat/Quinn': 'patQuinn',
	'Patrick': 'patrick',

	'Koci': 'koci',
	'Koci/Mueller': 'kociMueller',

	'Syed': 'syed',
	'Syed/Terence': 'syedTerence',
	'Syed/Kuan': 'syedKuan',
	'Luke': 'luke',

	'John': 'john',
	'John/Zach': 'johnZach',
	'Justin': 'justin',

	'Trevor': 'trevor',
	'Mike': 'mike',

	'Keyon': 'keyon',

	'Jeff': 'jeff',
	'Jake/Luke': 'jakeLuke',
	'Brett/Luke': 'brettLuke',
	'Brett': 'brett',

	'Daniel': 'daniel',
	'Terence': 'terence',
	'Jason': 'jason',

	'James': 'james',
	'James/Charles': 'jamesCharles',
	'Schexes': 'schexes',

	'Schexes': 'schexes',
	'Schex/Jeff': 'schexes',
	'Schex': 'schex',
	'Anthony': 'anthony',

	'Charles': 'charles',
	'Quinn': 'quinn',

	'Mitch/Mike': 'mitchMike',
	'Mitch': 'mitch'
};

var ownerFranchiseIds = {
	'patrick': 1,
	'patQuinn': 1,

	'koci': 2,
	'kociMueller': 2,

	'syed': 3,
	'syedTerence': 3,
	'syedKuan': 3,
	'luke': 3,

	'john': 4,
	'johnZach': 4,
	'justin': 4,

	'trevor': 5,
	'mike': 5,

	'keyon': 6,

	'jeff': 7,
	'jakeLuke': 7,
	'brettLuke': 7,
	'brett': 7,

	'daniel': 8,
	'terence': 8,
	'jason': 8,

	'james': 9,
	'jamesCharles': 9,
	'schexes': 9,

	//'schexes': 10,
	'schexJeff': 10,
	'schex': 10,
	'anthony': 10,

	'charles': 11,
	'quinn': 11,

	'mitchMike': 12,
	'mitch': 12
};

var manualWinners = {};
var manualLosers = {};
var adjustments = {};
var untilConditions = [];
var trials = 100;
var debug = false;
var render = false;
var cutoff = null;
var viewOnly = false;
var dataOnly = false;
var standingsOnly = false;
var simulationData = { owners: {}, simulations: [] };

process.argv.forEach(function(value, index, array) {
	if (index > 1) {
		var pair = value.split(/=/);

		switch (pair[0]) {
			case 'n':
				trials = parseInt(pair[1]);
				break;

			case 'winners':
				var winnersPairs = pair[1].split(/;/);

				for (var i in winnersPairs) {
					var weekPair = winnersPairs[i].split(/:/);

					var week = parseInt(weekPair[0]);
					var winners = weekPair[1].split(/,/);

					manualWinners[week] = winners;
				}

				break;

			case 'losers':
				var losersPairs = pair[1].split(/;/);

				for (var i in losersPairs) {
					var weekPair = losersPairs[i].split(/:/);

					var week = parseInt(weekPair[0]);
					var losers = weekPair[1].split(/,/);

					manualLosers[week] = losers;
				}

				break;

			case 'adjustments':
				var adjustmentPairs = pair[1].split(/;/);

				for (var i in adjustmentPairs) {
					var adjustmentPair = adjustmentPairs[i].split(/:/);

					var owner = mongoOwners[adjustmentPair[0]];
					var adjustment = parseInt(adjustmentPair[1]);

					adjustments[owner] = adjustment;
				}

				break;

			case 'until':
				var untilPairs = pair[1].split(/,/);

				for (var i in untilPairs) {
					var untilPair = untilPairs[i].split(/:/);

					untilConditions.push({ owner: mongoOwners[untilPair[0]], condition: untilPair[1] });
				}

				break;

			case 'debug':
				debug = true;
				break;

			case 'season':
				season = parseInt(pair[1]);
				break;

			case 'cutoff':
				cutoff = parseInt(pair[1]);
				break;

			case 'render':
				render = true;
				break;

			case 'viewonly':
				viewOnly = true;
				break;

			case 'dataonly':
				dataOnly = true;
				break;

			case 'standingsonly':
				standingsOnly = true;
				break;
		}
	}
});

console.log(manualWinners);

var owners = {};

Object.keys(PSO.franchiseNames).forEach(franchiseId => {
	if (!PSO.franchiseNames[franchiseId][season]) {
		return;
	}

	var ownerName = PSO.franchiseNames[franchiseId][season];
	var ownerId = mongoOwners[ownerName];

	owners[ownerId] = { id: ownerId, name: ownerName };
});

var schedule = {};
var results = {};

var mongo = require('mongodb').MongoClient;

mongo.connect(process.env.MONGODB_URI, function(err, client) {
	var games = client.db('pso').collection('games');
	var startWithWeek = 0;

	games.find({ season: season }).toArray(function(err, docs) {
		for (var i in docs) {
			var doc = docs[i];

			var week = doc['week'];
			var away = doc['away'];
			var home = doc['home'];

			var game = { away: {}, home: {} };

			game['away']['owner'] = mongoOwners[away['name']];
			game['away']['franchiseId'] = away['franchiseId'];
			game['home']['owner'] = mongoOwners[home['name']];
			game['home']['franchiseId'] = home['franchiseId'];

			if (manualWinners && manualWinners[week] && (manualWinners[week].indexOf(away['name']) != -1 || manualWinners[week].indexOf(home['name']) != -1)) {
				if (manualWinners[week].indexOf(away['name']) != -1) {
					game['winner'] = game['away']['owner'];
				}
				else if (manualWinners[week].indexOf(home['name']) != -1) {
					game['winner'] = game['home']['owner'];
				}

				if (!schedule[week]) {
					schedule[week] = [];
				}

				schedule[week].push(game);
			}
			else if (manualLosers && manualLosers[week] && (manualLosers[week].indexOf(away['name']) != -1 || manualLosers[week].indexOf(home['name']) != -1)) {
				if (manualLosers[week].indexOf(away['name']) != -1) {
					game['winner'] = game['home']['owner'];
				}
				else if (manualLosers[week].indexOf(home['name']) != -1) {
					game['winner'] = game['away']['owner'];
				}

				if (!schedule[week]) {
					schedule[week] = [];
				}

				schedule[week].push(game);
			}
			else if (doc['winner'] && (!cutoff || week <= cutoff)) {
				if (week > startWithWeek) {
					startWithWeek = week;
				}

				var winner = doc['winner'];

				game['away']['score'] = away['score'];
				game['home']['score'] = home['score'];

				game['winner'] = doc['winner'];
				game['loser'] = doc['loser'];

				if (!results[week]) {
					results[week] = [];
				}

				results[week].push(game);
			}
			else {
				if (!schedule[week]) {
					schedule[week] = [];
				}

				schedule[week].push(game);
			}
		}

		initializeOwners();

		if (viewOnly) {
			var percentagesData = JSON.parse(fs.readFileSync('../public/data/percentages.json', 'utf8'));

			Object.keys(schedule).forEach(weekId => {
				var week = schedule[weekId];

				week.forEach(game => {
					game.away.winRate = percentagesData[game.away.franchiseId].results[weekId].rate;
					game.home.winRate = percentagesData[game.home.franchiseId].results[weekId].rate;
				});
			});

			fs.writeFileSync(path.join(__dirname, '../public/simulator/index.html'), compiledPug({ owners: Object.values(PSO.franchises).sort(), franchises: PSO.franchises, results: results, schedule: schedule, options: { startWithWeek: startWithWeek + 1, trials: trials } }));
			process.exit();
		}

		if (standingsOnly) {
			var ownersCopy = extend(true, {}, owners);
			var standings = computeStandings(ownersCopy).reverse();

			standings.forEach((standing, i) => {
				console.log(`${i + 1}. ${standing.name} (${owners[standing.id].wins}-${owners[standing.id].losses})`);
			});

			process.exit();
		}

		simulate(trials);

		if (untilConditions.length == 0) {
			console.log();
			console.log("\t\t" + "Playoffs" + "\t" + "The Decision" + "\t" + "First Pick" + "\t" + "Avg. Finish" + "\t" + "9-6 and Out" + "\t" + "10-5 and Out" + "\t" + "11-4 and Out" + "\t" + "Poss. Finishes");

			for (ownerId in owners) {
				var owner = owners[ownerId];

				var inPct = owner.in / trials;
				var firstPct = owner.decision / trials;
				var lastPct = owner.topPick / trials;
				var avgFinish = owner.finish / trials;
				var nineWinMissRate = (owner.nineWins > 0) ? (owner.nineWinMisses / owner.nineWins).toFixed(3) : '--';
				var tenWinMissRate = (owner.tenWins > 0) ? (owner.tenWinMisses / owner.tenWins).toFixed(3) : '--';
				var elevenWinMissRate = (owner.elevenWins > 0) ? (owner.elevenWinMisses / owner.elevenWins).toFixed(3) : '--';

				var possibleFinishes = Object.keys(owner.finishes).sort((a, b) => a - b);
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

				console.log(owner.name + (owner.name.length > 7 ? "\t" : "\t\t") + inPct.toFixed(3) + "\t\t" + firstPct.toFixed(3) + "\t\t" + lastPct.toFixed(3) + "\t\t" + avgFinish.toFixed(3) + "\t\t" + nineWinMissRate + "\t\t" + tenWinMissRate + "\t\t" + elevenWinMissRate + "\t\t" + finishesString);
			}

			if (render) {
				var percentagesData = JSON.parse(fs.readFileSync('../public/data/percentages.json', 'utf8'));

				Object.keys(schedule).forEach(weekId => {
					var week = schedule[weekId];

					week.forEach(game => {
						game.away.winRate = percentagesData[game.away.franchiseId].results[weekId].rate;
						game.home.winRate = percentagesData[game.home.franchiseId].results[weekId].rate;
					});
				});

				fs.writeFileSync(path.join(__dirname, '../public/simulator/index.html'), compiledPug({ franchises: PSO.franchises, schedule: schedule, options: { startWithWeek: startWithWeek + 1, trials: trials } }));
			}

			if (dataOnly) {
				fs.writeFileSync(path.join(__dirname, '../public/data/simulations.json'), JSON.stringify(simulationData));
			}

			console.log();
		}

		client.close();
	});
});

function extend() {
    var options, name, src, copy, copyIsArray, clone, target = arguments[0] || {},
        i = 1,
        length = arguments.length,
        deep = false,
        toString = Object.prototype.toString,
        hasOwn = Object.prototype.hasOwnProperty,
        push = Array.prototype.push,
        slice = Array.prototype.slice,
        trim = String.prototype.trim,
        indexOf = Array.prototype.indexOf,
        class2type = {
          "[object Boolean]": "boolean",
          "[object Number]": "number",
          "[object String]": "string",
          "[object Function]": "function",
          "[object Array]": "array",
          "[object Date]": "date",
          "[object RegExp]": "regexp",
          "[object Object]": "object"
        },
        jQuery = {
          isFunction: function (obj) {
            return jQuery.type(obj) === "function"
          },
          isArray: Array.isArray ||
          function (obj) {
            return jQuery.type(obj) === "array"
          },
          isWindow: function (obj) {
            return obj != null && obj == obj.window
          },
          isNumeric: function (obj) {
            return !isNaN(parseFloat(obj)) && isFinite(obj)
          },
          type: function (obj) {
            return obj == null ? String(obj) : class2type[toString.call(obj)] || "object"
          },
          isPlainObject: function (obj) {
            if (!obj || jQuery.type(obj) !== "object" || obj.nodeType) {
              return false
            }
            try {
              if (obj.constructor && !hasOwn.call(obj, "constructor") && !hasOwn.call(obj.constructor.prototype, "isPrototypeOf")) {
                return false
              }
            } catch (e) {
              return false
            }
            var key;
            for (key in obj) {}
            return key === undefined || hasOwn.call(obj, key)
          }
        };
      if (typeof target === "boolean") {
        deep = target;
        target = arguments[1] || {};
        i = 2;
      }
      if (typeof target !== "object" && !jQuery.isFunction(target)) {
        target = {}
      }
      if (length === i) {
        target = this;
        --i;
      }
      for (i; i < length; i++) {
        if ((options = arguments[i]) != null) {
          for (name in options) {
            src = target[name];
            copy = options[name];
            if (target === copy) {
              continue
            }
            if (deep && copy && (jQuery.isPlainObject(copy) || (copyIsArray = jQuery.isArray(copy)))) {
              if (copyIsArray) {
                copyIsArray = false;
                clone = src && jQuery.isArray(src) ? src : []
              } else {
                clone = src && jQuery.isPlainObject(src) ? src : {};
              }
              // WARNING: RECURSION
              target[name] = extend(deep, clone, copy);
            } else if (copy !== undefined) {
              target[name] = copy;
            }
          }
        }
      }
      return target;
    }

function ownerSort(a, b) {
	if (a.wins == b.wins) {
		if (a.ties == b.ties) {
			return b.tiebreaker - a.tiebreaker;
		}
		else {
			return b.ties - a.ties;
		}
	}
	else {
		return b.wins - a.wins;
	}
}

function ownerScoresSort(a, b) {
	if (a.score && b.score) {
		return a.score - b.score;
	}

	return 0;
}

function ownerPointsSort(a, b) {
	return b.tiebreaker - a.tiebreaker;
}

function breakGroupTies(group) {
	var groupCopy = extend(true, [], group);

	if (groupCopy.length == 1) {
		if (debug) console.log('debug', groupCopy[0].name, groupCopy[0].tiebreaker, groupCopy[0].wins + '-' + groupCopy[0].losses);

		return groupCopy;
	}
	else {
		for (ownerId in groupCopy) {
			var owner = groupCopy[ownerId];

			owner.wins = 0;
			owner.losses = 0;
			owner.ties = 0;

			for (otherOwnerId in groupCopy) {
				var otherOwner = groupCopy[otherOwnerId];

				if (owner.id != otherOwner.id) {
					owner.wins += owner.against[otherOwner.id].wins;
					owner.losses += owner.against[otherOwner.id].losses;
					owner.ties += owner.against[otherOwner.id].ties;
				}
			}
		}

		var groups = {};

		for (ownerId in groupCopy) {
			var owner = groupCopy[ownerId];
			var games = owner.wins + owner.losses;
			var winPct = (games > 0) ? (owner.wins / games) : 0;
			var winPct = winPct.toFixed(3);

			if (!groups[winPct]) {
				groups[winPct] = [];
			}

			groups[winPct].push(owner);
		}

		var returnGroups = [];
		var keys = [];

		for (groupId in groups) {
			keys.push(groupId);
		}

		keys = keys.sort();

		if (keys.length == 1) {
			var group = groups[keys[0]];
			group.sort(ownerPointsSort).reverse();

			return group;

			/*
			var winner = group.shift();
			if (debug) console.log('debug', winner.name, winner.tiebreaker, group.length);

			return breakGroupTies(group).concat([winner]);
			*/
		}

		for (keyId in keys) {
			var group = groups[keys[keyId]];

			returnGroups = returnGroups.concat(breakGroupTies(group));
		}

		return returnGroups;
	}
}

function simulate(trials) {
	for (var i = 0; i < trials; i++) {
		var ownersCopy = extend(true, {}, owners);
		var simulation = {
			w: {},
			s: []
		};

		for (weekId in schedule) {
			if (weekId > 15) {
				continue;
			}

			if (!simulation.w[weekId]) {
				simulation.w[weekId] = [];
			}

			var week = schedule[weekId];

			for (gameId in week) {
				var game = week[gameId];

				var awayOwner = ownersCopy[game.away.owner];
				var homeOwner = ownersCopy[game.home.owner];

				var awayName = awayOwner.name;
				var homeName = homeOwner.name;

				/*
				var awayProbability = awayOwner.allPlay / (awayOwner.allPlay + homeOwner.allPlay);
				var homeProbability = homeOwner.allPlay / (homeOwner.allPlay + awayOwner.allPlay);

				var r = Math.random();
				*/

				var wrongTeamWins = false;
				var awayScore = game.away.score ? game.away.score : generateScore(awayOwner) + adjustments[mongoOwners[awayOwner.name]];
				var homeScore = game.home.score ? game.home.score : generateScore(homeOwner) + adjustments[mongoOwners[homeOwner.name]];

				do {
					awayScore = game.away.score ? game.away.score : generateScore(awayOwner) + adjustments[mongoOwners[awayOwner.name]];
					homeScore = game.home.score ? game.home.score : generateScore(homeOwner) + adjustments[mongoOwners[homeOwner.name]];

					if (game.winner && ((game.winner == game.home.owner && awayScore > homeScore) || (game.winner == game.away.owner && homeScore > awayScore))) {
						wrongTeamWins = true;
					}
					else {
						wrongTeamWins = false;
					}
				} while (wrongTeamWins);

				awayOwner.tiebreaker += awayScore;
				homeOwner.tiebreaker += homeScore;

				if (!game.away.wins) {
					game.away.wins = 0;
				}

				if (!game.home.wins) {
					game.home.wins = 0;
				}

				if (game.winner == game.home.owner) {
					awayOwner.losses += 1;
					homeOwner.wins += 1;

					awayOwner.against[homeOwner.id].losses += 1;
					homeOwner.against[awayOwner.id].wins += 1;

					game.home.wins += 1;

					simulation.w[weekId].push(ownerFranchiseIds[game.home.owner]);
				}
				else if (game.winner == game.away.owner) {
					awayOwner.wins += 1;
					homeOwner.losses += 1;

					awayOwner.against[homeOwner.id].wins += 1;
					homeOwner.against[awayOwner.id].losses += 1;

					game.away.wins +=1;

					simulation.w[weekId].push(ownerFranchiseIds[game.away.owner]);
				}
				else if (homeScore > awayScore) {
					awayOwner.losses += 1;
					homeOwner.wins += 1;

					awayOwner.against[homeOwner.id].losses += 1;
					homeOwner.against[awayOwner.id].wins += 1;

					game.home.wins +=1;

					simulation.w[weekId].push(ownerFranchiseIds[game.home.owner]);
				}
				else if (awayScore > homeScore) {
					awayOwner.wins += 1;
					homeOwner.losses += 1;

					awayOwner.against[homeOwner.id].wins += 1;
					homeOwner.against[awayOwner.id].losses += 1;

					game.away.wins += 1;

					simulation.w[weekId].push(ownerFranchiseIds[game.away.owner]);
				}

				ownersCopy[game.away.owner] = awayOwner;
				ownersCopy[game.home.owner] = homeOwner;
			}
		}

		var standings = computeStandings(ownersCopy).reverse();
		if (debug) console.log(ownersCopy);

		for (var j = 0; j < standings.length; j++) {
			simulation.s.push({ id: ownerFranchiseIds[standings[j].id], w: ownersCopy[standings[j].id].wins, l: ownersCopy[standings[j].id].losses });

			if (ownersCopy[standings[j].id].wins >= 11) {
				owners[standings[j].id].elevenWins++;
			}
			else if (ownersCopy[standings[j].id].wins == 10) {
				owners[standings[j].id].tenWins++;
			}
			else if (ownersCopy[standings[j].id].wins == 9) {
				owners[standings[j].id].nineWins++;
			}

			if (j == 0) {
				owners[standings[j].id].decision += 1;
			}

			if (j == 4) {
				owners[standings[j].id].topPick += 1;
			}

			if (j < 4) {
				owners[standings[j].id].in += 1;
			}
			else {
				if (ownersCopy[standings[j].id].wins >= 11) {
					owners[standings[j].id].elevenWinMisses++;
				}
				else if (ownersCopy[standings[j].id].wins == 10) {
					owners[standings[j].id].tenWinMisses++;
				}
				else if (ownersCopy[standings[j].id].wins == 9) {
					owners[standings[j].id].nineWinMisses++;
				}

				owners[standings[j].id].out += 1;
			}

			owners[standings[j].id].finish += (j + 1);

			if (!owners[standings[j].id].finishes[j + 1]) {
				owners[standings[j].id].finishes[j + 1] = 0;
			}

			owners[standings[j].id].finishes[j + 1]++;
		}

		if (untilConditions.length) {
			var conditionsMet = true;

			untilConditions.forEach(untilCondition => {
				if (untilCondition.condition == 'in') {
					if (standings[0].id != untilCondition.owner && standings[1].id != untilCondition.owner && standings[2].id != untilCondition.owner && standings[3].id != untilCondition.owner) {
						conditionsMet = false;
					}
				}
				else if (untilCondition.condition == 'out') {
					if (standings[0].id == untilCondition.owner || standings[1].id == untilCondition.owner || standings[2].id == untilCondition.owner || standings[3].id == untilCondition.owner) {
						conditionsMet = false;
					}
				}
				else if (untilCondition.condition == 'decision') {
					if (standings[0].id != untilCondition.owner) {
						conditionsMet = false;
					}
				}
				else if (untilCondition.condition == 'noDecision') {
					if (standings[0].id == untilCondition.owner) {
						conditionsMet = false;
					}
				}
				else if (untilCondition.condition == 'fifthPlace') {
					if (standings[4].id != untilCondition.owner) {
						conditionsMet = false;
					}
				}
				else if (untilCondition.condition == 'noFirstPick') {
					if (standings[4].id == untilCondition.owner) {
						conditionsMet = false;
					}
				}
				else {
					switch (untilCondition.condition) {
						case '1st': conditionsMet = (standings[0].id == untilCondition.owner); break;
						case '2nd': conditionsMet = (standings[1].id == untilCondition.owner); break;
						case '3rd': conditionsMet = (standings[2].id == untilCondition.owner); break;
						case '4th': conditionsMet = (standings[3].id == untilCondition.owner); break;
						case '5th': conditionsMet = (standings[4].id == untilCondition.owner); break;
						case '6th': conditionsMet = (standings[5].id == untilCondition.owner); break;
						case '7th': conditionsMet = (standings[6].id == untilCondition.owner); break;
						case '8th': conditionsMet = (standings[7].id == untilCondition.owner); break;
						case '9th': conditionsMet = (standings[8].id == untilCondition.owner); break;
						case '10th': conditionsMet = (standings[9].id == untilCondition.owner); break;
						case '11th': conditionsMet = (standings[10].id == untilCondition.owner); break;
						case '12th': conditionsMet = (standings[11].id == untilCondition.owner); break;
					}
				}
			});

			if (conditionsMet) {
				outputNiceStandings(ownersCopy, standings);
				break;
			}
		}

		/*
		if (owners['kociMueller'].out > 0) {
			console.log(standings);
			console.log(ownersCopy);
			return;
		}
		*/

		simulationData.simulations.push(simulation);
	}
}

function outputNiceStandings(owners, standings) {
	standings.forEach(standing => {
		console.log(standing.name + (standing.name.length > 7 ? "\t" : "\t\t") + owners[standing.id].wins + '-' + owners[standing.id].losses + "\t\t" + owners[standing.id].tiebreaker.toFixed(2));
	});
}

function computeStandings(owners) {
	var standings = [];
	var naiveStandings = [];

	for (ownerId in owners) {
		naiveStandings.push(owners[ownerId]);
	}

	naiveStandings = naiveStandings.sort(ownerSort).reverse();
	standings = breakGroupTies(naiveStandings);

	return standings;
}

function initializeOwners() {
	for (ownerId in owners) {
		var owner = owners[ownerId];

		owner.against = [];

		for (otherOwnerId in owners) {
			var otherOwner = owners[otherOwnerId];

			if (owner.id != otherOwner.id) {
				owner.against[otherOwner.id] = { wins: 0, losses: 0, ties: 0 };
			}
		}

		owner.allPlay = 0;
		owner.decision = 0;
		owner.in = 0;
		owner.losses = 0;
		owner.nineWinMisses = 0;
		owner.nineWins = 0;
		owner.tenWinMisses = 0;
		owner.tenWins = 0;
		owner.out = 0;
		owner.scores = [];
		owner.elevenWinMisses = 0;
		owner.elevenWins = 0;
		owner.tiebreaker = 0;
		owner.ties = 0;
		owner.topPick = 0;
		owner.wins = 0;
		owner.finish = 0;
		owner.finishes = {};

		if (!adjustments[ownerId]) {
			adjustments[ownerId] = 0;
		}
	}

	for (weekId in results) {
		var ownerScores = [];
		var week = results[weekId];

		for (gameId in week) {
			var game = week[gameId];

			var awayOwnerScore = game.away;
			var homeOwnerScore = game.home;

			var awayOwner = owners[awayOwnerScore.owner];
			var homeOwner = owners[homeOwnerScore.owner];

			if (awayOwnerScore.score && homeOwnerScore.score) {
				ownerScores.push(awayOwnerScore, homeOwnerScore);

				awayOwner.scores.push(awayOwnerScore.score);
				homeOwner.scores.push(homeOwnerScore.score);

				if (false) {
				if (weekId == Object.keys(results).length) {
					awayOwner.scores.push(awayOwnerScore.score);
					awayOwner.scores.push(awayOwnerScore.score);
					homeOwner.scores.push(homeOwnerScore.score);
					homeOwner.scores.push(homeOwnerScore.score);
				}
				if (weekId == Object.keys(results).length - 1) {
					awayOwner.scores.push(awayOwnerScore.score);
					homeOwner.scores.push(homeOwnerScore.score);
				}
				}

				if (awayOwnerScore.score > homeOwnerScore.score) {
					awayOwner.wins += 1;
					homeOwner.losses += 1;

					awayOwner.against[homeOwner.id].wins += 1;
					homeOwner.against[awayOwner.id].losses += 1;
				}
				else if (homeOwnerScore.score > awayOwnerScore.score) {
					homeOwner.wins += 1;
					awayOwner.losses += 1;

					homeOwner.against[awayOwner.id].wins += 1;
					awayOwner.against[homeOwner.id].losses += 1;
				}
				else {
					homeOwner.ties += 1;
					awayOwner.ties += 1;

					homeOwner.against[awayOwner.id].ties += 1;
					awayOwner.against[homeOwner.id].ties += 1;
				}
			}
		}

		ownerScores = ownerScores.sort(ownerScoresSort);

		for (allPlay in ownerScores) {
			var ownerScore = ownerScores[allPlay];
			var owner = owners[ownerScore.owner];

			owner.allPlay += parseInt(allPlay);
			owner.tiebreaker += ownerScore.score;
		}
	}

	for (ownerId in owners) {
		var owner = owners[ownerId];
		var games = owner.wins + owner.ties + owner.losses;
		var games = owner.scores.length;

		var sum = 0;

		for (scoreId in owner.scores) {
			sum += owner.scores[scoreId];
		}

		owner.average = sum / games;
	}

	for (ownerId in owners) {
		var owner = owners[ownerId];
		var games = owner.wins + owner.ties + owner.losses;
		var games = owner.scores.length;
		var average = owner.average;

		var variance = 0;

		for (scoreId in owner.scores) {
			variance += Math.pow(owner.scores[scoreId] - average, 2);
		}

		owner.stdev = Math.sqrt(variance / (games - 1));
	}

	var ownersCopy = extend(true, {}, owners);
	var currentStandings = computeStandings(ownersCopy).reverse();

	for (ownerId in owners) {
		var owner = owners[ownerId];
		var currentStanding = currentStandings.findIndex((owner) => owner.id == ownerId);

		simulationData.owners[ownerFranchiseIds[ownerId]] = { id: ownerFranchiseIds[ownerId], wins: owner.wins, losses: owner.losses, currentStanding: currentStanding + 1 };
	}
}

function generateScore(owner) {
	if (!owner.stdev) {
		return owner.average;
	}

	var sum = 0;

	for (var i = 0; i < 12; i++) {
		sum += Math.random();
	}

	return ((sum - 6) * owner.stdev) + owner.average;
}

function niceFinish(finish) {
	switch (parseInt(finish)) {
		case 1: return '1st';
		case 2: return '2nd';
		case 3: return '3rd';
		default: return finish + 'th';
	}
}
