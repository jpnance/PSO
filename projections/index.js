var dotenv = require('dotenv').config({ path: '/app/.env' });

var fs = require('fs');
var request = require('superagent');

var PSO = require('../pso.js');

process.argv.forEach(function(value, index, array) {
	if (index > 1) {
		var pair = value.split(/=/);

		switch (pair[0]) {
			case 'site':
				parameters.site = pair[1];
				break;
		}
	}
});

var newByeWeeksPromise = function() {
	return new Promise(function(resolve, reject) {
		request
			.get('https://api.sleeper.com/schedule/nfl/regular/' + process.env.SEASON)
			.then((response) => {
				var nflGames = response.body;
				var teams = [];
				var teamWeeks = [];
				var byeWeeks = {};

				nflGames.forEach((nflGame) => {
					// don't bother with home teams
					if (!teams.includes(nflGame.away)) {
						teams.push(nflGame.away);
					}

					if (!teamWeeks.find((teamWeek) => teamWeek.week == nflGame.week)) {
						teamWeeks.push({ week: nflGame.week, teams: [] });
					}

					var teamWeek = teamWeeks.find((teamWeek) => teamWeek.week == nflGame.week);

					teamWeek.teams.push(nflGame.away);
					teamWeek.teams.push(nflGame.home);
				});

				teams.forEach((team) => {
					var teamByeWeek = teamWeeks.find((teamWeek) => !teamWeek.teams.includes(team));

					byeWeeks[team] = teamByeWeek.week;
				});

				resolve(byeWeeks);
			});
	});
};

var newSleeperPlayersPromise = function(byeWeeks) {
	return new Promise(function(resolve, reject) {
		var sleeperPlayers = require('../public/data/sleeper-data.json');

		Object.keys(sleeperPlayers).forEach((sleeperPlayerId) => {
			var sleeperPlayer = sleeperPlayers[sleeperPlayerId];

			sleeperPlayer.bye_week = byeWeeks[sleeperPlayer.team] || null;
		});

		resolve(sleeperPlayers);
	});
};

var newProjectionsPromise = function(sleeperPlayers) {
	return new Promise(function(resolve, reject) {
		fs.readFile('../public/data/sleeper-projections.csv', function(error, data) {
				var csvLines = data.toString();

				csvLines.split(/\n/).forEach((csvLine, i) => {
					if (i == 0) {
						return;
					}

					// player_id, first_name, last_name, team, position, years_exp, adp_dynasty_2qb, adp_idp, pass_yd, pass_td, pass_int, pass_2pt, rush_yd, rush_td, rec_yd, rec_td, fum_lost, idp_tkl_solo, idp_tkl_ast, idp_sack, idp_int, idp_ff, idp_fum_rec, pass_int_td, pso_pts
					var fields = csvLine.split(/,/);

					if (sleeperPlayers[fields[0]]) {
						sleeperPlayers[fields[0]].fpts = parseFloat(fields[24]) || 0;
					}
				});

				resolve(sleeperPlayers);
			});
		}
	)
};

var newPsoPlayersPromise = function(sleeperPlayers) {
	return new Promise(function(resolve, reject) {
		var psoPlayers = require('../public/data/players.json');

		psoPlayers.forEach((psoPlayer) => {
			psoPlayer.fpts = 0;

			if (psoPlayer.id) {
				psoPlayer.fpts = sleeperPlayers[psoPlayer.id].fpts;
				psoPlayer.bye_week = sleeperPlayers[psoPlayer.id].bye_week;
			}
		});

		resolve(psoPlayers);
	});
};


var pointsForOwnerWeek = function(players, owner, week) {
	var rosterSpots = [
		{ fillWith: ['QB'], default: 8 },
		{ fillWith: ['RB'], default: 4 },
		{ fillWith: ['RB'], default: 4 },
		{ fillWith: ['WR'], default: 5 },
		{ fillWith: ['WR'], default: 5 },
		{ fillWith: ['TE'], default: 3 },
		{ fillWith: ['WR', 'TE'], default: 5 },
		{ fillWith: ['RB', 'WR'], default: 5 },
		{ fillWith: ['QB', 'RB', 'WR', 'TE'], default: 8 },
		{ fillWith: ['DL'], default: 4 },
		{ fillWith: ['LB'], default: 5 },
		{ fillWith: ['DB'], default: 4 },
		{ fillWith: ['DL', 'LB', 'DB'], default: 5 },
		{ fillWith: ['DL', 'LB', 'DB'], default: 5 },
		{ fillWith: ['K'], default: 7 }
	];

	var ownerPlayers = players.filter((player) => player.owner == owner && player.bye_week != week);
	var weekTotal = 0;

	ownerPlayers.forEach((player) => {
		rosterSpots.every((rosterSpot) => {
			if (!rosterSpot.filled && player.positions.some((position) => rosterSpot.fillWith.includes(position))) {
				rosterSpot.filled = true;
				weekTotal += (player.fpts / 17) || rosterSpot.default;
				return false;
			}

			return true;
		});
	});

	rosterSpots.forEach(rosterSpot => {
		if (!rosterSpot.filled) {
			weekTotal += rosterSpot.default;
		}
	});

	return weekTotal;
};

newByeWeeksPromise()
	.then(newSleeperPlayersPromise)
	.then(newProjectionsPromise)
	.then(newPsoPlayersPromise)
	.then((players) => {
		players.sort((a, b) => {
			if (a.fpts > b.fpts) {
				return -1;
			}
			else if (a.fpts < b.fpts) {
				return 1;
			}
			else {
				return 0;
			}
		});

		var schedule = require('../public/data/schedule.json');

		for (var week = 1; week <= 15; week++) {
			schedule[week] = schedule[week].map((matchup) => matchup.map((franchise) => ({
				...franchise,
				points: Math.round(pointsForOwnerWeek(players, franchise.name, week))
			})));
		}

		var franchiseResults = {};

		Object.values(PSO.franchises).forEach((name) => {
			Object.values(schedule)
				.flat()
				.filter((matchup) => matchup.find((franchise) => franchise.name === name))
				.forEach((game, i) => {
					var franchise = game.find((franchise) => franchise.name === name);
					var opponent = game.find((franchise) => franchise.name !== name);

					if (!franchiseResults[franchise.name]) {
						franchiseResults[franchise.name] = {};
					}

					if (!franchiseResults[opponent.name]) {
						franchiseResults[opponent.name] = {};
					}

					if (franchiseResults[franchise.name][i] && franchiseResults[opponent.name][i]) {
						return;
					}

					if (franchise.points > opponent.points + 5) {
						franchiseResults[franchise.name][i] = 'W';
						franchiseResults[opponent.name][i] = 'L';
					}
					else if (franchise.points + 5 < opponent.points) {
						franchiseResults[franchise.name][i] = 'L';
						franchiseResults[opponent.name][i] = 'W';
					}
					else {
						if (Math.random() > 0.5) {
							franchiseResults[franchise.name][i] = 'Wc';
							franchiseResults[opponent.name][i] = 'Lc';
						}
						else {
							franchiseResults[franchise.name][i] = 'Lc';
							franchiseResults[opponent.name][i] = 'Wc';
						}
					}
				});
		});

		Object.keys(franchiseResults).forEach((name) => {
			var results = Object.values(franchiseResults[name]);

			console.log([ name, ...results ].join(','));
		});
	});


/*
newPlayersPromise().then(players => {
	for (var week = 1; week <= 15; week++) {

		Object.keys(owners).forEach(owner => {
			console.log(owners[owner], Math.round(pointsForOwnerWeek(players, owner, week)));
		});

		console.log();
	}
});
*/
