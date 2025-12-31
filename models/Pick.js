var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var pickSchema = new Schema({
	round: { type: Number, required: true },
	season: { type: Number, required: true },
	originalFranchiseId: { type: Schema.Types.ObjectId, ref: 'Franchise', required: true },
	currentFranchiseId: { type: Schema.Types.ObjectId, ref: 'Franchise', required: true },
	status: { 
		type: String, 
		enum: ['available', 'used', 'passed'],
		default: 'available'
	},
	transactionId: { type: Schema.Types.ObjectId, ref: 'Transaction', default: null }
});

pickSchema.index({ season: 1, round: 1 });
pickSchema.index({ originalFranchiseId: 1 });
pickSchema.index({ currentFranchiseId: 1 });
pickSchema.index({ status: 1 });

module.exports = mongoose.model('Pick', pickSchema);

