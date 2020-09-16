var dotenv = require('dotenv').config({ path: '../.env' });

var request = require('superagent');

var fantraxIds = {
	'motju5wmk7xr9dlz': 1, // Patrick
	'6u9bwy3ik7xrer9z': 2, // Koci/Mueller
	'hfyfddwck7xrera2': 3, // Syed/Kuan
	'hgfqy84rk7xrera0': 4, // John/Zach
	'alzk1h56k7xrer9w': 5, // Trevor
	'134ej04vk7xrer9y': 6, // Keyon
	'n5ozy8wjk7xrer9m': 7, // Brett/Luke
	'fzqz34xuk7xrer9p': 8, // Terence
	'erk30j3lk7xrer9s': 9, // James/Charles
	'bmj6dbebk7xrer9v': 10, // Schex
	'a1p22t32k7xrer9u': 11, // Quinn
	'vt5py28ck7xrer9r': 12 // Mitch
};

var sheetsBudgetCells = {
	'n5ozy8wjk7xrer9m': 'R7C3', // Brett/Luke
	'erk30j3lk7xrer9s': 'R7C4', // James/Charles
	'hgfqy84rk7xrera0': 'R7C5', // John/Zach
	'134ej04vk7xrer9y': 'R7C6', // Keyon
	'6u9bwy3ik7xrer9z': 'R7C7', // Koci/Mueller
	'vt5py28ck7xrer9r': 'R7C8', // Mitch
	'motju5wmk7xr9dlz': 'R7C9', // Patrick
	'a1p22t32k7xrer9u': 'R7C10', // Quinn
	'bmj6dbebk7xrer9v': 'R7C11', // Schex
	'hfyfddwck7xrera2': 'R7C12', // Syed/Kuan
	'fzqz34xuk7xrer9p': 'R7C13', // Terence
	'alzk1h56k7xrer9w': 'R7C14' // Trevor
};

var franchiseNames = {
	1: {
		2008: 'Patrick',
		2009: 'Patrick',
		2010: 'Patrick',
		2011: 'Patrick',
		2012: 'Pat/Quinn',
		2013: 'Pat/Quinn',
		2014: 'Patrick',
		2015: 'Patrick',
		2016: 'Patrick',
		2017: 'Patrick',
		2018: 'Patrick',
		2019: 'Patrick',
		2020: 'Patrick'
	},
	2: {
		2008: 'Koci',
		2009: 'Koci',
		2010: 'Koci',
		2011: 'Koci',
		2012: 'Koci',
		2013: 'Koci/Mueller',
		2014: 'Koci/Mueller',
		2015: 'Koci/Mueller',
		2016: 'Koci/Mueller',
		2017: 'Koci/Mueller',
		2018: 'Koci/Mueller',
		2019: 'Koci/Mueller',
		2020: 'Koci/Mueller'
	},
	3: {
		2008: 'Syed',
		2009: 'Syed',
		2010: 'Syed',
		2011: 'Syed',
		2012: 'Syed',
		2013: 'Syed',
		2014: 'Syed',
		2015: 'Syed/Terence',
		2016: 'Syed/Terence',
		2017: 'Syed/Terence',
		2018: 'Syed/Terence',
		2019: 'Syed/Kuan',
		2020: 'Syed/Kuan'
	},
	4: {
		2008: 'John',
		2009: 'John',
		2010: 'John',
		2011: 'John',
		2012: 'John',
		2013: 'John',
		2014: 'John/Zach',
		2015: 'John/Zach',
		2016: 'John/Zach',
		2017: 'John/Zach',
		2018: 'John/Zach',
		2019: 'John/Zach',
		2020: 'John/Zach'
	},
	5: {
		2008: 'Trevor',
		2009: 'Trevor',
		2010: 'Trevor',
		2011: 'Trevor',
		2012: 'Trevor',
		2013: 'Trevor',
		2014: 'Trevor',
		2015: 'Trevor',
		2016: 'Trevor',
		2017: 'Trevor',
		2018: 'Trevor',
		2019: 'Trevor',
		2020: 'Trevor'
	},
	6: {
		2008: 'Keyon',
		2009: 'Keyon',
		2010: 'Keyon',
		2011: 'Keyon',
		2012: 'Keyon',
		2013: 'Keyon',
		2014: 'Keyon',
		2015: 'Keyon',
		2016: 'Keyon',
		2017: 'Keyon',
		2018: 'Keyon',
		2019: 'Keyon',
		2020: 'Keyon'
	},
	7: {
		2008: 'Jeff',
		2009: 'Jake/Luke',
		2010: 'Jake/Luke',
		2011: 'Jake/Luke',
		2012: 'Jake/Luke',
		2013: 'Jake/Luke',
		2014: 'Brett/Luke',
		2015: 'Brett/Luke',
		2016: 'Brett/Luke',
		2017: 'Brett/Luke',
		2018: 'Brett/Luke',
		2019: 'Brett/Luke',
		2020: 'Brett/Luke'
	},
	8: {
		2008: 'Daniel',
		2009: 'Daniel',
		2010: 'Daniel',
		2011: 'Daniel',
		2012: 'Daniel',
		2013: 'Daniel',
		2014: 'Daniel',
		2015: 'Daniel',
		2016: 'Daniel',
		2017: 'Daniel',
		2018: 'Daniel',
		2019: 'Terence',
		2020: 'Terence'
	},
	9: {
		2008: 'James',
		2009: 'James',
		2010: 'James',
		2011: 'James',
		2012: 'James',
		2013: 'James',
		2014: 'James',
		2015: 'James',
		2016: 'James',
		2017: 'James/Charles',
		2018: 'James/Charles',
		2019: 'James/Charles',
		2020: 'James/Charles'
	},
	10: {
		2008: 'Schexes',
		2009: 'Schexes',
		2010: 'Schexes',
		2011: 'Schexes',
		2012: 'Schex',
		2013: 'Schex',
		2014: 'Schex',
		2015: 'Schex/Jeff',
		2016: 'Schex/Jeff',
		2017: 'Schex/Jeff',
		2018: 'Schex',
		2019: 'Schex',
		2020: 'Schex'
	},
	11: {
		2012: 'Charles',
		2013: 'Charles',
		2014: 'Quinn',
		2015: 'Quinn',
		2016: 'Quinn',
		2017: 'Quinn',
		2018: 'Quinn',
		2019: 'Quinn',
		2020: 'Quinn'
	},
	12: {
		2012: 'Mitch',
		2013: 'Mitch',
		2014: 'Mitch',
		2015: 'Mitch',
		2016: 'Mitch',
		2017: 'Mitch',
		2018: 'Mitch',
		2019: 'Mitch',
		2020: 'Mitch'
	}
};

