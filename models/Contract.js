var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var contractSchema = new Schema({
	playerId: { type: Schema.Types.ObjectId, ref: 'Player', required: true },
	franchiseId: { type: Schema.Types.ObjectId, ref: 'Franchise', required: true },
	salary: { type: Number, required: true },
	startYear: { type: Number },
	endYear: { type: Number }
});

contractSchema.index({ franchiseId: 1 });
contractSchema.index({ playerId: 1 }, { unique: true });
contractSchema.index({ endYear: 1 });

module.exports = mongoose.model('Contract', contractSchema);

