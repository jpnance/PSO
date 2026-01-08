var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var rosterSchema = new Schema({
	franchiseId: { type: Schema.Types.ObjectId, ref: 'Franchise', required: true },
	playerId: { type: Schema.Types.ObjectId, ref: 'Player', required: true },
	acquiredVia: { type: Schema.Types.ObjectId, ref: 'Transaction', required: true }
});

rosterSchema.index({ franchiseId: 1 });
rosterSchema.index({ playerId: 1 }, { unique: true });

module.exports = mongoose.model('Roster', rosterSchema);

