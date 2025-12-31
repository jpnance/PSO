var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var playerSchema = new Schema({
	sleeperId: { type: String, default: null },
	name: { type: String, required: true },
	positions: [{ type: String }]
});

playerSchema.index({ sleeperId: 1 }, { sparse: true });
playerSchema.index({ name: 1 });

module.exports = mongoose.model('Player', playerSchema);

