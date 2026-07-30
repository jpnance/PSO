var Person = require('../models/Person');
var Regime = require('../models/Regime');
var Season = require('../models/Season');

// GET /admin/people - list all people
async function listPeople(request, response) {
	var people = await Person.find({}).sort({ name: 1 }).lean();
	
	// Get regimes to show which people are active owners
	var regimes = await Regime.find({}).populate('ownerIds').lean();
	
	// Build a map of person ID to their regime info
	var personRegimeMap = {};
	regimes.forEach(function(r) {
		var isActive = r.tenures.some(function(t) { return t.endSeason === null; });
		r.ownerIds.forEach(function(owner) {
			if (owner && owner._id) {
				var ownerId = owner._id.toString();
				if (!personRegimeMap[ownerId]) {
					personRegimeMap[ownerId] = [];
				}
				personRegimeMap[ownerId].push({
					displayName: r.displayName,
					isActive: isActive
				});
			}
		});
	});
	
	// Enrich people with regime info
	var enrichedPeople = people.map(function(p) {
		var regimes = personRegimeMap[p._id.toString()] || [];
		var activeRegime = regimes.find(function(r) { return r.isActive; });
		return {
			_id: p._id,
			name: p.name,
			email: p.email,
			birthday: p.birthday,
			sleeperUserId: p.sleeperUserId,
			isActiveOwner: !!activeRegime,
			regimeNames: regimes.map(function(r) { return r.displayName; }).join(', ')
		};
	});
	
	response.render('admin-people', {
		people: enrichedPeople,
		activePage: 'admin-people'
	});
}

// GET /admin/people/:id - edit form
async function editPersonForm(request, response) {
	var person = await Person.findById(request.params.id).lean();
	
	if (!person) {
		return response.status(404).send('Person not found');
	}
	
	// Get regimes this person is part of
	var regimes = await Regime.find({ ownerIds: person._id }).lean();
	
	// Get championship count for this person
	// Find all seasons where a franchise they owned won
	var championships = [];
	if (regimes.length > 0) {
		var seasons = await Season.find({}).lean();
		
		regimes.forEach(function(regime) {
			regime.tenures.forEach(function(tenure) {
				seasons.forEach(function(season) {
					// Check if this tenure covers this season
					if (tenure.startSeason <= season._id && 
						(tenure.endSeason === null || tenure.endSeason >= season._id)) {
						// Check if this franchise won
						var champion = season.standings.find(function(s) {
							return s.playoffFinish === 'champion' && 
								s.franchiseId === tenure.franchiseId;
						});
						if (champion) {
							championships.push({
								season: season._id,
								regimeName: regime.displayName
							});
						}
					}
				});
			});
		});
	}
	
	response.render('admin-person-edit', {
		person: person,
		regimes: regimes,
		championships: championships,
		query: request.query,
		activePage: 'admin-people'
	});
}

// GET /admin/people/new - new person form
async function newPersonForm(request, response) {
	response.render('admin-person-new', {
		activePage: 'admin-people'
	});
}

// POST /admin/people/new - create person
async function createPerson(request, response) {
	var body = request.body;
	var name = (body.name || '').trim();

	if (!name) {
		return response.status(400).send('Name is required');
	}

	var existing = await Person.findOne({ name: name });
	if (existing) {
		return response.status(400).send('A person named "' + name + '" already exists');
	}

	var username = Person.generateUsername(name);

	var personData = {
		name: name,
		username: username,
		email: (body.email || '').trim() || null,
		sleeperUserId: (body.sleeperUserId || '').trim() || null,
		birthday: null
	};

	var birthday = (body.birthday || '').trim();
	if (birthday) {
		var match = birthday.match(/^(\d{2})-(\d{2})$/);
		if (match) {
			var month = parseInt(match[1], 10);
			var day = parseInt(match[2], 10);
			if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
				personData.birthday = birthday;
			}
		}
	}

	var person = await Person.create(personData);
	response.redirect('/admin/people/' + person._id + '?saved=1');
}

// POST /admin/people/:id - save changes
async function editPerson(request, response) {
	var personId = request.params.id;
	var body = request.body;
	
	var person = await Person.findById(personId);
	if (!person) {
		return response.status(404).send('Person not found');
	}
	
	// Update name
	var newName = (body.name || '').trim();
	if (newName && newName !== person.name) {
		person.name = newName;
	}
	
	// Update email
	var newEmail = (body.email || '').trim();
	person.email = newEmail || null;
	
	// Update birthday (MM-DD format)
	var newBirthday = (body.birthday || '').trim();
	// Validate format if provided
	if (newBirthday) {
		var match = newBirthday.match(/^(\d{2})-(\d{2})$/);
		if (match) {
			var month = parseInt(match[1], 10);
			var day = parseInt(match[2], 10);
			if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
				person.birthday = newBirthday;
			}
		}
	} else {
		person.birthday = null;
	}
	
	// Update sleeperUserId
	var newSleeperUserId = (body.sleeperUserId || '').trim();
	person.sleeperUserId = newSleeperUserId || null;
	
	await person.save();
	
	response.redirect('/admin/people/' + personId + '?saved=1');
}

module.exports = {
	listPeople: listPeople,
	newPersonForm: newPersonForm,
	createPerson: createPerson,
	editPersonForm: editPersonForm,
	editPerson: editPerson
};
