#!/usr/bin/env node
/**
 * Run all tests in the tests/ directory.
 * 
 * Usage:
 *   node tests/run-all.js
 *   docker compose run --rm web node tests/run-all.js
 */

var path = require('path');
var childProcess = require('child_process');

var testFiles = [
	// Facts layer tests
	'facts/trade-facts.test.js',
	'facts/cut-facts.test.js',
	'facts/draft-facts.test.js',
	'facts/snapshot-facts.test.js',
	'facts/sleeper-facts.test.js',
	'facts/fantrax-facts.test.js',
	
	// Inference engine tests
	'inference/constraints.test.js',
	'inference/contract-term.test.js',
	'inference/ambiguity.test.js',
	
	// Existing tests (require DB)
	// 'trade.js',
	// 'tiebreaker.js',
	// 'rollover.js',
	// 'jaguar-standings.js'
];

var passed = 0;
var failed = 0;
var results = [];

console.log('=== PSO Test Suite ===\n');

testFiles.forEach(function(file) {
	var testPath = path.join(__dirname, file);
	var displayName = file.replace('.test.js', '').replace('.js', '');
	
	try {
		var result = childProcess.spawnSync('node', [testPath], {
			stdio: 'pipe',
			encoding: 'utf8',
			timeout: 30000
		});
		
		if (result.status === 0) {
			console.log('✓', displayName);
			passed++;
			results.push({ name: displayName, status: 'passed' });
		} else {
			console.log('✗', displayName);
			failed++;
			results.push({ name: displayName, status: 'failed', output: result.stdout + result.stderr });
			
			// Show first few lines of failure
			var output = (result.stdout + result.stderr).split('\n').slice(0, 5).join('\n');
			if (output) {
				console.log('  ', output.replace(/\n/g, '\n  '));
			}
		}
	} catch (err) {
		console.log('✗', displayName, '- Error:', err.message);
		failed++;
		results.push({ name: displayName, status: 'error', error: err.message });
	}
});

console.log('\n=== Summary ===');
console.log(passed + ' passed, ' + failed + ' failed');

// Show failed tests details
if (failed > 0) {
	console.log('\nFailed tests:');
	results.filter(function(r) { return r.status !== 'passed'; }).forEach(function(r) {
		console.log('  -', r.name);
	});
}

process.exit(failed > 0 ? 1 : 0);
