const fs = require('fs');
const note = require('../note/lib.js');

it('should work', () => {
	// node index.js 15 Jason Charles 1,3,4,6,5,2 4,1,5,6,2,3
	const games = [
		{
			week: 14,
			away: {
				franchiseId: 10,
				record: {
					allPlay: {
						week: {
							wins: 11
						}
					}
				},
			},
			home: {
				franchiseId: 1,
				record: {
					allPlay: {
						week: {
							wins: 10
						}
					}
				},
			},
			winner: {
				franchiseId: 10,
				name: 'Schex',
				score: 179.76
			}
		}
	];

	const scoringTitles = [
		{
			_id: 'Schex',
			value: 45
		}
	];

	const weekRpos = [
		{
			season: '2023',
			week: 14,
			owner: 'Mitch',
			offerer: 'Patrick',
			selector: 'Jason',
			player: {
				id: '4039',
				name: 'Cooper Kupp'
			},
			selected: true
		},
		{
			season: '2023',
			week: 14,
			owner: 'Keyon',
			offerer: 'Patrick',
			selector: 'Jason',
			player: {
				id: '6943',
				name: 'Gabe Davis'
			},
			selected: false
		},
		{
			season: '2023',
			week: 14,
			owner: 'Keyon',
			offerer: 'Patrick',
			selector: 'Jason',
			player: {
				id: '8112',
				name: 'Drake London'
			},
			selected: true
		},
		{
			season: '2023',
			week: 14,
			owner: 'Patrick',
			offerer: 'Patrick',
			selector: 'Jason',
			player: {
				id: '1689',
				name: 'Adam Thielen'
			},
			selected: true
		},
		{
			season: '2023',
			week: 14,
			owner: 'Patrick',
			offerer: 'Patrick',
			selector: 'Jason',
			player: {
				id: '10225',
				name: 'Jonathan Mingo'
			},
			selected: false
		},
		{
			season: '2023',
			week: 14,
			owner: 'Quinn',
			offerer: 'Patrick',
			selector: 'Jason',
			player: {
				id: '4080',
				name: 'Zay Jones'
			},
			selected: true
		},
		{
			season: '2023',
			week: 14,
			owner: 'Quinn',
			offerer: 'Patrick',
			selector: 'Jason',
			player: {
				id: '7066',
				name: 'K.J. Osborn'
			},
			selected: false
		},
		{
			season: '2023',
			week: 14,
			owner: 'Justin',
			offerer: 'Patrick',
			selector: 'Jason',
			player: {
				id: '9753',
				name: 'Zach Charbonnet'
			},
			selected: true
		},
		{
			season: '2023',
			week: 14,
			owner: 'Justin',
			offerer: 'Patrick',
			selector: 'Jason',
			player: {
				id: '7526',
				name: 'Jaylen Waddle'
			},
			selected: false
		},
		{
			season: '2023',
			week: 14,
			owner: 'Luke',
			offerer: 'Patrick',
			selector: 'Jason',
			player: {
				id: '9500',
				name: 'Josh Downs'
			},
			selected: true
		},
		{
			season: '2023',
			week: 14,
			owner: 'Luke',
			offerer: 'Patrick',
			selector: 'Jason',
			player: {
				id: '5374',
				name: 'Justin Watson'
			},
			selected: false
		},
		{
			season: '2023',
			week: 14,
			owner: 'Mitch',
			offerer: 'Patrick',
			selector: 'Jason',
			player: {
				id: '6801',
				name: 'Tee Higgins'
			},
			selected: false
		},
		{
			season: '2023',
			week: 14,
			owner: 'Schex',
			offerer: 'Jason',
			selector: 'Patrick',
			player: {
				id: '3163',
				name: 'Jared Goff'
			},
			selected: false
		},
		{
			season: '2023',
			week: 14,
			owner: 'Schex',
			offerer: 'Jason',
			selector: 'Patrick',
			player: {
				id: '6011',
				name: 'Gardner Minshew'
			},
			selected: true
		},
		{
			season: '2023',
			week: 14,
			owner: 'Koci/Mueller',
			offerer: 'Jason',
			selector: 'Patrick',
			player: {
				id: '10229',
				name: 'Rashee Rice'
			},
			selected: true
		},
		{
			season: '2023',
			week: 14,
			owner: 'Koci/Mueller',
			offerer: 'Jason',
			selector: 'Patrick',
			player: {
				id: '9997',
				name: 'Zay Flowers'
			},
			selected: false
		},
		{
			season: '2023',
			week: 14,
			owner: 'James/Charles',
			offerer: 'Jason',
			selector: 'Patrick',
			player: {
				id: '9999',
				name: 'Will Levis'
			},
			selected: true
		},
		{
			season: '2023',
			week: 14,
			owner: 'James/Charles',
			offerer: 'Jason',
			selector: 'Patrick',
			player: {
				id: '11292',
				name: 'Tommy DeVito'
			},
			selected: false
		},
		{
			season: '2023',
			week: 14,
			owner: 'Mike',
			offerer: 'Jason',
			selector: 'Patrick',
			player: {
				id: '4217',
				name: 'George Kittle'
			},
			selected: true
		},
		{
			season: '2023',
			week: 14,
			owner: 'Mike',
			offerer: 'Jason',
			selector: 'Patrick',
			player: {
				id: '6783',
				name: 'Jerry Jeudy'
			},
			selected: false
		},
		{
			season: '2023',
			week: 14,
			owner: 'Brett',
			offerer: 'Jason',
			selector: 'Patrick',
			player: {
				id: '8230',
				name: 'Ty Chandler'
			},
			selected: false
		},
		{
			season: '2023',
			week: 14,
			owner: 'Brett',
			offerer: 'Jason',
			selector: 'Patrick',
			player: {
				id: '8134',
				name: 'Khalil Shakir'
			},
			selected: true
		},
		{
			season: '2023',
			week: 14,
			owner: 'Jason',
			offerer: 'Jason',
			selector: 'Patrick',
			player: {
				id: '5086',
				name: 'Marquez Valdes-Scantling'
			},
			selected: true
		},
		{
			season: '2023',
			week: 14,
			owner: 'Jason',
			offerer: 'Jason',
			selector: 'Patrick',
			player: {
				id: '5185',
				name: 'Allen Lazard'
			},
			selected: false
		}
	];

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

	const week = 15;
	const cohost = 'Jason';
	const lastWeekCohost = null
	const lastWeekGamesOrder = [];
	const thisWeekGamesOrder = [];
	const rpoPointsOverrides = {};
	const percentagesData = JSON.parse(fs.readFileSync('./tests/percentages.json', { encoding: 'utf8' }));

	const output = fs.readFileSync('./tests/note.txt', { encoding: 'utf8' });

	const result = note.execute(week, cohost, lastWeekCohost, lastWeekGamesOrder, thisWeekGamesOrder, rpoPointsOverrides, percentagesData, values);

	expect(output).toEqual(result);
});
