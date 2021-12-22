var trials = 100;
var owners = [];

if (process.argv.length < 3) {
	console.log('You should probably be running this via matchup.sh.');
	console.log();
	console.log('Usage example: node matchup.js n=10000 owners="Keyon:162.60,26.53;Jason:154.95,28.83")');
	console.log('Use n=10000 for 10,000 trials.');
	console.log('Use owners="Keyon:162.60,26.53,Jason:154.95,28.83" for Keyon (averaging 162.60 points at a 26.53 standard deviation) against Jason (154.95 and 28.83).');
	process.exit()
}

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

//console.log(owners);
simulate(trials, owners);

for (i in owners) {
	console.log(owners[i].name + ': ' + owners[i].wins + '-' + owners[i].losses + ' (' + (owners[i].wins / (owners[i].wins + owners[i].losses)) + ')');
}
