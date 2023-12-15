function csvToRpoMap(csv) {
	var lines = csv.split(/\n/)
	lines.shift();

	var map = {};

	lines.forEach(line => {
		var fields = line.replace(/^"/, '').replace(/"$/, '').split(/","/);

		if (fields[4] == 'Status') {
			return;
		}

		var owner = PSO.fantraxAbbreviations[fields[5]];

		if (!map[owner]) {
			map[owner] = [];
		}

		map[owner].push({
			name: fields[1],
			points: parseFloat(fields[10])
		});
	});

	return map;
}

function niceRate(rate) {
	var roundedRate = rate.toFixed(3);

	if (roundedRate[0] == '1') {
		return '1.000';
	}
	else {
		return roundedRate.substring(1);
	}
}

function ordinal(number) {
	if (number % 100 == 11) {
		return number + 'th';
	}

	if (number % 100 == 12) {
		return number + 'th';
	}

	if (number % 100 == 13) {
		return number + 'th';
	}

	if (number % 10 == 1) {
		return number + 'st';
	}

	if (number % 10 == 2) {
		return number + 'nd';
	}

	if (number % 10 == 3) {
		return number + 'rd';
	}

	return number + 'th';
}

function isJaguarGame(franchiseOne, franchiseTwo) {
	var jaguarOwners = ['Keyon', 'Luke', 'Patrick', 'Schex'];

	return jaguarOwners.includes(franchiseOne) && jaguarOwners.includes(franchiseTwo);
}

function printLine(...args) {
	return args.join(' ') + '\n';
}

