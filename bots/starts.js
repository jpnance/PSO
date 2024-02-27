var dotenv = require('dotenv').config({ path: '/app/.env' });

var request = require('superagent');

var botConfig = JSON.parse(process.env.BOMBBOT);

var fantraxFranchises = {
  'nsx8zayeln93iz65': 'Jason/Chad',
  'ie4yo37fln93iz65': 'Mike',
  'deik5s4hln93iz65': 'Luke',
  'skqkdmjtln93iz65': 'Syed/Koci',
  'dzh56gy0ln93iz65': 'Joel',
  '5nd997rpln93iz65': 'Mitch',
  'si0jgtholn93iz65': 'Charles',
  'r89rvfs3ln93iz65': 'Patrick',
  'qlt4z8y8ln93iz65': 'Justin',
  'rvds592lln93iz65': 'Paul',
  'pufmdy4oln93iz65': 'Schex/Kevin',
  '007t5510ln93iz65': 'James',
};

var groupMePost = function(post) {
	request
		.post('https://api.groupme.com/v3/bots/post')
		.send({ bot_id: botConfig['groupmeToken'], text: post })
		.then(response => {
			console.log(post);
		})
		.catch(error => {
			console.log(error);
		});
};

var newFantraxPromise = function(fantraxId) {
  var msgs = [
    {
      data: {
        period: 18
      },
      method: 'getLiveScoringStats'
    },
    {
      data: {},
      method: 'getScoresSummaryData'
    }
  ];

	return new Promise(function(resolve, reject) {
		request
			.post('https://www.fantrax.com/fxpa/req?leagueId=g7xcurksln93iz5v')
			.set('Content-Type', 'text/plain')
			.send(JSON.stringify({ msgs }))
			.then(response => {
				var dataJson = JSON.parse(response.text);
        var startsData = [];

        Object.entries(dataJson.responses[0].data.statsPerTeam.allTeamsStats).forEach(([teamId, stats]) => {
          var [played, inProgress, scheduled, minutes, unknown] = stats.ACTIVE.playerGameInfo;

          startsData.push({
            teamId,
            franchise: fantraxFranchises[teamId],
            played,
            inProgress,
            scheduled
          });
        });

				resolve({ startsData });
			});
		}
	);
};

var formatStartsData = function(startsData) {
  const headerLines = [
    'Starts Update for Current Matchup',
    ''
  ];

  const startsLines =
    startsData
      .sort(byTotalStarts)
      .map(formatFranchiseStartData)

  return headerLines.concat(startsLines).join('\n');
}

var byFranchiseName = function(a, b) {
  return a.franchise.localeCompare(b.franchise);
}

var formatFranchiseStartData = function(franchiseStartData) {
  var { franchise, played, inProgress, scheduled } = franchiseStartData;

  return `${franchise}: ${played} used, ${scheduled} scheduled, ${played + scheduled} total`;
}

var byTotalStarts = function(a, b) {
  return (b.played + b.scheduled) - (a.played + a.scheduled);
}

newFantraxPromise().then(({ startsData }) => {
  groupMePost(formatStartsData(startsData));
});

