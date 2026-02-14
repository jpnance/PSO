var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var contractSchema = new Schema({
	playerId: { type: Schema.Types.ObjectId, ref: 'Player', required: true },
	franchiseId: { type: Schema.Types.ObjectId, ref: 'Franchise', required: true },
	// salary is null for RFA rights (player not under contract, just rights held)
	salary: { type: Number, default: null },
	startYear: { type: Number },
	endYear: { type: Number },
	// Offseason cut marking (owner intent, not yet executed)
	markedForCut: { type: Boolean, default: false },
	markedForCutAt: { type: Date, default: null }
});

contractSchema.index({ franchiseId: 1 });
contractSchema.index({ playerId: 1 }, { unique: true });
contractSchema.index({ endYear: 1 });

module.exports = mongoose.model('Contract', contractSchema);