function execute(season, week, cohost, lastWeekCohost, lastWeekGamesOrder, thisWeekGamesOrder, rpoPointsOverrides, percentagesData, values) {
	var returnNote = '';

	var games = values[0];
	var scoringTitles = values[1];
	var weekRpos = values[2];
	var weekResults = values[3].body;

	var rpoOptions = {};
	var selectedRpos = {};
	var offeredRpos = {};
	var playerPoints = {};
	var rpoSummary = {};

	rpoSummary['Patrick'] = 0;
	rpoSummary[lastWeekCohost] = 0;

	weekResults.forEach((weekResult) => {
		Object.keys(weekResult.players_points).forEach((playerId) => {
			playerPoints[playerId] = weekResult.players_points[playerId] ?? 0.0;
		});
	});

	weekRpos.forEach((rpo) => {
		if (!rpoOptions[rpo.owner]) {
			rpoOptions[rpo.owner] = [];
		}

		rpoOptions[rpo.owner].push(rpo);

		if (rpo.selected) {
			selectedRpos[rpo.owner] = rpo;
		}

		if (!rpo.selected) {
			offeredRpos[rpo.owner] = rpo;
		}

		rpo.player.points = playerPoints[rpo.player.id] ?? rpoPointsOverrides[rpo.player.id];
	});

	if (week > 1 && week < 16 && Object.keys(rpoOptions).length != 12) {
		throw 'We need twelve franchises represented in the RPO data for this week and we only have ' + Object.keys(rpoOptions).length;
	}
	else if (week > 1 && week >= 17 && week < 18 && Object.keys(rpoOptions).length != 4) {
		throw 'We need four franchises represented in the RPO data for this week and we only have ' + Object.keys(rpoOptions).length;
	}

	Object.keys(rpoOptions).forEach(rpoKey => {
		if (rpoOptions[rpoKey].length != 2) {
			throw 'We need two players offered for every franchise and ' + rpoKey + ' only has ' + rpoOptions[rpoKey].length;
		}

		rpoOptions[rpoKey].forEach(rpo => {
			if (rpo.player.points === undefined) {
				throw `We weren't able to get points data for ${rpo.player.name} (${rpo.player.id}). Please use the override parameter like: ${rpo.player.id}=3.45`;
			}
		});
	});

	if (week > 7) {
		Object.keys(percentagesData).forEach(franchiseId => {
			['playoffs', 'decision'].forEach((outcome) => {
				percentagesData[franchiseId][outcome].tripleSlash = niceRate(percentagesData[franchiseId][outcome].neutral.rate) + '/' + niceRate(percentagesData[franchiseId][outcome].withWin.rate) + '/' + niceRate(percentagesData[franchiseId][outcome].withLoss.rate);
			});
		});
	}

	var lastWeek = games.filter(game => game.week == week - 1);
	var thisWeek = games.filter(game => game.week == week);
	var nextWeeks = games.filter(game => game.week >= week && game.week <= week + 2);

	if (!lastWeekGamesOrder) {
		returnNote += printLine('Specify the order in which to include the games last week as a CSV string (e.g. 1,3,5,2,4,6).');

		lastWeek.forEach((lastWeekGame, i) => {
			returnNote += printLine(i + 1, lastWeekGame.away.name, 'vs.', lastWeekGame.home.name);
		});

		process.exit();
	}

	if (!thisWeekGamesOrder) {
		returnNote += printLine('Specify the order in which to include the games this week as a CSV string (e.g. 1,3,5,2,4,6).');

		thisWeek.forEach((thisWeekGame, i) => {
			returnNote += printLine(i + 1, thisWeekGame.away.name, 'vs.', thisWeekGame.home.name);
		});

		process.exit();
	}

	var orderedLastWeek = [];

	lastWeekGamesOrder.forEach((gameId) => {
		orderedLastWeek.push(lastWeek[gameId - 1]);
	});

	lastWeek = orderedLastWeek;

	var orderedThisWeek = [];

	thisWeekGamesOrder.forEach((gameId) => {
		orderedThisWeek.push(thisWeek[gameId - 1]);
	});

	thisWeek = orderedThisWeek;

	if (week > 1) {
		var highScorerAllPlayWins = (week <= 16) ? 11 : 3;
		var highScorerLastWeek = games.filter(game => game.week == (week - 1) && ((game.winner.franchiseId == game.home.franchiseId && game.home.record.allPlay.week.wins == highScorerAllPlayWins) || (game.winner.franchiseId == game.away.franchiseId && game.away.record.allPlay.week.wins == highScorerAllPlayWins)))[0];
		var highScorerSeason = games.filter(game => ((game.winner.franchiseId == highScorerLastWeek.winner.franchiseId && game.home.record.allPlay.week.wins == 11) || (game.winner.franchiseId == highScorerLastWeek.winner.franchiseId && game.away.record.allPlay.week.wins == 11)));
		var highScorerAllTime = scoringTitles.filter(leader => leader._id == highScorerLastWeek.winner.name)[0];
	}

	var introWeek = 'Week ' + week;

	if (week == 16) {
		introWeek = 'the semifinals';
	}
	else if (week == 17) {
		introWeek = 'the championship round';
	}
	else if (week == 18) {
		introWeek = 'the offseason';
	}

	returnNote += printLine('SOUND EFFECTS');
	returnNote += printLine();
	returnNote += printLine('Intro');
	returnNote += printLine("\t" + 'Welcome to the PSO Show for ' + introWeek + ' of the ' + season + ' season!');
	returnNote += printLine("\t" + 'I am Patrick, joined, as always, by ' + (cohost || 'WHO_IS_YOUR_COHOST'));
	returnNote += printLine("\t" + 'BANTER_PROMPT');
	returnNote += printLine();

	if (week > 1) {
		returnNote += printLine('Week ' + (week - 1) + ' Recaps');

		var nextWeeksGamesFor = {};

		nextWeeks.forEach(nextWeeksGame => {
			if (!nextWeeksGamesFor[nextWeeksGame.away.name]) {
				nextWeeksGamesFor[nextWeeksGame.away.name] = [];
			}

			if (!nextWeeksGamesFor[nextWeeksGame.home.name]) {
				nextWeeksGamesFor[nextWeeksGame.home.name] = [];
			}

			nextWeeksGamesFor[nextWeeksGame.away.name].push(nextWeeksGame.home.name);
			nextWeeksGamesFor[nextWeeksGame.home.name].push(nextWeeksGame.away.name);
		});

		lastWeek.forEach((game, n) => {
			var winner;
			var loser;

			if (game.winner.franchiseId == game.home.franchiseId) {
				winner = game.home;
			}
			else if (game.winner.franchiseId == game.away.franchiseId) {
				winner = game.away;
			}

			if (game.loser.franchiseId == game.home.franchiseId) {
				loser = game.home;
			}
			else if (game.loser.franchiseId == game.away.franchiseId) {
				loser = game.away;
			}

			var nextGamesString;

			if (week == 17) {
				nextGamesString = 'CHAMPIONSHIP_OR_THIRD_PLACE_GAME opponent';
			}
			else if (week == 16) {
				nextGamesString = 'Semifinal opponent';
			}
			else if (week == 15) {
				nextGamesString = 'Last game';
			}
			else if (week == 14) {
				nextGamesString = 'Last two';
			}
			else if (week == 13) {
				nextGamesString = 'Last three';
			}
			else if (week <= 12) {
				nextGamesString = 'Next three';
			}

			returnNote += printLine("\t" + winner.name + ' ' + (winner.name.indexOf('/') != -1 ? 'defeat' : 'defeats') + ' ' + loser.name + ', ' + winner.score.toFixed(2) + ' to ' + loser.score.toFixed(2));

			if (isJaguarGame(winner.name, loser.name)) {
				returnNote += printLine("\t\tJAGUAR GAME");
			}

			returnNote += printLine("\t\t" + winner.name);

			returnNote += printLine("\t\t\t" + selectedRpos[winner.name].offerer + ' offered ' + selectedRpos[winner.name].player.name + ' and ' + offeredRpos[winner.name].player.name);
			returnNote += printLine("\t\t\t" + selectedRpos[winner.name].selector + ' selected ' + selectedRpos[winner.name].player.name + ' (' + selectedRpos[winner.name].player.points.toFixed(2) + ')');
			returnNote += printLine("\t\t\t" + selectedRpos[winner.name].offerer + ' received ' + offeredRpos[winner.name].player.name + ' (' + offeredRpos[winner.name].player.points.toFixed(2) + ')');

			returnNote += printLine("\t\t\t" + winner.name + ' to ' + winner.record.straight.cumulative.wins + '-' + winner.record.straight.cumulative.losses + (week > 7 && week < 16 ? ' (' + percentagesData[winner.franchiseId].playoffs.tripleSlash + ')' : ''));
			if (nextWeeksGamesFor[winner.name]) {
				returnNote += printLine("\t\t\t" + nextGamesString + ': ' + nextWeeksGamesFor[winner.name].join(', '));
			}

			returnNote += printLine("\t\t" + loser.name);

			returnNote += printLine("\t\t\t" + selectedRpos[loser.name].offerer + ' offered ' + selectedRpos[loser.name].player.name + ' and ' + offeredRpos[loser.name].player.name);
			returnNote += printLine("\t\t\t" + selectedRpos[loser.name].selector + ' selected ' + selectedRpos[loser.name].player.name + ' (' + selectedRpos[loser.name].player.points.toFixed(2) + ')');
			returnNote += printLine("\t\t\t" + selectedRpos[loser.name].offerer + ' received ' + offeredRpos[loser.name].player.name + ' (' + offeredRpos[loser.name].player.points.toFixed(2) + ')');

			returnNote += printLine("\t\t\t" + loser.name + ' to ' + loser.record.straight.cumulative.wins + '-' + loser.record.straight.cumulative.losses + (week > 7 && week < 16 ? ' (' + percentagesData[loser.franchiseId].playoffs.tripleSlash + ')' : ''));

			if (nextWeeksGamesFor[loser.name]) {
				returnNote += printLine("\t\t\t" + nextGamesString + ': ' + nextWeeksGamesFor[loser.name].join(', '));
			}

			[winner.name, loser.name].forEach((owner) => {
				var optionOne = rpoOptions[owner][0];
				var optionTwo = rpoOptions[owner][1];

				if (optionOne.player.points > optionTwo.player.points) {
					if (optionOne.selected) {
						rpoSummary[optionOne.selector] += 1;
					}
					else {
						rpoSummary[optionOne.offerer] += 1;
					}
				}
				else if (optionTwo.player.points > optionOne.player.points) {
					if (optionTwo.selected) {
						rpoSummary[optionTwo.selector] += 1;
					}
					else {
						rpoSummary[optionTwo.offerer] += 1;
					}
				}
			});

			returnNote += printLine("\t\t" + 'RPO_MATCHUP_SUMMARY: Pat ' + rpoSummary['Patrick'] + ', ' + lastWeekCohost + ' ' + rpoSummary[lastWeekCohost]);
			returnNote += printLine("\t\t" + 'Pat projection: WHICH_TEAM (RIGHTWRONG); ' + (lastWeekCohost || 'LAST_WEEK_COHOST') + ' prediction: WHICH_TEAM (RIGHTWRONG)');
		});

		returnNote += printLine("\t" + 'RPO Stats');
		returnNote += printLine("\t\t" + 'OVERALL_SCORE');
		returnNote += printLine("\t\t" + 'Selector');
		returnNote += printLine("\t\t\t" + 'This week');
		returnNote += printLine("\t\t\t\t" + 'Pat: MY_RPO_RECORD_THIS_WEEK');
		returnNote += printLine("\t\t\t\t" + (lastWeekCohost || 'LAST_WEEK_COHOST') + ': ' + (lastWeekCohost ? lastWeekCohost.toUpperCase() : 'LAST_WEEK_COHOST') + '_RPO_RECORD_THIS_WEEK');
		returnNote += printLine("\t\t\t\t" + 'Total: TOTAL_RPO_RECORD_THIS_WEEK');
		returnNote += printLine("\t\t\t" + 'Overall');
		returnNote += printLine("\t\t\t\t" + 'Pat: MY_OVERALL_RPO_RECORD');
		returnNote += printLine("\t\t\t\t" + 'The World: ' + 'THE_WORLD_OVERALL_RPO_RECORD');
		returnNote += printLine("\t\t\t\t" + 'Total: TOTAL_OVERALL_RPO_RECORD');
		returnNote += printLine("\t" + 'Prognostication Stats');
		returnNote += printLine("\t\t" + 'Pat\'s projections');
		returnNote += printLine("\t\t\t" + 'This week: PATS_PROJECTIONS_RECORD_THIS_WEEK');
		returnNote += printLine("\t\t\t" + 'Overall: PATS_PROJECTIONS_OVERALL_RECORD');
		returnNote += printLine("\t\t" + 'The World\'s predictions');
		returnNote += printLine("\t\t\t" + 'This week: WORLD_PREDICTIONS_RECORD_THIS_WEEK');
		returnNote += printLine("\t\t\t" + 'Overall: WORLD_PREDICTIONS_OVERALL_RECORD');
		returnNote += printLine();
	}

	returnNote += printLine('Transactions');
	returnNote += printLine();

	returnNote += printLine('Discussion Topic: IS_THERE_ONE');
	returnNote += printLine();

	var previewWeek = 'Week ' + week;

	if (week == 16) {
		previewWeek = 'the Semifinals';
	}
	else if (week == 17) {
		previewWeek = 'the Championship Round';
	}

	if (week < 18) {
		returnNote += printLine('Game Previews and Risky Player Options for ' + previewWeek);

		thisWeek.forEach(game => {
			var away = game.away;
			var home = game.home;

			if (week == 1) {
				returnNote += printLine("\t" + away.name + ' vs. ' + home.name);
			}
			else {
				var lastWeekAway = lastWeek.filter(lastWeekGame => away.franchiseId == lastWeekGame.away.franchiseId || away.franchiseId == lastWeekGame.home.franchiseId)[0];
				var lastWeekHome = lastWeek.filter(lastWeekGame => home.franchiseId == lastWeekGame.away.franchiseId || home.franchiseId == lastWeekGame.home.franchiseId)[0];

				var awayRecordId;
				var homeRecordId;

				if (away.franchiseId == lastWeekAway.away.franchiseId) {
					awayRecordId = 'away';
				}
				else if (away.franchiseId == lastWeekAway.home.franchiseId) {
					awayRecordId = 'home';
				}
			
				if (home.franchiseId == lastWeekHome.away.franchiseId) {
					homeRecordId = 'away';
				}
				else if (home.franchiseId == lastWeekHome.home.franchiseId) {
					homeRecordId = 'home';
				}
			
				away.record = {
					straight: {
						cumulative: {
							wins: lastWeekAway[awayRecordId].record.straight.cumulative.wins,
							losses: lastWeekAway[awayRecordId].record.straight.cumulative.losses
						}
					}
				};

				home.record = {
					straight: {
						cumulative: {
							wins: lastWeekHome[homeRecordId].record.straight.cumulative.wins,
							losses: lastWeekHome[homeRecordId].record.straight.cumulative.losses
						}
					}
				};

				if (week > 7 && week < 16) {
					returnNote += printLine("\t" + away.name + ' (' + away.record.straight.cumulative.wins + '-' + away.record.straight.cumulative.losses + ', ' + percentagesData[away.franchiseId].playoffs.tripleSlash + ', ' + Math.round(percentagesData[away.franchiseId].results[week].rate * 100) + '%) vs. ' + home.name + ' (' + home.record.straight.cumulative.wins + '-' + home.record.straight.cumulative.losses + ', ' + percentagesData[home.franchiseId].playoffs.tripleSlash + ', ' + Math.round(percentagesData[home.franchiseId].results[week].rate * 100) + '%)');
				}
				else {
					returnNote += printLine("\t" + away.name + ' (' + away.record.straight.cumulative.wins + '-' + away.record.straight.cumulative.losses + ') vs. ' + home.name + ' (' + home.record.straight.cumulative.wins + '-' + home.record.straight.cumulative.losses + ')');
				}
			}

			if (isJaguarGame(away.name, home.name)) {
				returnNote += printLine("\t\tJAGUAR GAME");
			}

			if (week > 7 && week < 16) {
				returnNote += printLine("\t\t" + 'Playoff interest level: ' + (percentagesData[away.franchiseId].playoffs.interestLevel + percentagesData[home.franchiseId].playoffs.interestLevel).toFixed(3));
				returnNote += printLine("\t\t" + 'Decision interest level: ' + (percentagesData[away.franchiseId].decision.interestLevel + percentagesData[home.franchiseId].decision.interestLevel).toFixed(3));
			}

			returnNote += printLine("\t\t" + 'NOTE_ABOUT_' + away.name.toUpperCase().replace(/\//, ''));
			returnNote += printLine("\t\t" + 'NOTE_ABOUT_' + home.name.toUpperCase().replace(/\//, ''));
			returnNote += printLine("\t\t" + 'HOST_1 takes ' + away.name);
			returnNote += printLine("\t\t" + 'HOST_2 takes ' + home.name);
			returnNote += printLine("\t\t" + 'Pat projection: PAT_PROJECTION');
			returnNote += printLine("\t\t" + (cohost || 'COHOST') + ' prediction');
		});

		returnNote += printLine();
	}

	if (week > 1) {
		returnNote += printLine('High Scorer\'s Corner: ' + highScorerLastWeek.winner.name);
		returnNote += printLine("\tAPPLAUSE")
		returnNote += printLine("\t" + highScorerLastWeek.winner.name + ' scored ' + highScorerLastWeek.winner.score.toFixed(2));
		returnNote += printLine("\t" + ordinal(highScorerSeason.length) + ' scoring title this season');
		returnNote += printLine("\t" + ordinal(highScorerAllTime.value) + ' scoring title all-time (WHAT_RANK overall)');
		returnNote += printLine("\t" + 'HIGH_SCORERS_CORNER_DITTY');
		returnNote += printLine();
	}

	returnNote += printLine('Co-Host\'s Final Thoughts');
	returnNote += printLine();

	var outroWeek = 'Week ' + week;

	if (week == 16) {
		outroWeek = 'the semifinals';
	}
	else if (week == 17) {
		outroWeek = 'the championship round';
	}
	else if (week == 18) {
		outroWeek = 'the offseason';
	}

	var outroNextWeek = (week != 18) ? 'next week' : 'very soon';

	returnNote += printLine('Plugs');
	returnNote += printLine("\t" + 'Thanks for sending in RPOs');
	returnNote += printLine("\t" + 'Slash Scuttlebot');
	returnNote += printLine("\t" + 'Websites');
	returnNote += printLine("\t" + 'For ' + (cohost || 'COHOST') + ', I am Patrick. Good luck with your fantasy in ' + outroWeek + '! We will talk to you ' + outroNextWeek + '!');

	return returnNote;
}

module.exports.execute = execute;
