var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var playerSchema = new Schema({
	sleeperId: { type: String, default: null },
	name: { type: String, required: true },
	slug: { type: String, default: null }, // URL-friendly name (e.g., "josh-allen")
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
playerSchema.index({ slug: 1 });

// Generate a URL-friendly slug from a player name
// e.g., "Josh Allen" -> "josh-allen", "Odell Beckham Jr." -> "odell-beckham-jr"
function generateSlug(name) {
	if (!name) return null;
	return name
		.toLowerCase()
		.replace(/['']/g, '')           // Remove apostrophes (O'Brien -> obrien)
		.replace(/[^a-z0-9\s-]/g, '')   // Remove non-alphanumeric except spaces/hyphens
		.replace(/\s+/g, '-')           // Replace spaces with hyphens
		.replace(/-+/g, '-')            // Collapse multiple hyphens
		.replace(/^-|-$/g, '');         // Trim leading/trailing hyphens
}

// Expose as static method for manual use
playerSchema.statics.generateSlug = generateSlug;

// Auto-generate slug on save when name is set or changes
playerSchema.pre('save', function(next) {
	if (this.isNew || this.isModified('name')) {
		this.slug = generateSlug(this.name);
	}
	next();
});

// Find players by slug (for disambiguation lookups)
playerSchema.statics.findBySlug = function(slug) {
	return this.find({ slug: slug }).lean();
};

module.exports = mongoose.model('Player', playerSchema);

