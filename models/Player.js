var mongoose = require('mongoose');
var crypto = require('crypto');
var Schema = mongoose.Schema;

var playerSchema = new Schema({
	sleeperId: { type: String, default: null },
	name: { type: String, required: true },
	slugs: [{ type: String }], // URL-friendly slugs (e.g., ["josh-allen-a3f2"])
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
playerSchema.index({ slugs: 1 });

// Generate a URL-friendly base slug from a player name
// e.g., "Josh Allen" -> "josh-allen", "Odell Beckham Jr." -> "odell-beckham-jr"
function generateBaseSlug(name) {
	if (!name) return null;
	return name
		.toLowerCase()
		.replace(/['']/g, '')           // Remove apostrophes (O'Brien -> obrien)
		.replace(/[^a-z0-9\s-]/g, '')   // Remove non-alphanumeric except spaces/hyphens
		.replace(/\s+/g, '-')           // Replace spaces with hyphens
		.replace(/-+/g, '-')            // Collapse multiple hyphens
		.replace(/^-|-$/g, '');         // Trim leading/trailing hyphens
}

// Generate a 4-character hash from a string
function generateHash(str) {
	if (!str) return null;
	return crypto.createHash('md5').update(str).digest('hex').substring(0, 4);
}

// Generate the full unique slug: base-slug + 4-char hash
// Hash source: sleeperId for Sleeper players, name for historical players
function generateUniqueSlug(name, sleeperId) {
	var baseSlug = generateBaseSlug(name);
	if (!baseSlug) return null;
	var hashSource = sleeperId || name;
	var hash = generateHash(hashSource);
	return baseSlug + '-' + hash;
}

// Expose as static methods
playerSchema.statics.generateBaseSlug = generateBaseSlug;
playerSchema.statics.generateHash = generateHash;
playerSchema.statics.generateUniqueSlug = generateUniqueSlug;

// Auto-generate slug on save when name is set or changes
playerSchema.pre('save', function(next) {
	if (this.isNew || this.isModified('name')) {
		var newSlug = generateUniqueSlug(this.name, this.sleeperId);
		if (newSlug && !this.slugs.includes(newSlug)) {
			// Add new slug to front of array (primary slug)
			this.slugs.unshift(newSlug);
		}
	}
	next();
});

// Find players by slug - exact match or prefix match
// Returns players where any slug matches exactly or starts with the input
playerSchema.statics.findBySlug = function(slug) {
	return this.find({
		$or: [
			{ slugs: slug },                              // Exact match
			{ slugs: { $regex: '^' + slug + '-[a-f0-9]{4}$' } }  // Prefix match (name without hash)
		]
	}).lean();
};

module.exports = mongoose.model('Player', playerSchema);

