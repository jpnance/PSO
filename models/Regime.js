var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var regimeSchema = new Schema({
	franchiseId: { type: Schema.Types.ObjectId, ref: 'Franchise', required: true },
	displayName: { type: String, required: true },
	ownerIds: [{ type: Schema.Types.ObjectId, ref: 'Person' }],
	startSeason: { type: Number, required: true },
	endSeason: { type: Number, default: null }
});

regimeSchema.index({ franchiseId: 1 });
regimeSchema.index({ displayName: 1 });
regimeSchema.index({ ownerIds: 1 });

module.exports = mongoose.model('Regime', regimeSchema);

