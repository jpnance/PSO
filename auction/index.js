var dotenv = require('dotenv').config({ path: '/app/.env' });
var PSO = require('../config/pso');

var request = require('superagent');

var parameters = {
	render: false,
	season: PSO.season,
	site: 'pso'
};

var siteData = {
	pso: {
		referenceSite: 'https://www.pro-football-reference.com/search/search.fcgi?search='
	},
	colbys: {
		sheetLink: 'https://sheets.googleapis.com/v4/spreadsheets/16SHgSkREFEYmPuLg35KDSIdJ72MrEkYb1NKXSaoqSTc/values/Rostered',
		firstRow: 2,
		referenceSite: 'https://www.basketball-reference.com/search/search.fcgi?search='
	}
};

process.argv.forEach(function(value, index, array) {
	if (index > 1) {
		var pair = value.split(/=/);

		switch (pair[0]) {
			case 'demo':
				parameters.demo = true;
				break;

			case 'render':
				parameters.render = true;
				break;

			case 'season':
				parameters.season = parseInt(pair[1]);
				break;

			case 'site':
				parameters.site = pair[1];
				break;
		}
	}
});

function loadPlayersFromSheet() {
	return request
		.get(siteData[parameters.site].sheetLink)
		.query({ alt: 'json', key: process.env.GOOGLE_API_KEY })
		.then(function(response) {
			var dataJson = JSON.parse(response.text);
			var players = [];
			var rows = [];

			dataJson.values.forEach(function(row, i) {
				if (i < siteData[parameters.site].firstRow - 1 || i == rows.length - 1) {
					return;
				}

				var player = {
					owner: row[0],
					name: row[1],
					position: row[2],
					start: row[3],
					end: row[4],
					salary: row[5]
				};

				if (player.end == parameters.season) {
					if (player.start == parameters.season - 2 || player.start == parameters.season - 1) {
						player.situation = 'RFA-' + player.owner;
					}
					else {
						player.situation = 'UFA';
					}

					players.push(player);
				}
			});

			return { players: players, owners: PSO.nominationOrder };
		});
}

