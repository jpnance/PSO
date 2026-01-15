/**
 * Clean up old trade proposals.
 * 
 * Policy:
 *   - draft: delete after 7 days (just shared ideas)
 *   - pending past expiration: delete after 7 days (should have moved to expired)
 *   - terminal states: delete after 7 days (expired, rejected, withdrawn, countered, executed)
 *   - accepted: keep (waiting for admin approval)
 * 
 * Executed proposals are safe to delete because the Transaction is the
 * permanent record. The proposal was just the negotiation process.
 * 
 * Usage:
 *   docker compose run --rm web node data/scripts/cleanupProposals.js
 *   docker compose run --rm web node data/scripts/cleanupProposals.js --dry-run
 */

var dotenv = require('dotenv').config({ path: '/app/.env' });
var mongoose = require('mongoose');

var TradeProposal = require('../../models/TradeProposal');

mongoose.connect(process.env.MONGODB_URI);

// How old before we delete (in days)
var TTL_DAYS = 7;

async function run() {
	var dryRun = process.argv.includes('--dry-run');
	
	console.log('Cleaning up old trade proposals...\n');
	if (dryRun) {
		console.log('DRY RUN - no changes will be made\n');
	}
	
	var now = new Date();
	var cutoff = new Date(now.getTime() - TTL_DAYS * 24 * 60 * 60 * 1000);
	
	console.log('Cutoff: ' + cutoff.toISOString() + ' (' + TTL_DAYS + ' days ago)');
	console.log('');
	
	// Find old drafts
	var oldDrafts = await TradeProposal.find({
		status: 'hypothetical',
		createdAt: { $lt: cutoff }
	}).select('publicId createdAt').lean();
	
	// Find pending proposals past their expiration (should have moved to expired)
	var stalePending = await TradeProposal.find({
		status: 'pending',
		expiresAt: { $lt: cutoff }
	}).select('publicId expiresAt').lean();
	
	// Find old terminal proposals
	var oldTerminal = await TradeProposal.find({
		status: { $in: ['expired', 'rejected', 'canceled', 'countered', 'executed'] },
		createdAt: { $lt: cutoff }
	}).select('publicId status createdAt').lean();
	
	console.log('Found ' + oldDrafts.length + ' old drafts');
	console.log('Found ' + stalePending.length + ' stale pending proposals');
	console.log('Found ' + oldTerminal.length + ' old terminal proposals');
	console.log('');
	
	var allToDelete = [];
	
	oldDrafts.forEach(function(p) {
		allToDelete.push({ id: p._id, desc: p.publicId + ' [draft] (created ' + p.createdAt.toISOString().slice(0, 10) + ')' });
	});
	
	stalePending.forEach(function(p) {
		allToDelete.push({ id: p._id, desc: p.publicId + ' [pending] (expired ' + p.expiresAt.toISOString().slice(0, 10) + ')' });
	});
	
	oldTerminal.forEach(function(p) {
		allToDelete.push({ id: p._id, desc: p.publicId + ' [' + p.status + '] (created ' + p.createdAt.toISOString().slice(0, 10) + ')' });
	});
	
	if (allToDelete.length === 0) {
		console.log('Nothing to clean up.');
		return;
	}
	
	allToDelete.forEach(function(item) {
		console.log('  ' + item.desc);
	});
	console.log('');
	
	if (!dryRun) {
		var ids = allToDelete.map(function(item) { return item.id; });
		var result = await TradeProposal.deleteMany({ _id: { $in: ids } });
		console.log('Deleted ' + result.deletedCount + ' proposals.');
	} else {
		console.log('Would delete ' + allToDelete.length + ' proposals.');
	}
}

run()
	.then(function() { process.exit(0); })
	.catch(function(err) {
		console.error('Error:', err);
		process.exit(1);
	});
