var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var budgetSchema = new Schema({
	franchiseId: { type: Schema.Types.ObjectId, ref: 'Franchise', required: true },
	season: { type: Number, required: true },
	baseAmount: { type: Number, default: 1000 },
	payroll: { type: Number, default: 0 },
	buyOuts: { type: Number, default: 0 },
	cashIn: { type: Number, default: 0 },
	cashOut: { type: Number, default: 0 },
	available: { type: Number, default: 1000 },
	recoverable: { type: Number, default: 0 }
});

budgetSchema.index({ franchiseId: 1, season: 1 }, { unique: true });

module.exports = mongoose.model('Budget', budgetSchema);

