const fs = require('fs');

const offeredRegexp = /^\s+\* (.*?) offered (.*?) (and) (.*?)$/;
const selectedRegexp = /^\s+\* (.*?) selected (.*?) \((.*?)\)/;
const receivedRegexp = /^\s+\* (.*?) received (.*?) \((.*?)\)/;

const ordinals = / (Jr\.?)|(Sr\.?)|(II)|(III)|(IV)|(V)$/;

let rawRpos = [];
let rpoXi = {};

for (let week = 1; week < 16; week++) {
	var rpoData = fs.readFileSync('week' + (week + 1) + '.txt');

	let lines = rpoData.toString().split('\r\n');

	let matchup = {};

	lines.forEach((line) => {
		if (line.includes(' offered ')) {
			let fields = offeredRegexp.exec(line);

			if (!fields) {
				return;
			}

			matchup = {
				week: week,
				offerer: fields[1],
				selected: {
					name: fields[2].replace(ordinals, '')
				},
				received: {
					name: fields[4].replace(ordinals, '')
				}
			};
		}
		else if (line.includes(' selected ')) {
			let fields = selectedRegexp.exec(line);

			if (!fields) {
				return;
			}

			matchup.selected.score = parseFloat(fields[3]);
		}
		else if (line.includes(' received ')) {
			let fields = receivedRegexp.exec(line);

			if (!fields) {
				return;
			}

			matchup.received.score = parseFloat(fields[3]);

			rawRpos.push(matchup);
		}
	});
}

rawRpos.forEach((rawRpo) => {
	[rawRpo.selected.name, rawRpo.received.name].forEach((name) => {
		if (!rpoXi[name]) {
			rpoXi[name] = {
				offered: 0,
				selected: 0,
				rejected: 0,
				won: 0,
				lost: 0,
				pushed: 0
			};
		}
	});

	rpoXi[rawRpo.selected.name].offered += 1;
	rpoXi[rawRpo.selected.name].selected += 1;

	rpoXi[rawRpo.received.name].offered += 1;
	rpoXi[rawRpo.received.name].rejected += 1;

	if (isNaN(rawRpo.selected.score) || isNaN(rawRpo.received.score)) {
		rpoXi[rawRpo.selected.name].pushed += 1;
		rpoXi[rawRpo.received.name].pushed += 1;
	}
	else if (rawRpo.selected.score > rawRpo.received.score) {
		rpoXi[rawRpo.selected.name].won += 1;
		rpoXi[rawRpo.received.name].lost += 1;
	}
	else if (rawRpo.selected.score < rawRpo.received.score) {
		rpoXi[rawRpo.received.name].won += 1;
		rpoXi[rawRpo.selected.name].lost += 1;
	}
});

Object.keys(rpoXi).forEach((rpoXiKey) => {
	console.log([ rpoXiKey, rpoXi[rpoXiKey].offered, rpoXi[rpoXiKey].selected, rpoXi[rpoXiKey].rejected, rpoXi[rpoXiKey].won, rpoXi[rpoXiKey].lost, rpoXi[rpoXiKey].pushed ].join(','));
});
