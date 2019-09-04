var dotenv = require('dotenv').config();

var request = require('superagent');

var template = [
	[ [1, 2], [3, 4], [5, 8], [6, 7], [9, 12], [10, 11] ],
	[ [1, 8], [2, 7], [3, 11], [4, 12], [5, 6], [9, 10] ],
	[ [1, 11], [2, 12], [3, 5], [4, 10], [6, 8], [7, 9] ],
	[ [1, 4], [2, 3], [5, 12], [6, 11], [7, 10], [8, 9] ],
	[ [1, 10], [2, 5], [3, 12], [4, 7], [6, 9], [8, 11] ],
	[ [1, 7], [2, 6], [3, 9], [4, 8], [5, 10], [11, 12] ],
	[ [1, 3], [2, 4], [5, 9], [6, 10], [7, 11], [8, 12] ],
	[ [1, 2], [3, 4], [5, 8], [6, 7], [9, 12], [10, 11] ],
	[ [1, 6], [2, 8], [3, 7], [4, 9], [5, 11], [10, 12] ],
	[ [1, 9], [2, 11], [3, 10], [4, 5], [6, 12], [7, 8] ],
	[ [1, 4], [2, 3], [5, 12], [6, 11], [7, 10], [8, 9] ],
	[ [1, 12], [2, 9], [3, 6], [4, 11], [5, 7], [8, 10] ],
	[ [1, 5], [2, 10], [3, 8], [4, 6], [7, 12], [9, 11] ],
	[ [1, 3], [2, 4], [5, 9], [6, 10], [7, 11], [8, 12] ]
];

var pods = {
	red: [2, 3, 5, 11],
	green: [4, 9, 10, 12],
	blue: [1, 6, 7, 8]
};

var teamIds = ['--', pods.red[0], pods.red[1], pods.red[2], pods.red[3], pods.green[0], pods.blue[0], pods.blue[1], pods.green[1], pods.green[2], pods.blue[2], pods.blue[3], pods.green[3]];
var params = [];

template.forEach(function(games, week) {
	games.forEach(function(matchup, game) {
		var id = params.length;

		params.push({
			id: id,
			matchupPeriodId: week + 1,
			away: { teamId: teamIds[matchup[0]] },
			home: { teamId: teamIds[matchup[1]] }
		});
	});
});

console.log(params);

request
	.post('https://fantasy.espn.com/apis/v3/games/ffl/seasons/2019/segments/0/leagues/122885/schedule')
	.set('Content-Type', 'application/json')
	.set('Cookie', 'espn_s2=' + process.env.ESPN_S2_COOKIE + ';SWID=' + process.env.SWID_COOKIE)
	.send(JSON.stringify(params))
	.then(res => {
		console.log('good');
	})
	.catch(error => {
		console.log(error);
	});

