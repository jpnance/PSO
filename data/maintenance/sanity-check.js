/**
 * Sanity check cron job
 * 
 * Run via: node data/maintenance/sanity-check.js
 * 
 * Runs all sanity checks (including Sleeper roster comparison) and
 * alerts commissioner via ntfy if problems found.
 */

var dotenv = require('dotenv').config({ path: __dirname + '/../../.env' });
var mongoose = require('mongoose');

var sanity = require('../../services/sanity');
var notifications = require('../../helpers/notifications');

// ANSI color codes
var GREEN = '\x1b[32m';
var RED = '\x1b[31m';
var YELLOW = '\x1b[33m';
var RESET = '\x1b[0m';
var CHECK = GREEN + '✓' + RESET;
var CROSS = RED + '✗' + RESET;
var SKIP = YELLOW + '○' + RESET;

async function run() {
	await mongoose.connect(process.env.MONGODB_URI);
	console.log('Running sanity checks...\n');
	
	var results = await sanity.runAllChecks();
	
	// Display each check's status
	Object.keys(results.checks).forEach(function(key) {
		var check = results.checks[key];
		var icon;
		var status;
		if (check.skipped) {
			icon = SKIP;
			status = 'skipped';
		} else if (check.problems === 0) {
			icon = CHECK;
			status = 'passed';
		} else {
			icon = CROSS;
			status = check.problems + ' problem' + (check.problems !== 1 ? 's' : '');
		}
		console.log(icon + ' ' + check.name + ' — ' + status);
	});
	console.log('');
	
	if (results.allHealthy) {
		console.log(GREEN + 'All checks passed.' + RESET);
		process.exit(0);
	}
	
	console.log(RED + 'PROBLEMS FOUND: ' + results.problemCount + RESET + '\n');
	
	// Group problems by category
	var byCategory = {};
	results.problems.forEach(function(p) {
		if (!byCategory[p.category]) {
			byCategory[p.category] = [];
		}
		byCategory[p.category].push(p.message);
	});
	
	Object.keys(byCategory).forEach(function(category) {
		console.log('[' + category + ']');
		byCategory[category].forEach(function(msg) {
			console.log('  - ' + msg);
		});
		console.log('');
	});
	
	// Build notification message
	var baseUrl = process.env.BASE_URL || 'https://pso.coinflipper.io';
	var summary = results.problems.slice(0, 3).map(function(p) {
		return '• ' + p.message;
	}).join('\n');
	
	var message = 'PSO Sanity Check: ' + results.problemCount + ' problem' + (results.problemCount !== 1 ? 's' : '') + ' found\n\n' + summary;
	if (results.problemCount > 3) {
		message += '\n... and ' + (results.problemCount - 3) + ' more';
	}
	message += '\n\n' + baseUrl + '/admin/sanity';
	
	await notifications.alertCommissioner(message, { priority: 'high' });
	
	process.exit(1);
}

run().catch(function(err) {
	console.error('Sanity check crashed:', err);
	notifications.alertCommissioner('Sanity check script crashed: ' + err.message).then(function() {
		process.exit(1);
	});
});
