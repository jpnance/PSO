var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var personSchema = new Schema({
	name: { type: String, required: true },
	sleeperUserId: { type: String, default: null },
	email: { type: String, default: null },
	username: { type: String, default: null },
	birthday: { type: String, default: null } // Format: "MM-DD"
});

personSchema.index({ name: 1 }, { unique: true });

// Generate username from full name: "Patrick Nance" → "patrick-nance"
// Also strips apostrophes: "Patrick O'Brien" → "patrick-obrien"
personSchema.statics.generateUsername = function(name) {
	return name.toLowerCase().replace(/\s+/g, '-').replace(/'/g, '');
};

module.exports = mongoose.model('Person', personSchema);

