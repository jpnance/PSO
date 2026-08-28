// Regime tenure lookup utilities
//
// All functions operate on a pre-loaded regimes array (from Regime.find({}).lean()).
// This avoids per-lookup DB queries when multiple lookups are needed in one request.

/**
 * Find the regime that owned a franchise in a given season.
 * Returns the full regime object, or null if not found.
 */
function getRegime(regimes, franchiseId, season) {
	if (!franchiseId) return null;
	var fIdStr = franchiseId.toString();
	return regimes.find(function(r) {
		return r.tenures && r.tenures.some(function(t) {
			return t.franchiseId.toString() === fIdStr &&
				t.startSeason <= season &&
				(t.endSeason === null || t.endSeason >= season);
		});
	}) || null;
}

/**
 * Get the regime display name for a franchise in a given season.
 * Returns the string name, or fallback (default 'Unknown').
 */
function getRegimeName(regimes, franchiseId, season, fallback) {
	var regime = getRegime(regimes, franchiseId, season);
	return regime ? regime.displayName : (fallback !== undefined ? fallback : 'Unknown');
}

/**
 * Build a map of { franchiseId: regimeDisplayName } for all franchises active in a season.
 * Much more efficient than calling getRegimeName in a loop.
 */
function buildRegimeMap(regimes, season) {
	var map = {};
	regimes.forEach(function(r) {
		if (!r.tenures) return;
		r.tenures.forEach(function(t) {
			if (t.startSeason <= season && (t.endSeason === null || t.endSeason >= season)) {
				map[t.franchiseId.toString()] = r.displayName;
			}
		});
	});
	return map;
}

module.exports = {
	getRegime: getRegime,
	getRegimeName: getRegimeName,
	buildRegimeMap: buildRegimeMap
};
