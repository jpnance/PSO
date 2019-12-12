var mongoOwners = {
	'Patrick': 'patrick',
	'Koci/Mueller': 'kociMueller',
	'Syed/Kuan': 'syedKuan',
	'John/Zach': 'johnZach',
	'Trevor': 'trevor',
	'Keyon': 'keyon',
	'Brett/Luke': 'brettLuke',
	'Terence': 'terence',
	'James/Charles': 'jamesCharles',
	'Schex': 'schex',
	'Quinn': 'quinn',
	'Mitch': 'mitch'
};

var trials = 100;
var owners = [];

process.argv.forEach(function(value, index, array) {
	if (index > 1) {
		var pair = value.split(/=/);

		switch (pair[0]) {
			case 'n':
				trials = parseInt(pair[1]);
				break;

			case 'owners':
				var ownerPairs = pair[1].split(/;/);

				for (var i in ownerPairs) {
					var ownerPair = ownerPairs[i].split(/:/);
					var ownerStats = ownerPair[1].split(/,/);

					owners.push({ name: ownerPair[0], average: parseFloat(ownerStats[0]), stdev: parseFloat(ownerStats[1]), wins: 0, losses: 0 });
				}

				break;
		}
	}
});

function generateScore(average, stdev) {
	var sum = 0;

	for (var i = 0; i < 12; i++) {
		sum += Math.random();
	}

	return ((sum - 6) * stdev) + average;
}

function simulate(trials, owners) {
	var firstScore;
	var secondScore;

	for (var i = 0; i < trials; i++) {
		firstScore = generateScore(owners[0].average, owners[0].stdev);
		secondScore = generateScore(owners[1].average, owners[1].stdev);

		if (firstScore > secondScore) {
			owners[0].wins += 1;
			owners[1].losses += 1;
		}
		else {
			owners[1].wins += 1;
			owners[0].losses += 1;
		}
	}
}

console.log(owners);
simulate(trials, owners);

for (i in owners) {
	console.log(owners[i].name + ': ' + owners[i].wins + '-' + owners[i].losses + ' (' + (owners[i].wins / (owners[i].wins + owners[i].losses)) + ')');
}