function loadPlayersFromDB() {
	var mongoose = require('mongoose');
	var Contract = require('../models/Contract');
	var Franchise = require('../models/Franchise');
	var LeagueConfig = require('../models/LeagueConfig');
	var Player = require('../models/Player');
	var Regime = require('../models/Regime');
	var Transaction = require('../models/Transaction');

	var positionOrder = ['QB', 'RB', 'WR', 'TE', 'DL', 'LB', 'DB', 'K'];

	function formatPosition(positions) {
		if (!positions || positions.length === 0) return 'Unknown';
		return positions.slice().sort(function(a, b) {
			var idxA = positionOrder.indexOf(a);
			var idxB = positionOrder.indexOf(b);
			if (idxA === -1) idxA = 99;
			if (idxB === -1) idxB = 99;
			return idxA - idxB;
		}).join('/');
	}

	return mongoose.connect(process.env.MONGODB_URI).then(async function() {
		var config = await LeagueConfig.findById('pso');
		var season = config ? config.season : parameters.season;

		var regimes = await Regime.find({ 'tenures.endSeason': null }).lean();
		var franchiseDisplayNames = {};
		regimes.forEach(function(regime) {
			regime.tenures.forEach(function(tenure) {
				if (tenure.endSeason === null) {
					franchiseDisplayNames[tenure.franchiseId.toString()] = regime.displayName;
				}
			});
		});

		var playerMap = {};

		// RFAs: salary-null contracts (same as /rfa page)
		var rfaContracts = await Contract.find({ salary: null })
			.populate('playerId', 'name positions')
			.lean();

		rfaContracts.forEach(function(c) {
			if (!c.playerId) return;
			var owner = c.franchiseId ? franchiseDisplayNames[c.franchiseId.toString()] || 'Unknown' : 'Unknown';
			playerMap[c.playerId._id.toString()] = {
				name: c.playerId.name,
				position: formatPosition(c.playerId.positions),
				situation: 'RFA-' + owner
			};
		});

		// UFAs Source 1: contracts still on rosters with UFA-qualifying terms
		var ufaContracts = await Contract.find({
			endYear: season,
			salary: { $ne: null },
			$or: [
				{ startYear: null },
				{ startYear: season }
			]
		}).populate('playerId', 'name positions').lean();

		ufaContracts.forEach(function(c) {
			if (!c.playerId) return;
			var id = c.playerId._id.toString();
			if (!playerMap[id]) {
				playerMap[id] = {
					name: c.playerId.name,
					position: formatPosition(c.playerId.positions),
					situation: 'UFA'
				};
			}
		});

		// UFAs Source 2: contract-expiry transactions
		var expiryTransactions = await Transaction.find({
			type: 'contract-expiry',
			endYear: season
		}).populate('playerId', 'name positions').lean();

		expiryTransactions.forEach(function(t) {
			if (!t.playerId) return;
			var id = t.playerId._id.toString();
			if (!playerMap[id]) {
				playerMap[id] = {
					name: t.playerId.name,
					position: formatPosition(t.playerId.positions),
					situation: 'UFA'
				};
			}
		});

		// UFAs Source 3: FA drops (cut mid-season)
		var faDropTransactions = await Transaction.find({
			type: 'fa',
			'drops.endYear': season
		}).populate('drops.playerId', 'name positions').lean();

		faDropTransactions.forEach(function(t) {
			if (!t.drops) return;
			t.drops.forEach(function(drop) {
				if (drop.playerId && drop.endYear === season) {
					var id = drop.playerId._id.toString();
					if (!playerMap[id]) {
						playerMap[id] = {
							name: drop.playerId.name,
							position: formatPosition(drop.playerId.positions),
							situation: 'UFA'
						};
					}
				}
			});
		});

		// Remove expired/cut players who have since been re-acquired
		var ufaIds = Object.keys(playerMap).filter(function(id) {
			return playerMap[id].situation === 'UFA';
		});

		if (ufaIds.length > 0) {
			var currentContracts = await Contract.find({
				playerId: { $in: ufaIds }
			}).lean();

			currentContracts.forEach(function(c) {
				delete playerMap[c.playerId.toString()];
			});
		}

		var players = Object.keys(playerMap).map(function(id) {
			return playerMap[id];
		});

		var owners = regimes.map(function(r) { return r.displayName; }).sort();

		await mongoose.disconnect();
		return { players: players, owners: owners };
	});
}

function run() {
	var loadPlayers;

	if (parameters.site === 'pso') {
		loadPlayers = loadPlayersFromDB();
	} else {
		loadPlayers = loadPlayersFromSheet();
	}

	loadPlayers.then(function(result) {
		var players = result.players;
		var owners = result.owners;

		players.sort(function(a, b) {
			return a.name.localeCompare(b.name);
		});

		var positions = [];
		var situations = [];

		players.forEach(function(player) {
			if (!positions.includes(player.position)) {
				positions.push(player.position);
			}

			if (!situations.includes(player.situation)) {
				situations.push(player.situation);
			}
		});

		positions.sort();
		situations.sort();

		var fs = require('fs');
		var path = require('path');
		var auctionDir = path.join(__dirname, '../public/auction');

		if (parameters.render) {
			var pug = require('pug');
			fs.mkdirSync(auctionDir, { recursive: true });
			var compiledPug = pug.compileFile(path.join(__dirname, '../views/auction.pug'));
			fs.writeFileSync(path.join(auctionDir, 'index.html'), compiledPug({
				owners: owners,
				referenceSite: siteData[parameters.site].referenceSite,
				webSocketUrl: process.env.WEB_SOCKET_URL
			}));

			var compiledPugAdmin = pug.compileFile(path.join(__dirname, '../views/auction-admin.pug'));
			fs.writeFileSync(path.join(auctionDir, 'admin.html'), compiledPugAdmin({
				players: players,
				situations: situations,
				owners: owners,
				referenceSite: siteData[parameters.site].referenceSite,
				webSocketUrl: process.env.WEB_SOCKET_URL
			}));
		}

		if (parameters.demo) {
			fs.mkdirSync(auctionDir, { recursive: true });
			fs.writeFileSync(path.join(auctionDir, 'demo-data.json'), JSON.stringify(players));
		}

		process.exit();
	}).catch(function(err) {
		console.error('Error:', err);
		process.exit(1);
	});
}

run();
