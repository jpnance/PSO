/**
 * Facts Layer - Main Entry Point
 * 
 * This module provides access to all fact parsers.
 * Facts are raw observations from data sources, extracted without inference.
 */

var tradeFacts = require('./trade-facts');
var cutFacts = require('./cut-facts');
var draftFacts = require('./draft-facts');
var snapshotFacts = require('./snapshot-facts');
var sleeperFacts = require('./sleeper-facts');
var fantraxFacts = require('./fantrax-facts');

module.exports = {
	// Trade facts from WordPress
	trades: tradeFacts,
	
	// Cut facts from Google Sheets
	cuts: cutFacts,
	
	// Draft facts from Google Sheets
	drafts: draftFacts,
	
	// Snapshot facts from contracts-YEAR.txt files
	snapshots: snapshotFacts,
	
	// Sleeper transaction facts (2022+)
	sleeper: sleeperFacts,
	
	// Fantrax transaction facts (2020-2021)
	fantrax: fantraxFacts
};
