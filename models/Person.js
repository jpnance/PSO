var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var personSchema = new Schema({
	name: { type: String, required: true },
	sleeperUserId: { type: String, default: null },
	email: { type: String, default: null }
});

personSchema.index({ name: 1 }, { unique: true });

module.exports = mongoose.model('Person', personSchema);

