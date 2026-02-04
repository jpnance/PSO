#!/usr/bin/env node
/**
 * Refresh cuts cache from Google Sheets.
 * Enriches cuts with franchiseId by resolving owner names.
 * 
 * Usage:
 *   docker compose run --rm web node data/cuts/refresh-cache.js
 */

require('dotenv').config({ path: __dirname + '/../../.env' });
var mongoose = require('mongoose');
var cutFacts = require('../facts/cut-facts');

async function main() {
	var apiKey = process.env.GOOGLE_API_KEY;
	
	if (!apiKey) {
		console.error('GOOGLE_API_KEY not set in environment');
		process.exit(1);
	}
	
	console.log('Connecting to database...');
	await mongoose.connect(process.env.MONGODB_URI);
	
	console.log('Fetching cuts from Google Sheets...');
	var cuts = await cutFacts.fetchAndCache(apiKey);
	
	console.log('Done. Cached ' + cuts.length + ' cuts.');
	
	await mongoose.disconnect();
	process.exit(0);
}

main().catch(function(err) {
	console.error('Error:', err.message);
	process.exit(1);
});