var newFantraxPromise = function(fantraxId) {
	return new Promise(function(resolve, reject) {
		request
			.post('https://www.fantrax.com/fxpa/req?leagueId=eju35f9ok7xr9cvt')
			.set('Content-Type', 'text/plain')
			.send(JSON.stringify({ msgs: [ { data: { leagueId: 'eju35f9ok7xr9cvt', teamId: fantraxId, view: 'STATS' }, method: 'getTeamRosterInfo' } ] }))
			.then(response => {
				//console.log(response.text);
				var dataJson = JSON.parse(response.text);
				var rawBudget = dataJson.responses[0].data.miscData.salaryInfo.info[1].value;
				var cleanBudget = parseFloat(rawBudget.replace(/,/, ''));

				resolve({ fantraxId: fantraxId, fantraxBudget: cleanBudget });
			});
		}
	)
};

var newSheetsPromise = function(fantraxId) {
	return new Promise(function(resolve, reject) {
		request
			.get('https://spreadsheets.google.com/feeds/cells/1nas3AqWZtCu_UZIV77Jgxd9oriF1NQjzSjFWW86eong/1/public/full/' + sheetsBudgetCells[fantraxId] + '?alt=json')
			.then(response => {
				var dataJson = JSON.parse(response.text);
				var rawBudget = dataJson.entry.content['$t'];
				var cleanBudget = parseFloat(rawBudget.replace(/\$/, ''));

				resolve({ fantraxId: fantraxId, sheetsBudget: cleanBudget });
			});
	});
};

var newPostPromise = function(fantraxId, budget) {
	return new Promise(function(resolve, reject) {
		request
			.post('https://www.fantrax.com/newui/fantasy/teamAdjustment.go?leagueId=eju35f9ok7xr9cvt')
			.set('Content-Type', 'application/x-www-form-urlencoded')
			.set('Cookie', process.env.FANTRAX_COOKIES)
			.send({ teamId: fantraxId })
			.send({ isSubmit: 'y' })
			.send({ freeAgentBudget: budget })
			.then(() => {
				resolve();
			});
	});
};

var teamData = {};
var teamPromises = [];

Object.keys(fantraxIds).forEach(fantraxId => {
	teamData[fantraxId] = {};

	teamPromises.push(newFantraxPromise(fantraxId));
	teamPromises.push(newSheetsPromise(fantraxId));
});

Promise.all(teamPromises).then((values) => {
	var postPromises = [];

	values.forEach(value => {
		if (value.fantraxBudget) {
			teamData[value.fantraxId].fantraxBudget = value.fantraxBudget;
		}
		else if (value.sheetsBudget) {
			teamData[value.fantraxId].sheetsBudget = value.sheetsBudget;
		}
	});

	Object.keys(teamData).forEach(fantraxId => {
		var franchise = teamData[fantraxId];

		if (franchise.fantraxBudget - 1000 != franchise.sheetsBudget) {
			postPromises.push(newPostPromise(fantraxId, franchise.sheetsBudget + 1000));
			console.log(fantraxId, franchise);
		}
	});

	Promise.all(postPromises).then(() => {
		process.exit();
	});
});
