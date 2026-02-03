var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var buyOutSchema = new Schema({
	season: { type: Number, required: true },
	amount: { type: Number, required: true }
}, { _id: false });

// FA transaction schemas (unified fa-pickup and fa-cut)
var faAddSchema = new Schema({
	playerId: { type: Schema.Types.ObjectId, ref: 'Player', required: true },
	salary: { type: Number },
	startYear: { type: Number },
	endYear: { type: Number }
}, { _id: false });

var faDropSchema = new Schema({
	playerId: { type: Schema.Types.ObjectId, ref: 'Player', required: true },
	salary: { type: Number },
	startYear: { type: Number },
	endYear: { type: Number },
	buyOuts: [buyOutSchema]
}, { _id: false });

var tradePlayerSchema = new Schema({
	playerId: { type: Schema.Types.ObjectId, ref: 'Player', required: true },
	salary: { type: Number },
	startYear: { type: Number },
	endYear: { type: Number },
	rfaRights: { type: Boolean, default: false },
	// True if contract years couldn't be definitively determined from source data
	ambiguous: { type: Boolean, default: false }
}, { _id: false });

var tradePickSchema = new Schema({
	round: { type: Number, required: true },
	season: { type: Number, required: true },
	fromFranchiseId: { type: Schema.Types.ObjectId, ref: 'Franchise', required: true }
}, { _id: false });

var tradeCashSchema = new Schema({
	amount: { type: Number, required: true },
	season: { type: Number, required: true },
	fromFranchiseId: { type: Schema.Types.ObjectId, ref: 'Franchise', required: true }
}, { _id: false });

var tradeRfaRightsSchema = new Schema({
	playerId: { type: Schema.Types.ObjectId, ref: 'Player', required: true }
}, { _id: false });

var tradePartySchema = new Schema({
	franchiseId: { type: Schema.Types.ObjectId, ref: 'Franchise', required: true },
	receives: {
		players: [tradePlayerSchema],
		picks: [tradePickSchema],
		cash: [tradeCashSchema],
		rfaRights: [tradeRfaRightsSchema]
	}
}, { _id: false });

var transactionSchema = new Schema({
	type: {
		type: String,
		enum: [
			'trade',
			'fa',  // unified free agent transaction (replaces fa-pickup and fa-cut)
			'draft-select',
			'draft-pass',
			'auction-ufa',
			'auction-rfa-matched',
			'auction-rfa-unmatched',
			'rfa-rights-conversion',  // contract expired, RFA rights conveyed to franchise
			'contract'
		],
		required: true
	},
	timestamp: { type: Date, required: true },
	source: {
		type: String,
		enum: ['wordpress', 'sleeper', 'fantrax', 'manual', 'snapshot', 'cuts'],
		required: true
	},

	// Optional notes for special circumstances (conditional picks, corrections, etc.)
	notes: { type: String },

	// Trade fields
	tradeId: { type: Number },
	parties: [tradePartySchema],

	// Shared fields (used by FA, draft, auction, contract)
	franchiseId: { type: Schema.Types.ObjectId, ref: 'Franchise' },
	playerId: { type: Schema.Types.ObjectId, ref: 'Player' },  // for draft, auction, contract
	salary: { type: Number },  // for draft, auction, contract

	// FA transaction fields (type: 'fa')
	adds: [faAddSchema],
	drops: [faDropSchema],
	facilitatedTradeId: { type: Schema.Types.ObjectId, ref: 'Transaction' },
	fixupRef: { type: Number },  // stable ID for fixup targeting, assigned during seeding

	// Draft fields
	pickId: { type: Schema.Types.ObjectId, ref: 'Pick' },

	// Auction fields
	winningBid: { type: Number },
	originalBidderId: { type: Schema.Types.ObjectId, ref: 'Franchise' },
	rfaHolderId: { type: Schema.Types.ObjectId, ref: 'Franchise' },

	// Contract fields
	startYear: { type: Number },
	endYear: { type: Number }
});

transactionSchema.index({ type: 1 });
transactionSchema.index({ timestamp: 1 });
transactionSchema.index({ franchiseId: 1 });
transactionSchema.index({ playerId: 1 });
transactionSchema.index({ tradeId: 1 }, { sparse: true });
transactionSchema.index({ 'parties.franchiseId': 1 });
transactionSchema.index({ 'adds.playerId': 1 });
transactionSchema.index({ 'drops.playerId': 1 });

module.exports = mongoose.model('Transaction', transactionSchema);

