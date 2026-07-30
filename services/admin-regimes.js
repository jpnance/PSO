var Regime = require('../models/Regime');
var Person = require('../models/Person');
var Franchise = require('../models/Franchise');
var LeagueConfig = require('../models/LeagueConfig');

// GET /admin/regimes - list all regimes
async function listRegimes(request, response) {
	var config = await LeagueConfig.findById('pso');
	var currentSeason = config ? config.season : new Date().getFullYear();

	var regimes = await Regime.find({}).populate('ownerIds').lean();
	var franchises = await Franchise.find({}).lean();

	var franchiseMap = {};
	franchises.forEach(function(f) {
		franchiseMap[f._id.toString()] = f;
	});

	var enrichedRegimes = regimes.map(function(r) {
		var activeTenure = r.tenures.find(function(t) { return t.endSeason === null; });
		var franchise = activeTenure ? franchiseMap[activeTenure.franchiseId.toString()] : null;
		var ownerNames = (r.ownerIds || [])
			.filter(function(o) { return o && o.name; })
			.map(function(o) { return o.name; })
			.sort(function(a, b) { return a.localeCompare(b); });

		return {
			_id: r._id,
			displayName: r.displayName,
			ownerNames: ownerNames,
			ownerCount: ownerNames.length,
			isActive: !!activeTenure,
			franchiseRosterId: franchise ? franchise.rosterId : null,
			tenureCount: r.tenures.length
		};
	}).sort(function(a, b) {
		if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
		return a.displayName.localeCompare(b.displayName);
	});

	response.render('admin-regimes', {
		regimes: enrichedRegimes,
		activePage: 'admin-regimes'
	});
}

// GET /admin/regimes/:id - edit form
async function editRegimeForm(request, response) {
	var regime = await Regime.findById(request.params.id).populate('ownerIds');
	if (!regime) {
		return response.status(404).send('Regime not found');
	}

	var franchises = await Franchise.find({}).lean();
	var allRegimes = await Regime.find({}).lean();

	var franchiseMap = {};
	franchises.forEach(function(f) {
		franchiseMap[f._id.toString()] = f;
	});

	var regimeNameMap = {};
	allRegimes.forEach(function(r) {
		r.tenures.forEach(function(t) {
			var fIdStr = t.franchiseId.toString();
			if (!regimeNameMap[fIdStr]) {
				regimeNameMap[fIdStr] = [];
			}
			regimeNameMap[fIdStr].push({
				displayName: r.displayName,
				startSeason: t.startSeason,
				endSeason: t.endSeason
			});
		});
	});

	var tenures = regime.tenures.map(function(t) {
		var franchise = franchiseMap[t.franchiseId.toString()];
		return {
			franchiseId: t.franchiseId,
			franchiseRosterId: franchise ? franchise.rosterId : null,
			startSeason: t.startSeason,
			endSeason: t.endSeason
		};
	}).sort(function(a, b) {
		return b.startSeason - a.startSeason;
	});

	var isActive = regime.tenures.some(function(t) { return t.endSeason === null; });

	var currentOwnerIds = new Set(
		(regime.ownerIds || []).map(function(o) { return o._id.toString(); })
	);
	var allPeople = await Person.find({}).sort({ name: 1 }).lean();
	var availablePeople = allPeople.filter(function(p) {
		return !currentOwnerIds.has(p._id.toString());
	});

	response.render('admin-regime-edit', {
		regime: regime,
		tenures: tenures,
		isActive: isActive,
		availablePeople: availablePeople,
		query: request.query,
		activePage: 'admin-regimes'
	});
}

// POST /admin/regimes/:id - update display name
async function editRegime(request, response) {
	var regime = await Regime.findById(request.params.id);
	if (!regime) {
		return response.status(404).send('Regime not found');
	}

	var newDisplayName = (request.body.displayName || '').trim();
	if (!newDisplayName) {
		return response.status(400).send('Display name is required');
	}

	regime.displayName = newDisplayName;
	await regime.save();

	response.redirect('/admin/regimes/' + regime._id + '?saved=1');
}

// POST /admin/regimes/:id/add-owner - add a person as co-owner
async function addOwner(request, response) {
	var regime = await Regime.findById(request.params.id);
	if (!regime) {
		return response.status(404).send('Regime not found');
	}

	var personId = request.body.personId;
	if (!personId) {
		return response.status(400).send('Person is required');
	}

	var person = await Person.findById(personId);
	if (!person) {
		return response.status(404).send('Person not found');
	}

	var alreadyOwner = regime.ownerIds.some(function(id) {
		return id.toString() === personId;
	});

	if (!alreadyOwner) {
		regime.ownerIds.push(person._id);
		await regime.save();
	}

	response.redirect('/admin/regimes/' + regime._id + '?saved=1');
}

// POST /admin/regimes/:id/remove-owner - remove a person from ownership
async function removeOwner(request, response) {
	var regime = await Regime.findById(request.params.id);
	if (!regime) {
		return response.status(404).send('Regime not found');
	}

	var personId = request.body.personId;
	if (!personId) {
		return response.status(400).send('Person is required');
	}

	regime.ownerIds = regime.ownerIds.filter(function(id) {
		return id.toString() !== personId;
	});
	await regime.save();

	response.redirect('/admin/regimes/' + regime._id + '?saved=1');
}

module.exports = {
	listRegimes: listRegimes,
	editRegimeForm: editRegimeForm,
	editRegime: editRegime,
	addOwner: addOwner,
	removeOwner: removeOwner
};
