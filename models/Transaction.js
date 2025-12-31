var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var deadMoneySchema = new Schema({
	season: { type: Number, required: true },
	amount: { type: Number, required: true }
}, { _id: false });

var droppedPlayerSchema = new Schema({
	playerId: { type: Schema.Types.ObjectId, ref: 'Player', required: true },
	deadMoney: [deadMoneySchema]
}, { _id: false });

var tradePlayerSchema = new Schema({
	playerId: { type: Schema.Types.ObjectId, ref: 'Player', required: true },
	salary: { type: Number },
	startYear: { type: Number },
	endYear: { type: Number },
	rfaRights: { type: Boolean, default: false }
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
	},
	drops: [droppedPlayerSchema]
}, { _id: false });

var transactionSchema = new Schema({
	type: {
		type: String,
		enum: [
			'trade',
			'fa-pickup',
			'fa-cut',
			'draft-select',
			'draft-pass',
			'auction-ufa',
			'auction-rfa-matched',
			'auction-rfa-unmatched',
			'contract'
		],
		required: true
	},
	timestamp: { type: Date, required: true },
	source: {
		type: String,
		enum: ['wordpress', 'sleeper', 'manual', 'snapshot'],
		required: true
	},

	// Trade fields
	wordpressTradeId: { type: Number },
	parties: [tradePartySchema],

	// FA pickup fields
	franchiseId: { type: Schema.Types.ObjectId, ref: 'Franchise' },
	playerId: { type: Schema.Types.ObjectId, ref: 'Player' },
	salary: { type: Number },
	dropped: droppedPlayerSchema,

	// FA cut fields (uses franchiseId, playerId from above)
	deadMoney: [deadMoneySchema],

	// Draft fields (uses franchiseId, playerId, salary from above)
	pickId: { type: Schema.Types.ObjectId, ref: 'Pick' },

	// Auction fields (uses franchiseId, playerId from above)
	winningBid: { type: Number },
	originalBidderId: { type: Schema.Types.ObjectId, ref: 'Franchise' },
	rfaHolderId: { type: Schema.Types.ObjectId, ref: 'Franchise' },

	// Contract fields (uses franchiseId, playerId, salary from above)
	startYear: { type: Number },
	endYear: { type: Number }
});

transactionSchema.index({ type: 1 });
transactionSchema.index({ timestamp: 1 });
transactionSchema.index({ franchiseId: 1 });
transactionSchema.index({ playerId: 1 });
transactionSchema.index({ wordpressTradeId: 1 }, { sparse: true });
transactionSchema.index({ 'parties.franchiseId': 1 });

module.exports = mongoose.model('Transaction', transactionSchema);

