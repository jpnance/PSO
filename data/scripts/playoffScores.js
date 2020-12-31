/*
	This is a quick way to sum up each playoff team's total postseason scoring output.
*/

var playoffScores = [];

var games = db.games.find({ "type": { "$in": [ "semifinal", "thirdPlace", "championship" ] } });

games.forEach((game) => {
	playoffScores.push({
		season: game.season,
		owner: game.away.name,
		score: game.away.score
	});

	playoffScores.push({
		season: game.season,
		owner: game.home.name,
		score: game.home.score
	});
});

var reducedGames = [];

playoffScores.forEach((playoffScore) => {
	var existingGame = reducedGames.find((game) => game.season == playoffScore.season && game.owner == playoffScore.owner);

	if (!existingGame) {
		existingGame = { season: playoffScore.season, owner: playoffScore.owner, score: 0.0 };
		reducedGames.push(existingGame);
	}

	existingGame.score += playoffScore.score / (playoffScore.season < 2012 ? 10 : 1);
});

printjson(reducedGames.sort((a, b) => {
	return a.score - b.score;
}));
