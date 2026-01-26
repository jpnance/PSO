var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var tenureSchema = new Schema({
	franchiseId: { type: Schema.Types.ObjectId, ref: 'Franchise', required: true },
	startSeason: { type: Number, required: true },
	endSeason: { type: Number, default: null }
}, { _id: false });

var regimeSchema = new Schema({
	displayName: { type: String, required: true },
	ownerIds: [{ type: Schema.Types.ObjectId, ref: 'Person' }],
	tenures: [tenureSchema]
});

regimeSchema.index({ displayName: 1 });
regimeSchema.index({ ownerIds: 1 });
regimeSchema.index({ 'tenures.franchiseId': 1 });

// Sort owner names alphabetically
function sortOwnerNamesAlphabetically(names) {
	if (!names || names.length === 0) return [];
	return names.slice().sort(function(a, b) {
		return a.localeCompare(b);
	});
}

// ----- Instance methods -----

// Get owner names sorted alphabetically
regimeSchema.methods.getSortedOwnerNames = function() {
	if (!this.ownerIds || this.ownerIds.length === 0) return [];
	
	var names = this.ownerIds
		.filter(function(o) { return o && o.name; })
		.map(function(o) { return o.name; });
	
	return sortOwnerNamesAlphabetically(names);
};

// Check if regime is currently active (any tenure with no endSeason)
regimeSchema.methods.isActive = function() {
	return this.tenures.some(function(t) { return t.endSeason === null; });
};

// Get the tenure for a specific season (if any)
regimeSchema.methods.getTenureAt = function(season) {
	return this.tenures.find(function(t) {
		return t.startSeason <= season && (t.endSeason === null || t.endSeason >= season);
	});
};

// Check if this regime controlled a specific franchise at a specific season
regimeSchema.methods.controlledFranchise = function(franchiseId, season) {
	var fIdStr = franchiseId.toString();
	return this.tenures.some(function(t) {
		var matchesFranchise = t.franchiseId.toString() === fIdStr;
		var matchesSeason = t.startSeason <= season && (t.endSeason === null || t.endSeason >= season);
		return matchesFranchise && matchesSeason;
	});
};

// ----- Static methods -----

// Helper for lean objects (since instance methods don't work on lean)
regimeSchema.statics.sortOwnerNames = function(ownerIds) {
	if (!ownerIds || ownerIds.length === 0) return [];
	
	var names = ownerIds
		.filter(function(o) { return o && o.name; })
		.map(function(o) { return o.name; });
	
	return sortOwnerNamesAlphabetically(names);
};

// Find the regime that controlled a franchise at a given season
regimeSchema.statics.findByFranchiseAndSeason = async function(franchiseId, season) {
	return this.findOne({
		'tenures': {
			$elemMatch: {
				franchiseId: franchiseId,
				startSeason: { $lte: season },
				$or: [{ endSeason: null }, { endSeason: { $gte: season } }]
			}
		}
	});
};

// Find the regime currently controlling a franchise
regimeSchema.statics.findCurrentByFranchise = async function(franchiseId) {
	return this.findOne({
		'tenures': {
			$elemMatch: {
				franchiseId: franchiseId,
				endSeason: null
			}
		}
	});
};

// Get display name for a franchise at a given season (convenience method)
regimeSchema.statics.getDisplayName = async function(franchiseId, season) {
	var regime = await this.findByFranchiseAndSeason(franchiseId, season);
	return regime ? regime.displayName : 'Unknown';
};

// Find all currently active regimes
regimeSchema.statics.findAllCurrent = async function() {
	return this.find({
		'tenures.endSeason': null
	}).sort({ displayName: 1 });
};

// Check if a regime (lean object) was active and controlled a party franchise at trade time
// Useful for trade filtering with lean query results
regimeSchema.statics.wasPartyAtTime = function(regime, tradeYear, partyFranchiseIds) {
	if (!regime || !regime.tenures) return false;
	
	return regime.tenures.some(function(t) {
		var wasActive = t.startSeason <= tradeYear && (t.endSeason === null || t.endSeason >= tradeYear);
		if (!wasActive) return false;
		return partyFranchiseIds.includes(t.franchiseId.toString());
	});
};

module.exports = mongoose.model('Regime', regimeSchema);
