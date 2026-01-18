const dotenv = require('dotenv').config({ path: '/app/.env' });
const PSO = require('../config/pso');

let extraCompletions = [];

const completer = (line) => {
  const rpoPlayerIdsInContext = findRposInContext(context).map(rpo => rpo.player.id);

	const completions = 'add context exit find offerer owner pick remove rpos save selector switch week'.split(' ').concat(extraCompletions).concat(rpoPlayerIdsInContext);

	const lineTokens = line.split(' ');
	const lastLineToken = lineTokens[lineTokens.length - 1];
	const hits = completions.filter((c) => c.startsWith(lastLineToken));

	return [ hits.length ? hits : completions, lastLineToken ];
};

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout,
	completer: completer,
	prompt: '> '
});

const initializeSleeperPlayers = () => {
	const relevantFantasyPositions = ['QB', 'RB', 'WR', 'TE', 'DL', 'LB', 'DB', 'K'];
	const sleeperPlayers = require('../public/data/sleeper-data.json');

	return Object.values(sleeperPlayers).filter((sleeperPlayer) => sleeperPlayer.active && sleeperPlayer.fantasy_positions?.every((fantasyPosition) => relevantFantasyPositions.includes(fantasyPosition)));
};

const sleeperPlayers = initializeSleeperPlayers();

let rpos = require('./rpo-data.json');
let context = {
	season: process.env.SEASON,
	week: null,
	owner: null,
	offerer: null,
	selector: null
};

rl.prompt();

rl.on('line', (line) => {
	let lineArguments = line.split(' ');

	switch (lineArguments[0]) {
		case 'add':
			addPlayerToContext(context, lineArguments[1]);
			break;

		case 'context':
			console.log(context);
			break;

		case 'exit':
			process.exit();
			break;

		case 'find':
			if (!lineArguments[1]) {
				console.log('Usage: find <name>');
				break;
			}

			let results = findPlayersByName(lineArguments[1]);

			results.forEach((player) => {
				console.log(player.player_id, player.full_name, player.team || 'FA', player.fantasy_positions.join('/'));
			});

			extraCompletions = results.map((player) => player.player_id);

			break;

		case 'offerer':
			context.offerer = lineArguments[1];
			break;

		case 'owner':
			if (!lineArguments[1]) {
				console.log('Usage: owner <franchise name>');
				break;
			}

			if (!Object.values(PSO.franchises).includes(lineArguments[1])) {
				console.log('Unknown owner.');
				break;
			}

			context.owner = lineArguments[1];

			break;
			
		case 'pick':
			pickPlayerInContext(context, lineArguments[1]);
			break;

		case 'remove':
			removePlayerFromContext(context, lineArguments[1]);
			break;

		case 'rpos':
			let filteredRpos = rpos.filter((rpo) => rpo.season == context.season && rpo.week == context.week).sort((a, b) => a.owner < b.owner ? 1 : -1 );

			console.log('Week', context.week, '-', context.season);
			filteredRpos.forEach((rpo) => {
				console.log(rpo.selected ? '✔️' : 'x', rpo.owner, rpo.player.name, rpo.player.id);
			});

			break;

		case 'save':
			fs.writeFileSync(path.join(__dirname, './rpo-data.json'), JSON.stringify(rpos, null, '\t'));
			break;

		case 'selector':
			context.selector = lineArguments[1];
			break;

		case 'switch':
			let temp = context.offerer;
			context.offerer = context.selector;
			context.selector = temp;
			break;

		case 'week':
			if (!lineArguments[1]) {
				console.log('Usage: week <week number>');
				break;
			}

			context.week = parseInt(lineArguments[1]);

			break;

		default:
			console.log('Unknown command.');
			break;
	}

	rl.prompt();
});

const addPlayerToContext = (context, id) => {
	if (!context.week) {
		console.log('Specify a week first.');
		return;
	}

	if (!context.owner) {
		console.log('Specify an owner first.');
		return;
	}

	if (!context.offerer) {
		console.log('Specify an offerer first.');
		return;
	}

	if (!context.selector) {
		console.log('Specify a selector first.');
		return;
	}

	if (!id) {
		console.log('Usage: add <player ID>');
		return;
	}

	const player = findPlayerById(id);

	if (!player) {
		console.log('Unknown player.');
		return;
	}

	let contextRpos = findRposInContext(context);

	if (contextRpos.length >= 2) {
		console.log('This owner already has two players offered this week.');
		return;
	}

	rpos.push({
		...context,
		player: {
			id: player.player_id,
			name: player.full_name
		}
	});

	console.log(player.player_id, player.full_name);
};

const findPlayerById = (id) => {
	return sleeperPlayers.find((sleeperPlayer) => sleeperPlayer.player_id == id);
};

const findPlayersByName = (name) => {
	return Object.values(sleeperPlayers).filter((sleeperPlayer) => {
		return sleeperPlayer.full_name?.toLowerCase().replace(/[ \.']/g, '').includes(name.toLowerCase());
	});
};

const findRposInContext = (context) => {
	return rpos.filter((rpo) => rpo.season == context.season && rpo.week == context.week && rpo.owner == context.owner && rpo.offerer == context.offerer && rpo.selector == context.selector);
};

const pickPlayerInContext = (context, id) => {
	if (!context.week) {
		console.log('Specify a week first.');
		return;
	}

	if (!id) {
		console.log('Usage: pick <player ID>');
		return;
	}

	let contextRpos = findRposInContext(context);

	if (!contextRpos.length || !contextRpos.find((contextRpo) => contextRpo.player.id == id)) {
		console.log('That player hasn\'t been offered in this context.');
		return;
	}

	contextRpos.forEach((contextRpo) => {
		if (contextRpo.player.id == id) {
			contextRpo.selected = true;
			console.log(context.selector, 'selects', contextRpo.player.name);
		}
		else {
			contextRpo.selected = false;
		}
	});
};

const removePlayerFromContext = (context, id) => {
	if (!context.week) {
		console.log('Specify a week first.');
		return;
	}

	if (!context.owner) {
		console.log('Specify an owner first.');
		return;
	}

	if (!context.offerer) {
		console.log('Specify an offerer first.');
		return;
	}

	if (!context.selector) {
		console.log('Specify a selector first.');
		return;
	}

	if (!id) {
		console.log('Usage: add <player ID>');
		return;
	}

	const player = findPlayerById(id);

	if (!player) {
		console.log('Unknown player.');
		return;
	}

	var contextRpos = findRposInContext(context);

	if (!contextRpos.length) {
		console.log('This owner hasn\'t yet had any players offered.');
		return;
	}

	let rpoToRemove = contextRpos.find((contextRpo) => contextRpo.player.id == id);

	if (!rpoToRemove) {
		console.log('That player hasn\'t been offered in this context.');
		return;
	}

	rpos.splice(rpos.indexOf(rpoToRemove), 1);
};
