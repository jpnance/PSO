var mongoose = require('mongoose');
var Schema = mongoose.Schema;

// A Sleeper claim that couldn't be imported as-is. "blocked" claims hold up
// the whole import batch until the commissioner rules them "ignored" (never
// happened) or "replaced" (a different FA transaction recorded instead).
var sleeperReviewSchema = new Schema({
	sleeperTransactionId: { type: String, required: true, unique: true },
	season: { type: Number, required: true },
	week: { type: Number, required: true },
	status: {
		type: String,
		enum: ['blocked', 'ignored', 'replaced'],
		required: true
	},
	problems: [{ type: String }],
	alertedAt: { type: Date },
	ruledAt: { type: Date },
	notes: { type: String },
	replacementTransactionId: { type: Schema.Types.ObjectId, ref: 'Transaction' }
});

module.exports = mongoose.model('SleeperReview', sleeperReviewSchema);
