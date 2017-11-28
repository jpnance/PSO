var mongoOwners = {
	'Patrick': 'patrick',
	'Koci/Mueller': 'kociMueller',
	'Syed/Terence': 'syedTerence',
	'John': 'johnZach',
	'John/Zach': 'johnZach',
	'Trevor': 'trevor',
	'Keyon': 'keyon',
	'Brett/Luke': 'brettLuke',
	'Daniel': 'daniel',
	'James': 'jamesCharles',
	'James/Charles': 'jamesCharles',
	'Schex/Jeff': 'schexJeff',
	'Quinn': 'quinn',
	'Mitch': 'mitch'
};

var manualWinners = {};
var adjustments = {};
var trials = 100;

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

			case 'adjustments':
				var adjustmentPairs = pair[1].split(/;/);

				for (var i in adjustmentPairs) {
					var adjustmentPair = adjustmentPairs[i].split(/:/);

					var owner = mongoOwners[adjustmentPair[0]];
					var adjustment = parseInt(adjustmentPair[1]);

					adjustments[owner] = adjustment;
				}

				break;
		}
	}
});

console.log(manualWinners);

var schedule = {};
var results = {};

var mongo = require('mongodb').MongoClient;

mongo.connect('mongodb://localhost:27017/pso', function(err, db) {
	var games = db.collection('games');

	games.find({ season: 2017 }).toArray(function(err, docs) {
		for (var i in docs) {
			var doc = docs[i];

			var week = doc['week'];
			var away = doc['away'];
			var home = doc['home'];

			var game = { away: {}, home: {} };

			game['away']['owner'] = mongoOwners[away['name']];
			game['home']['owner'] = mongoOwners[home['name']];

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
			else if (doc['winner']) {
				var winner = doc['winner'];

				game['away']['score'] = away['score'];
				game['home']['score'] = home['score'];

				game['winner'] = mongoOwners[winner['name']];

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
		simulate(trials);

		console.log();
		console.log(JSON.stringify(schedule, null, "\t"));

		console.log();
		console.log("\t\t" + "Playoffs" + "\t" + "The Decision" + "\t" + "First Pick" + "\t" + "Avg. Finish" + "\t" + "9-5 and Out" + "\t" + "10-4 and Out");

		for (ownerId in owners) {
			var owner = owners[ownerId];

			var inPct = owner.in / trials;
			var firstPct = owner.decision / trials;
			var lastPct = owner.topPick / trials;
			var avgFinish = owner.finish / trials;
			var nineWinMissRate = (owner.nineWins > 0) ? (owner.nineWinMisses / owner.nineWins).toFixed(3) : '--';
			var tenWinMissRate = (owner.tenWins > 0) ? (owner.tenWinMisses / owner.tenWins).toFixed(3) : '--';

			console.log(owner.name + (owner.name.length > 7 ? "\t" : "\t\t") + inPct.toFixed(3) + "\t\t" + firstPct.toFixed(3) + "\t\t" + lastPct.toFixed(3) + "\t\t" + avgFinish.toFixed(3) + "\t\t" + nineWinMissRate + "\t\t" + tenWinMissRate);
		}

		console.log();

		db.close();
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

var debug = false;

var owners = {
	brettLuke: { id: 'brettLuke', name: 'Brett/Luke' },
	daniel: { id: 'daniel', name: 'Daniel' },
	jamesCharles: { id: 'jamesCharles', name: 'James/Charles' },
	johnZach: { id: 'johnZach', name: 'John/Zach' },
	keyon: { id: 'keyon', name: 'Keyon' },
	kociMueller: { id: 'kociMueller', name: 'Koci/Mueller' },
	mitch: { id: 'mitch', name: 'Mitch' },
	patrick: { id: 'patrick', name: 'Patrick' },
	quinn: { id: 'quinn', name: 'Quinn' },
	schexJeff: { id: 'schexJeff', name: 'Schex/Jeff' },
	syedTerence: { id: 'syedTerence', name: 'Syed/Terence' },
	trevor: { id: 'trevor', name: 'Trevor' }
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
	if (debug) console.log(groupCopy);

	if (groupCopy.length == 1) {
		if (debug) console.log(1);
		return groupCopy;
	}
	else {
		if (debug) console.log(2);
		// first, compute the mutual wins/losses within the group
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


		// second, see if the same number of games within the group have been played
		var groupGames = groupCopy[0].wins + groupCopy[0].losses + groupCopy[0].ties;
		var equalGames = true;

		for (ownerId in groupCopy) {
			var owner = groupCopy[ownerId];

			if (owner.wins + owner.losses + owner.ties != groupGames) {
				equalGames = false;
			}
		}



		if (equalGames) {
			if (debug) console.log(3);
			var groups = {};

			for (ownerId in groupCopy) {
				var owner = groupCopy[ownerId];
				var games = owner.wins + owner.losses;
				var winPct = (games > 0) ? (owner.wins / games) : -1;
				var winPct = winPct.toFixed(3);

				if (!groups[winPct]) {
					groups[winPct] = [];
				}

				groups[winPct].push(owner);
			}
			if (debug) console.log(groups);

			var returnGroups = [];

			var keys = [];

			for (groupId in groups) {
				keys.push(groupId);
			}

			keys = keys.sort();

			for (keyId in keys) {
				var groupId = keys[keyId];
				if (debug) console.log(groupId);
				if (groups[groupId].length != groupCopy.length) {
					if (debug) console.log(4);
					returnGroups = returnGroups.concat(breakGroupTies(groups[groupId]));
				}
				else {
					if (debug) console.log(5);
					rest = groups[groupId].sort(ownerPointsSort).reverse();
					return rest;
				}
			}

			return returnGroups;
		}
		else {
			if (debug) console.log(6);
			rest = groupCopy.sort(ownerPointsSort).reverse();
			return rest;
		}
	}
}

function simulate(trials) {
	for (var i = 0; i < trials; i++) {
		var ownersCopy = extend(true, {}, owners);

		for (weekId in schedule) {
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

					game.home.wins +=1;
				}
				else if (game.winner == game.away.owner) {
					awayOwner.wins += 1;
					homeOwner.losses += 1;

					awayOwner.against[homeOwner.id].wins += 1;
					homeOwner.against[awayOwner.id].losses += 1;

					game.away.wins +=1;
				}
				else if (homeScore > awayScore) {
					awayOwner.losses += 1;
					homeOwner.wins += 1;

					awayOwner.against[homeOwner.id].losses += 1;
					homeOwner.against[awayOwner.id].wins += 1;

					game.home.wins +=1;
				}
				else if (awayScore > homeScore) {
					awayOwner.wins += 1;
					homeOwner.losses += 1;

					awayOwner.against[homeOwner.id].wins += 1;
					homeOwner.against[awayOwner.id].losses += 1;

					game.away.wins +=1;
				}

				ownersCopy[game.away.owner] = awayOwner;
				ownersCopy[game.home.owner] = homeOwner;
			}
		}

		var standings = computeStandings(ownersCopy).reverse();
		if (debug) console.log(ownersCopy);

		for (var j = 0; j < standings.length; j++) {
			if (ownersCopy[standings[j].id].wins >= 10) {
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
				if (ownersCopy[standings[j].id].wins >= 10) {
					owners[standings[j].id].tenWinMisses++;
				}
				else if (ownersCopy[standings[j].id].wins == 9) {
					owners[standings[j].id].nineWinMisses++;
				}

				owners[standings[j].id].out += 1;
			}

			owners[standings[j].id].finish += (j + 1);
		}

		/*
		if (owners['kociMueller'].out > 0) {
			console.log(standings);
			console.log(ownersCopy);
			return;
		}
		*/
	}
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
		owner.out = 0;
		owner.scores = [];
		owner.tenWinMisses = 0;
		owner.tenWins = 0;
		owner.tiebreaker = 0;
		owner.ties = 0;
		owner.topPick = 0;
		owner.wins = 0;
		owner.finish = 0;

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
}

function generateScore(owner) {
	var sum = 0;

	for (var i = 0; i < 12; i++) {
		sum += Math.random();
	}

	return ((sum - 6) * owner.stdev) + owner.average;
}
