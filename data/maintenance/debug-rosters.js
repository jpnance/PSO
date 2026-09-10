#!/usr/bin/env node

/**
 * Compare PSO rosters against Sleeper rosters and show differences.
 * 
 * Usage:
 *   runt pso-debug-rosters
 */

var dotenv = require('dotenv').config({ path: __dirname + '/../../.env' });
var mongoose = require('mongoose');

var Contract = require('../../models/Contract');
var Player = require('../../models/Player');
var Franchise = require('../../models/Franchise');
var Regime = require('../../models/Regime');
var LeagueConfig = require('../../models/LeagueConfig');
var PSO = require('../../config/pso');
var sleeperHelper = require('../../helpers/sleeper');
var { buildRegimeMap } = require('../../helpers/regime');

async function main() {
	await mongoose.connect(process.env.MONGODB_URI);
	console.log('Connected to MongoDB\n');
	
	var config = await LeagueConfig.findById('pso');
	var season = config ? config.season : PSO.season;
	
	console.log('Season: ' + season + '\n');
	
	// Build player lookup
	var players = await Player.find({}).lean();
	var playerBySleeperId = {};
	var playerById = {};
	players.forEach(function(p) {
		if (p.sleeperId) playerBySleeperId[p.sleeperId] = p;
		playerById[p._id.toString()] = p;
	});
	
	// Build franchise lookup
	var franchises = await Franchise.find({ rosterId: { $ne: null } }).lean();
	var regimes = await Regime.find({}).lean();
	var regimeMap = buildRegimeMap(regimes, season);
	
	// Get PSO rosters
	var psoRosters = {};
	for (var i = 0; i < franchises.length; i++) {
		var f = franchises[i];
		var contracts = await Contract.find({
			franchiseId: f._id,
			$or: [
				{ endYear: { $gte: season } },
				{ endYear: null, salary: { $ne: null } }  // pending contracts
			]
		}).lean();
		
		psoRosters[f.rosterId] = {
			franchise: f,
			displayName: regimeMap[f._id.toString()] || ('Franchise ' + f.rosterId),
			players: contracts.map(function(c) {
				var player = playerById[c.playerId.toString()];
				return {
					playerId: c.playerId,
					sleeperId: player ? player.sleeperId : null,
					name: player ? player.name : 'Unknown'
				};
			})
		};
	}
	
	// Get Sleeper rosters
	var sleeperRosters;
	try {
		sleeperRosters = await sleeperHelper.fetchSleeperRosters();
	} catch (err) {
		console.error('Failed to fetch Sleeper rosters:', err.message);
		process.exit(1);
	}
	
	// Compare
	var totalMismatches = 0;
	
	for (var rosterId = 1; rosterId <= 12; rosterId++) {
		var pso = psoRosters[rosterId];
		var sleeper = sleeperRosters[rosterId];
		
		if (!pso || !sleeper) {
			console.log('Roster ' + rosterId + ': Missing data');
			continue;
		}
		
		var psoSleeperIds = pso.players
			.map(function(p) { return p.sleeperId; })
			.filter(function(id) { return id != null; })
			.sort();
		
		var sleeperPlayerIds = (sleeper.players || []).sort();
		
		// Find differences
		var inPsoNotSleeper = psoSleeperIds.filter(function(id) {
			return sleeperPlayerIds.indexOf(id) === -1;
		});
		
		var inSleeperNotPso = sleeperPlayerIds.filter(function(id) {
			return psoSleeperIds.indexOf(id) === -1;
		});
		
		if (inPsoNotSleeper.length === 0 && inSleeperNotPso.length === 0) {
			console.log(pso.displayName + ' (roster ' + rosterId + '): ✓ In sync (' + psoSleeperIds.length + ' players)');
		} else {
			totalMismatches++;
			console.log(pso.displayName + ' (roster ' + rosterId + '): MISMATCH');
			
			if (inPsoNotSleeper.length > 0) {
				console.log('  In PSO but not Sleeper:');
				inPsoNotSleeper.forEach(function(sleeperId) {
					var player = playerBySleeperId[sleeperId];
					console.log('    - ' + (player ? player.name : 'Unknown') + ' (' + sleeperId + ')');
				});
			}
			
			if (inSleeperNotPso.length > 0) {
				console.log('  In Sleeper but not PSO:');
				inSleeperNotPso.forEach(function(sleeperId) {
					var player = playerBySleeperId[sleeperId];
					console.log('    - ' + (player ? player.name : 'Unknown') + ' (' + sleeperId + ')');
				});
			}
		}
	}
	
	console.log('\n' + (totalMismatches === 0 ? 'All rosters in sync!' : totalMismatches + ' roster(s) with mismatches.'));
	
	await mongoose.disconnect();
}

main().catch(function(err) {
	console.error('Error:', err);
	process.exit(1);
});
