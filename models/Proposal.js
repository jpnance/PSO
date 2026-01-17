var mongoose = require('mongoose');
var Schema = mongoose.Schema;

// Player reference in a proposal (contract details looked up at execution)
var proposalPlayerSchema = new Schema({
	playerId: { type: Schema.Types.ObjectId, ref: 'Player', required: true }
}, { _id: false });

// Pick reference in a proposal
var proposalPickSchema = new Schema({
	pickId: { type: Schema.Types.ObjectId, ref: 'Pick', required: true }
}, { _id: false });

// Cash in a proposal
var proposalCashSchema = new Schema({
	amount: { type: Number, required: true },
	season: { type: Number, required: true },
	fromFranchiseId: { type: Schema.Types.ObjectId, ref: 'Franchise', required: true }
}, { _id: false });

// Each party in the proposal
var proposalPartySchema = new Schema({
	franchiseId: { type: Schema.Types.ObjectId, ref: 'Franchise', required: true },
	receives: {
		players: [proposalPlayerSchema],
		picks: [proposalPickSchema],
		cash: [proposalCashSchema]
	},
	// Acceptance tracking
	accepted: { type: Boolean, default: false },
	acceptedAt: { type: Date, default: null },
	acceptedBy: { type: Schema.Types.ObjectId, ref: 'Person', default: null }
}, { _id: false });

var proposalSchema = new Schema({
	// Public-facing ID (generated as fun name-based slug in service layer)
	publicId: {
		type: String,
		unique: true,
		required: true
	},

	status: {
		type: String,
		enum: ['hypothetical', 'pending', 'accepted', 'rejected', 'canceled', 'expired', 'executed'],
		default: 'hypothetical'
	},

	// Who created this proposal
	createdByFranchiseId: { type: Schema.Types.ObjectId, ref: 'Franchise', required: true },
	createdByPersonId: { type: Schema.Types.ObjectId, ref: 'Person', required: true },
	createdAt: { type: Date, default: Date.now },

	// Expiration: 7 days from creation or trade deadline, whichever is first
	expiresAt: { type: Date, required: true },

	// Acceptance window: starts when first party accepts (10-minute window)
	acceptanceWindowStart: { type: Date, default: null },

	// The parties and what they receive
	parties: [proposalPartySchema],

	// Optional notes
	notes: { type: String, default: null },

	// When executed, reference to the resulting Transaction
	executedTransactionId: { type: Schema.Types.ObjectId, ref: 'Transaction', default: null }
});

// Indexes
proposalSchema.index({ publicId: 1 }, { unique: true });
proposalSchema.index({ status: 1 });
proposalSchema.index({ createdAt: -1 });
proposalSchema.index({ expiresAt: 1 });
proposalSchema.index({ createdByFranchiseId: 1 });
proposalSchema.index({ createdByPersonId: 1 });
proposalSchema.index({ 'parties.franchiseId': 1 });
proposalSchema.index({ acceptanceWindowStart: 1 }, { sparse: true });

// Constants
proposalSchema.statics.ACCEPTANCE_WINDOW_MINUTES = 10;

// Check if the acceptance window has expired (returns true if expired)
proposalSchema.methods.isAcceptanceWindowExpired = function() {
	if (!this.acceptanceWindowStart) return false;
	var windowMs = proposalSchema.statics.ACCEPTANCE_WINDOW_MINUTES * 60 * 1000;
	var deadline = new Date(this.acceptanceWindowStart.getTime() + windowMs);
	return new Date() > deadline;
};

// Get remaining time in acceptance window (in milliseconds, or null if not started)
proposalSchema.methods.getAcceptanceWindowRemaining = function() {
	if (!this.acceptanceWindowStart) return null;
	var windowMs = proposalSchema.statics.ACCEPTANCE_WINDOW_MINUTES * 60 * 1000;
	var deadline = new Date(this.acceptanceWindowStart.getTime() + windowMs);
	var remaining = deadline.getTime() - new Date().getTime();
	return Math.max(0, remaining);
};

// Check if all parties have accepted
proposalSchema.methods.allPartiesAccepted = function() {
	return this.parties.every(function(party) {
		return party.accepted === true;
	});
};

// Reset all acceptances (when window expires)
proposalSchema.methods.resetAcceptances = function() {
	this.parties.forEach(function(party) {
		party.accepted = false;
		party.acceptedAt = null;
		party.acceptedBy = null;
	});
	this.acceptanceWindowStart = null;
};

// Check if the proposal has expired (7-day expiration)
proposalSchema.methods.isExpired = function() {
	return new Date() > this.expiresAt;
};

module.exports = mongoose.model('Proposal', proposalSchema);
