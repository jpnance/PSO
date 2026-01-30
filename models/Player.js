var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var playerSchema = new Schema({
	sleeperId: { type: String, default: null },
	name: { type: String, required: true },
	positions: [{ type: String }],
	// Synced from Sleeper (for Sleeper-linked players)
	college: { type: String, default: null },
	rookieYear: { type: Number, default: null }, // From metadata.rookie_year only (reliable, ~42% coverage)
	estimatedRookieYear: { type: Number, default: null }, // From birth_date+23 or years_exp (less reliable, ~90% coverage)
	active: { type: Boolean, default: false },
	team: { type: String, default: null },
	searchRank: { type: Number, default: null },
	// Manual field (never overwritten by sync)
	notes: { type: String, default: null }
});

playerSchema.index({ sleeperId: 1 }, { sparse: true });
playerSchema.index({ name: 1 });

module.exports = mongoose.model('Player', playerSchema);

