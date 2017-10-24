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
var schedule = {"11":[{"away":{"owner":"mitch"},"home":{"owner":"syedTerence"}},{"away":{"owner":"james"},"home":{"owner":"kociMueller"}},{"away":{"owner":"daniel"},"home":{"owner":"patrick"}},{"away":{"owner":"trevor"},"home":{"owner":"brettLuke"}},{"away":{"owner":"schexJeff"},"home":{"owner":"johnZach"}},{"away":{"owner":"keyon"},"home":{"owner":"quinn"}}],"12":[{"away":{"owner":"mitch"},"home":{"owner":"johnZach"}},{"away":{"owner":"james"},"home":{"owner":"quinn"}},{"away":{"owner":"syedTerence"},"home":{"owner":"daniel"}},{"away":{"owner":"kociMueller"},"home":{"owner":"brettLuke"}},{"away":{"owner":"trevor"},"home":{"owner":"keyon"}},{"away":{"owner":"schexJeff"},"home":{"owner":"patrick"}}],"13":[{"away":{"owner":"mitch"},"home":{"owner":"keyon"}},{"away":{"owner":"james"},"home":{"owner":"schexJeff"}},{"away":{"owner":"syedTerence"},"home":{"owner":"johnZach"}},{"away":{"owner":"kociMueller"},"home":{"owner":"quinn"}},{"away":{"owner":"daniel"},"home":{"owner":"trevor"}},{"away":{"owner":"patrick"},"home":{"owner":"brettLuke"}}],"14":[{"away":{"owner":"mitch"},"home":{"owner":"james"}},{"away":{"owner":"syedTerence"},"home":{"owner":"kociMueller"}},{"away":{"owner":"daniel"},"home":{"owner":"keyon"}},{"away":{"owner":"trevor"},"home":{"owner":"schexJeff"}},{"away":{"owner":"patrick"},"home":{"owner":"quinn"}},{"away":{"owner":"brettLuke"},"home":{"owner":"johnZach"}}]};
var results = {"1":[{"away":{"owner":"mitch","score":171.52},"home":{"owner":"kociMueller","score":167.4},"winner":"mitch"},{"away":{"owner":"james","score":143.36},"home":{"owner":"syedTerence","score":101.3},"winner":"james"},{"away":{"owner":"daniel","score":128.72},"home":{"owner":"quinn","score":120.94},"winner":"daniel"},{"away":{"owner":"trevor","score":142.76},"home":{"owner":"johnZach","score":125.98},"winner":"trevor"},{"away":{"owner":"schexJeff","score":112.56},"home":{"owner":"brettLuke","score":160.53},"winner":"brettLuke"},{"away":{"owner":"keyon","score":146.18},"home":{"owner":"patrick","score":150.24},"winner":"patrick"}],"2":[{"away":{"owner":"mitch","score":96.88},"home":{"owner":"patrick","score":196.65},"winner":"patrick"},{"away":{"owner":"james","score":146.62},"home":{"owner":"johnZach","score":113.38},"winner":"james"},{"away":{"owner":"syedTerence","score":149.3},"home":{"owner":"brettLuke","score":123.11},"winner":"syedTerence"},{"away":{"owner":"kociMueller","score":154.02},"home":{"owner":"daniel","score":109.46},"winner":"kociMueller"},{"away":{"owner":"trevor","score":180.88},"home":{"owner":"quinn","score":184.46},"winner":"quinn"},{"away":{"owner":"schexJeff","score":127.37},"home":{"owner":"keyon","score":162},"winner":"keyon"}],"3":[{"away":{"owner":"mitch","score":185.64},"home":{"owner":"schexJeff","score":135.25},"winner":"mitch"},{"away":{"owner":"james","score":149.42},"home":{"owner":"trevor","score":124.52},"winner":"james"},{"away":{"owner":"syedTerence","score":105.2},"home":{"owner":"patrick","score":165.08},"winner":"patrick"},{"away":{"owner":"kociMueller","score":202.6},"home":{"owner":"keyon","score":218.66},"winner":"keyon"},{"away":{"owner":"daniel","score":151.26},"home":{"owner":"brettLuke","score":160.26},"winner":"brettLuke"},{"away":{"owner":"johnZach","score":128.9},"home":{"owner":"quinn","score":160.45},"winner":"quinn"}],"4":[{"away":{"owner":"mitch","score":142.26},"home":{"owner":"syedTerence","score":95.05},"winner":"mitch"},{"away":{"owner":"james","score":136.48},"home":{"owner":"kociMueller","score":172.56},"winner":"kociMueller"},{"away":{"owner":"daniel","score":131.36},"home":{"owner":"patrick","score":141.25},"winner":"patrick"},{"away":{"owner":"trevor","score":149.38},"home":{"owner":"brettLuke","score":109.17},"winner":"trevor"},{"away":{"owner":"schexJeff","score":113.08},"home":{"owner":"johnZach","score":121.82},"winner":"johnZach"},{"away":{"owner":"keyon","score":115.54},"home":{"owner":"quinn","score":167.26},"winner":"quinn"}],"5":[{"away":{"owner":"mitch","score":110.66},"home":{"owner":"daniel","score":99.05},"winner":"mitch"},{"away":{"owner":"james","score":152.76},"home":{"owner":"brettLuke","score":115.82},"winner":"james"},{"away":{"owner":"syedTerence","score":118.9},"home":{"owner":"keyon","score":170.54},"winner":"keyon"},{"away":{"owner":"kociMueller","score":212.42},"home":{"owner":"trevor","score":167.42},"winner":"kociMueller"},{"away":{"owner":"schexJeff","score":148.44},"home":{"owner":"quinn","score":102.05},"winner":"schexJeff"},{"away":{"owner":"patrick","score":113.86},"home":{"owner":"johnZach","score":154.66},"winner":"johnZach"}],"6":[{"away":{"owner":"mitch","score":160.58},"home":{"owner":"trevor","score":181.62},"winner":"trevor"},{"away":{"owner":"james","score":154.74},"home":{"owner":"keyon","score":149.72},"winner":"james"},{"away":{"owner":"syedTerence","score":95.2},"home":{"owner":"schexJeff","score":125.42},"winner":"schexJeff"},{"away":{"owner":"kociMueller","score":164.86},"home":{"owner":"patrick","score":168.41},"winner":"patrick"},{"away":{"owner":"daniel","score":118.4},"home":{"owner":"johnZach","score":116.02},"winner":"daniel"},{"away":{"owner":"brettLuke","score":133.21},"home":{"owner":"quinn","score":174.15},"winner":"quinn"}],"7":[{"away":{"owner":"mitch","score":210.4},"home":{"owner":"james","score":125.26},"winner":"mitch"},{"away":{"owner":"syedTerence","score":93.5},"home":{"owner":"kociMueller","score":169.18},"winner":"kociMueller"},{"away":{"owner":"daniel","score":107.3},"home":{"owner":"keyon","score":189.3},"winner":"keyon"},{"away":{"owner":"trevor","score":145.6},"home":{"owner":"schexJeff","score":147.64},"winner":"schexJeff"},{"away":{"owner":"patrick","score":126.72},"home":{"owner":"quinn","score":152.44},"winner":"quinn"},{"away":{"owner":"brettLuke","score":152.34},"home":{"owner":"johnZach","score":115.52},"winner":"brettLuke"}],"8":[{"away":{"owner":"mitch","score":141.92},"home":{"owner":"kociMueller","score":161.24},"winner":"kociMueller"},{"away":{"owner":"james","score":96.44},"home":{"owner":"syedTerence","score":121.65},"winner":"syedTerence"},{"away":{"owner":"daniel","score":144.18},"home":{"owner":"quinn","score":114.81},"winner":"daniel"},{"away":{"owner":"trevor","score":127.5},"home":{"owner":"johnZach","score":102.88},"winner":"trevor"},{"away":{"owner":"schexJeff","score":123.43},"home":{"owner":"brettLuke","score":154.39},"winner":"brettLuke"},{"away":{"owner":"keyon","score":213.66},"home":{"owner":"patrick","score":141.9},"winner":"keyon"}],"9":[{"away":{"owner":"mitch","score":175.36},"home":{"owner":"quinn","score":111.09},"winner":"mitch"},{"away":{"owner":"james","score":122.44},"home":{"owner":"patrick","score":175.49},"winner":"patrick"},{"away":{"owner":"syedTerence","score":110.45},"home":{"owner":"trevor","score":138.4},"winner":"trevor"},{"away":{"owner":"kociMueller","score":160.32},"home":{"owner":"johnZach","score":110.76},"winner":"kociMueller"},{"away":{"owner":"daniel","score":134.52},"home":{"owner":"schexJeff","score":103.23},"winner":"daniel"},{"away":{"owner":"keyon","score":178.28},"home":{"owner":"brettLuke","score":139.56},"winner":"keyon"}],"10":[{"away":{"owner":"mitch","score":142.51},"home":{"owner":"brettLuke","score":114.06},"winner":"mitch"},{"away":{"owner":"james","score":108.72},"home":{"owner":"daniel","score":86.68},"winner":"james"},{"away":{"owner":"syedTerence","score":157.9},"home":{"owner":"quinn","score":161.28},"winner":"quinn"},{"away":{"owner":"kociMueller","score":131.21},"home":{"owner":"schexJeff","score":112.94},"winner":"kociMueller"},{"away":{"owner":"trevor","score":106.46},"home":{"owner":"patrick","score":141.21},"winner":"patrick"},{"away":{"owner":"keyon","score":185.28},"home":{"owner":"johnZach","score":121.38},"winner":"keyon"}]};

