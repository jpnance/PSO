/*
	A silly script that figures out which regimes have lost at the hands of that week's scoring title winner most often.
*/

load('regimes.js');

var scoringTitleVictims = {};
var scoringTitleGames = db.games.find({
	'type': 'regular',
	'$or': [
		{ 'home.record.allPlay.week.losses': 0 },
		{ 'away.record.allPlay.week.losses': 0 }
	]
});

scoringTitleGames.forEach((game) => {
	var losingRegime = regimes[game.loser.name] || game.loser.name;

	if (!scoringTitleVictims[losingRegime]) {
		scoringTitleVictims[losingRegime] = 0;
	}

	scoringTitleVictims[losingRegime] += 1;
})

var sortedVictims = [];

Object.keys(scoringTitleVictims).forEach((victimKey) => {
	sortedVictims.push({ regime: victimKey, losses: scoringTitleVictims[victimKey] });
});

sortedVictims.sort((a, b) => -1 * (a.losses - b.losses));

sortedVictims.forEach((victim) => {
	print(victim.regime, victim.losses);
});
