var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var franchiseSchema = new Schema({
	foundedYear: { type: Number, required: true },
	sleeperRosterId: { type: Number, default: null }
});

module.exports = mongoose.model('Franchise', franchiseSchema);