var debug = false;

var owners = {
	brettLuke: { id: 'brettLuke', name: 'Brett/Luke' },
	daniel: { id: 'daniel', name: 'Daniel' },
	james: { id: 'james', name: 'James' },
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

				var awayScore = game.away.score ? game.away.score : generateScore(awayOwner);
				var homeScore = game.home.score ? game.home.score : generateScore(homeOwner);

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
				//else if (r > awayProbability) {
				else if (homeScore > awayScore) {
					awayOwner.losses += 1;
					homeOwner.wins += 1;

					awayOwner.against[homeOwner.id].losses += 1;
					homeOwner.against[awayOwner.id].wins += 1;

					game.home.wins +=1;
				}
				//else {
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
		if (debug) console.log(standings);

		for (var j = 0; j < standings.length; j++) {
			if (j == 0) {
				owners[standings[j].id].decision += 1;
			}

			if (j == 11) {
				owners[standings[j].id].topPick += 1;
			}

			if (j < 4) {
				owners[standings[j].id].in += 1;
			}
			else {
				owners[standings[j].id].out += 1;
			}
		}
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
		owner.out = 0;
		owner.scores = [];
		owner.tiebreaker = 0;
		owner.ties = 0;
		owner.topPick = 0;
		owner.wins = 0;
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

		var sum = 0;

		for (scoreId in owner.scores) {
			sum += owner.scores[scoreId];
		}

		owner.average = sum / games;
	}

	for (ownerId in owners) {
		var owner = owners[ownerId];
		var games = owner.wins + owner.ties + owner.losses;
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

initializeOwners();
simulate(10000);

for (ownerId in owners) {
	var owner = owners[ownerId];
	var inPct = (owner.in / (owner.in + owner.out));

	console.log(owner.name + ': ' + inPct.toFixed(3) + ' (' + owner.decision + ' / ' + owner.topPick + ')');
}

//console.log(schedule);
