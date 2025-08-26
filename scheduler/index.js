var dotenv = require('dotenv').config({ path: '/app/.env' });

var request = require('superagent');

var PSO = require('../pso.js');

var template = [
	[ [1, 2], [3, 4], [5, 8], [6, 7], [9, 12], [10, 11] ], // pod
	[ [1, 8], [2, 7], [3, 11], [4, 12], [5, 6], [9, 10] ],
	[ [1, 11], [2, 12], [3, 5], [4, 10], [6, 8], [7, 9] ],
	[ [1, 4], [2, 3], [5, 12], [6, 11], [7, 10], [8, 9] ], // pod
	[ [1, 10], [2, 5], [3, 12], [4, 7], [6, 9], [8, 11] ], // the good stuff
	[ [1, 7], [2, 6], [3, 9], [4, 8], [5, 10], [11, 12] ],
	[ [1, 3], [2, 4], [5, 9], [6, 10], [7, 11], [8, 12] ], // pod
	[ [1, 9], [2, 11], [3, 10], [4, 5], [6, 12], [7, 8] ],
	[ [1, 2], [3, 4], [5, 8], [6, 7], [9, 12], [10, 11] ], // pod
	[ [1, 6], [2, 8], [3, 7], [4, 9], [5, 11], [10, 12] ],
	[ [1, 10], [2, 5], [3, 12], [4, 7], [6, 9], [8, 11] ], // the good stuff
	[ [1, 4], [2, 3], [5, 12], [6, 11], [7, 10], [8, 9] ], // pod
	[ [1, 12], [2, 9], [3, 6], [4, 11], [5, 7], [8, 10] ],
	[ [1, 5], [2, 10], [3, 8], [4, 6], [7, 12], [9, 11] ],
	[ [1, 3], [2, 4], [5, 9], [6, 10], [7, 11], [8, 12] ] // pod
];

var pods = {
	red: [PSO.franchiseIds['Schexes'], PSO.franchiseIds['Keyon'], PSO.franchiseIds['Quinn'], PSO.franchiseIds['Patrick']],
	green: [PSO.franchiseIds['Mitch'], PSO.franchiseIds['Koci/Mueller'], PSO.franchiseIds['Anthony'], PSO.franchiseIds['Luke']],
	blue: [PSO.franchiseIds['Brett'], PSO.franchiseIds['Jason'], PSO.franchiseIds['Mike'], PSO.franchiseIds['Justin']]
};

var teamIds = ['--', pods.red[0], pods.red[1], pods.red[2], pods.red[3], pods.green[0], pods.blue[0], pods.blue[1], pods.green[1], pods.green[2], pods.blue[2], pods.blue[3], pods.green[3]];
var params = [];

template.forEach(function(games, week) {
	console.log('Week', week + 1);

	games.forEach(function(matchup, game) {
		console.log(PSO.franchises[teamIds[matchup[0]]], 'vs.', PSO.franchises[teamIds[matchup[1]]]);
	});

	console.log();
});
