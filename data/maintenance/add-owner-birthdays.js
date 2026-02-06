/**
 * Add birthdays to Person documents.
 * 
 * This is a one-time migration script. Run it after collecting owner birthdays.
 * Edit the BIRTHDAYS object below with MM-DD format birthdays before running.
 * 
 * Usage:
 *   node data/maintenance/add-owner-birthdays.js           # Dry run (show what would change)
 *   node data/maintenance/add-owner-birthdays.js --apply   # Apply changes
 */

var dotenv = require('dotenv').config({ path: __dirname + '/../../.env' });
var mongoose = require('mongoose');

var Person = require('../../models/Person');

mongoose.connect(process.env.MONGODB_URI);

// Owner birthdays in MM-DD format
// Fill in birthdays as you collect them
var BIRTHDAYS = {
	// Active owners (as of 2025)
	// 'Patrick Nance': '09-17',
	// 'Jason Holwell': '01-15',
	// etc.
	
	// Example format:
	// 'Full Name': 'MM-DD',
};

async function run() {
	var dryRun = !process.argv.includes('--apply');
	
	if (dryRun) {
		console.log('DRY RUN - no changes will be made');
		console.log('Run with --apply to make changes\n');
	}
	
	var people = await Person.find({}).lean();
	console.log('Found', people.length, 'people in database\n');
	
	var updated = 0;
	var skipped = 0;
	var notFound = [];
	
	// Check each birthday entry
	for (var name in BIRTHDAYS) {
		var birthday = BIRTHDAYS[name];
		var person = people.find(function(p) {
			return p.name.toLowerCase() === name.toLowerCase();
		});
		
		if (!person) {
			notFound.push(name);
			continue;
		}
		
		if (person.birthday === birthday) {
			console.log('SKIP:', name, '- already has birthday', birthday);
			skipped++;
			continue;
		}
		
		console.log('UPDATE:', name, '-', person.birthday || '(none)', '->', birthday);
		
		if (!dryRun) {
			await Person.updateOne(
				{ _id: person._id },
				{ $set: { birthday: birthday } }
			);
		}
		updated++;
	}
	
	console.log('\n--- Summary ---');
	console.log('Updated:', updated);
	console.log('Skipped (already set):', skipped);
	
	if (notFound.length > 0) {
		console.log('\nNot found in database:');
		notFound.forEach(function(name) {
			console.log('  -', name);
		});
	}
	
	// Show people without birthdays
	var noBirthday = people.filter(function(p) {
		return !p.birthday && !BIRTHDAYS[p.name];
	});
	
	if (noBirthday.length > 0) {
		console.log('\nPeople still missing birthdays:');
		noBirthday.forEach(function(p) {
			console.log('  -', p.name);
		});
	}
	
	process.exit(0);
}

run().catch(function(err) {
	console.error('Error:', err);
	process.exit(1);
});
