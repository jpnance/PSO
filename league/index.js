var dotenv = require('dotenv').config({ path: '/app/.env' });

const positionSort = ['QB', 'RB', 'WR', 'TE', 'DL', 'LB', 'DB', 'K'];

const sortByPosition = (a, b) => {
	let aPositionIndex = Math.max(...a.positions.map((position) => positionSort.indexOf(position)));
	let bPositionIndex = Math.max(...b.positions.map((position) => positionSort.indexOf(position)));

	if (aPositionIndex != bPositionIndex) {
		return aPositionIndex - bPositionIndex;
	}
	else {
		return 0;
	}
};

const sortBySalary = (a, b) => {
	if (!a.salary && b.salary) {
		return 1;
	}
	else if (a.salary && !b.salary) {
		return -1;
	}
	else if (!a.salary && !b.salary) {
		return 0;
	}
	else {
		return b.salary - a.salary;
	}
};

const PSO = require('../pso');
const players = require('../public/data/merged.json');

players.sort(sortBySalary);
players.sort(sortByPosition);

let rosters = {}

players.forEach((player) => {
	if (!player.owner) {
		return;
	}

	if (!rosters[player.owner]) {
		rosters[player.owner] = [];
	}

	rosters[player.owner].push(player);
});

const fs = require('fs');
const pug = require('pug');
const compiledPug = pug.compileFile('./team.pug');

Object.values(PSO.franchises).forEach((franchise) => {
	let franchiseKey = franchise[0].toLowerCase() + franchise.replace('/', '').substring(1);

	const renderedHtml = compiledPug({
		owner: franchise,
		roster: rosters[franchise]
	});

	fs.writeFileSync('../public/teams/' + franchiseKey + '.html', renderedHtml);
});
