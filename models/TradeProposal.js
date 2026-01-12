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

var tradeProposalSchema = new Schema({
	status: {
		type: String,
		enum: ['draft', 'pending', 'accepted', 'rejected', 'withdrawn', 'expired', 'executed', 'countered'],
		default: 'draft'
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

	// Counter-offer tracking
	previousVersionId: { type: Schema.Types.ObjectId, ref: 'TradeProposal', default: null },
	counteredById: { type: Schema.Types.ObjectId, ref: 'TradeProposal', default: null },

	// When executed, reference to the resulting Transaction
	executedTransactionId: { type: Schema.Types.ObjectId, ref: 'Transaction', default: null }
});

// Indexes
tradeProposalSchema.index({ status: 1 });
tradeProposalSchema.index({ createdAt: -1 });
tradeProposalSchema.index({ expiresAt: 1 });
tradeProposalSchema.index({ createdByFranchiseId: 1 });
tradeProposalSchema.index({ createdByPersonId: 1 });
tradeProposalSchema.index({ 'parties.franchiseId': 1 });
tradeProposalSchema.index({ acceptanceWindowStart: 1 }, { sparse: true });

// Constants
tradeProposalSchema.statics.ACCEPTANCE_WINDOW_MINUTES = 10;

// Check if the acceptance window has expired (returns true if expired)
tradeProposalSchema.methods.isAcceptanceWindowExpired = function() {
	if (!this.acceptanceWindowStart) return false;
	var windowMs = tradeProposalSchema.statics.ACCEPTANCE_WINDOW_MINUTES * 60 * 1000;
	var deadline = new Date(this.acceptanceWindowStart.getTime() + windowMs);
	return new Date() > deadline;
};

// Get remaining time in acceptance window (in milliseconds, or null if not started)
tradeProposalSchema.methods.getAcceptanceWindowRemaining = function() {
	if (!this.acceptanceWindowStart) return null;
	var windowMs = tradeProposalSchema.statics.ACCEPTANCE_WINDOW_MINUTES * 60 * 1000;
	var deadline = new Date(this.acceptanceWindowStart.getTime() + windowMs);
	var remaining = deadline.getTime() - new Date().getTime();
	return Math.max(0, remaining);
};

// Check if all parties have accepted
tradeProposalSchema.methods.allPartiesAccepted = function() {
	return this.parties.every(function(party) {
		return party.accepted === true;
	});
};

// Reset all acceptances (when window expires)
tradeProposalSchema.methods.resetAcceptances = function() {
	this.parties.forEach(function(party) {
		party.accepted = false;
		party.acceptedAt = null;
		party.acceptedBy = null;
	});
	this.acceptanceWindowStart = null;
};

// Check if the proposal has expired (7-day expiration)
tradeProposalSchema.methods.isExpired = function() {
	return new Date() > this.expiresAt;
};

module.exports = mongoose.model('TradeProposal', tradeProposalSchema);
