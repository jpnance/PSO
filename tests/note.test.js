const fs = require('fs');
const note = require('../note/lib.js');

function readAsJson(filename) {
	return JSON.parse(fs.readFileSync(filename, { encoding: 'utf8' }));
}

it('should work', () => {
	// node index.js 15 Charles Jason 1,3,4,6,5,2 4,1,5,6,2,3
	const games = readAsJson('./tests/games.json');
	const scoringTitles = readAsJson('./tests/scoring-titles.json');
	const weekRpos = readAsJson('./tests/week-rpos.json');

	const weekResults = {
		body: [
			{
				players_points: {
				  '4039': 17.5,
				  '6943': 0,
				  '8112': 19.2,
				  '1689': 7.4,
				  '10225': 2.2,
				  '4080': 3.9,
				  '7066': 1.5,
				  '9753': 4.8,
				  '7526': 7.9,
				  '9500': 3.2,
				  '5374': 1.8,
				  '6801': 7.2,
				  '3163': 0.44,
				  '6011': 11.1,
				  '10229': 11.2,
				  '9997': 14,
				  '9999': 15.58,
				  '11292': 17.42,
				  '4217': 13.6,
				  '6783': 1.6,
				  '8230': 4.2,
				  '8134': 1.2,
				  '5086': 2.2,
				  '5185': 0
				}
			}
		]
	};

	const values = [
		games,
		scoringTitles,
		weekRpos,
		weekResults
	];

	const season = 2023;
	const week = 15;
	const cohost = 'Charles';
	const lastWeekCohost = 'Jason';
	const lastWeekGamesOrder = [1, 3, 4, 6, 5, 2];
	const thisWeekGamesOrder = [4, 1, 5, 6, 2, 3];
	const rpoPointsOverrides = {};
	const percentagesData = readAsJson('./tests/percentages.json');

	const output = fs.readFileSync('./tests/note.txt', { encoding: 'utf8' });

	const result = note.execute(season, week, cohost, lastWeekCohost, lastWeekGamesOrder, thisWeekGamesOrder, rpoPointsOverrides, percentagesData, values);

	expect(output).toEqual(result);
});
