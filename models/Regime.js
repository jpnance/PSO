var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var regimeSchema = new Schema({
	franchiseId: { type: Schema.Types.ObjectId, ref: 'Franchise', required: true },
	displayName: { type: String, required: true },
	ownerIds: [{ type: Schema.Types.ObjectId, ref: 'Person' }],
	startSeason: { type: Number, required: true },
	endSeason: { type: Number, default: null }
});

regimeSchema.index({ franchiseId: 1 });
regimeSchema.index({ displayName: 1 });
regimeSchema.index({ ownerIds: 1 });

// Sort owner names alphabetically
function sortOwnerNamesAlphabetically(names) {
	if (!names || names.length === 0) return [];
	return names.slice().sort(function(a, b) {
		return a.localeCompare(b);
	});
}

// Get owner names sorted alphabetically
// Works on both populated documents and lean objects
regimeSchema.methods.getSortedOwnerNames = function() {
	if (!this.ownerIds || this.ownerIds.length === 0) return [];
	
	// Handle both populated (objects with .name) and unpopulated (ObjectIds)
	var names = this.ownerIds
		.filter(function(o) { return o && o.name; })
		.map(function(o) { return o.name; });
	
	return sortOwnerNamesAlphabetically(names);
};

// Static helper for lean objects (since methods don't work on lean)
regimeSchema.statics.sortOwnerNames = function(ownerIds) {
	if (!ownerIds || ownerIds.length === 0) return [];
	
	var names = ownerIds
		.filter(function(o) { return o && o.name; })
		.map(function(o) { return o.name; });
	
	return sortOwnerNamesAlphabetically(names);
};

module.exports = mongoose.model('Regime', regimeSchema);

