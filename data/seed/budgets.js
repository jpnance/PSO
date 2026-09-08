var dotenv = require('dotenv').config({ path: __dirname + '/../../.env' });
var mongoose = require('mongoose');
var { rebuildAllBudgets } = require('../../helpers/budget');

mongoose.connect(process.env.MONGODB_URI);

async function seed() {
	console.log('Rebuilding all budgets from contracts and transactions...\n');
	await rebuildAllBudgets();
	console.log('\nDone!');
	process.exit(0);
}

seed().catch(function(err) {
	console.error('Error:', err);
	process.exit(1);
});
