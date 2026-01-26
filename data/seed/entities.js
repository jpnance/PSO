var dotenv = require('dotenv').config({ path: __dirname + '/../../.env' });
var mongoose = require('mongoose');

var Franchise = require('../../models/Franchise');
var Person = require('../../models/Person');
var Regime = require('../../models/Regime');
var PSO = require('../../config/pso');

mongoose.connect(process.env.MONGODB_URI);

// Map display names to the people involved
var displayNameToOwners = {
	'Patrick': ['Patrick Nance'],
	'Koci/Mueller': ['Chris Koci', 'Michael Mueller'],
	'Luke': ['Luke Zimmermann'],
	'Justin': ['Justin Laurence'],
	'Mike': ['Mike Eckstein'],
	'Keyon': ['Keyon Somandar'],
	'Brett': ['Brett Ludwiczak'],
	'Jason': ['Jason Ridder'],
	'Schexes': ['David Schexnayder', 'Charles Schexnayder'],
	'Anthony': ['Anthony Garcia'],
	'Quinn': ['Quinn Martindale'],
	'Mitch': ['Mitch Mustain'],
	'Charles': ['Charles Schexnayder'],
	'Daniel': ['Daniel Grysen'],
	'James': ['James Reynolds'],
	'Jeff': ['Jeff Arbor'],
	'John': ['John McKee'],
	'Schex': ['David Schexnayder'],
	'Syed': ['Syed Ashrafulla'],
	'Terence': ['Terence Man'],
	'Trevor': ['Trevor Highland'],
	'Brett/Luke': ['Brett Ludwiczak', 'Luke Zimmermann'],
	'Jake/Luke': ['Jake Kothmayer', 'Luke Zimmermann'],
	'James/Charles': ['James Reynolds', 'Charles Schexnayder'],
	'John/Zach': ['John McKee', 'Zach Summers'],
	'Koci': ['Chris Koci'],
	'Mitch/Mike': ['Mitch Mustain', 'Mike Eckstein'],
	'Pat/Quinn': ['Patrick Nance', 'Quinn Martindale'],
	'Schex/Jeff': ['David Schexnayder', 'Jeff Arbor'],
	'Syed/Kuan': ['Syed Ashrafulla', 'Kuan Li'],
	'Syed/Terence': ['Syed Ashrafulla', 'Terence Man']
};

// Extract all unique people from the display names
function getAllPeople() {
	var people = new Set();
	Object.values(displayNameToOwners).forEach(function(owners) {
		owners.forEach(function(owner) {
			people.add(owner);
		});
	});
	return Array.from(people).sort();
}


// Build tenures from the franchiseNames data (one tenure per franchise+time period)
function buildTenures() {
	var tenures = [];

	Object.keys(PSO.franchiseNames).forEach(function(franchiseId) {
		var years = PSO.franchiseNames[franchiseId];
		var sortedYears = Object.keys(years).map(Number).sort(function(a, b) { return a - b; });

		var currentTenure = null;

		sortedYears.forEach(function(year) {
			var displayName = years[year];

			if (!currentTenure || currentTenure.displayName !== displayName) {
				// End the previous tenure
				if (currentTenure) {
					currentTenure.endYear = year - 1;
					tenures.push(currentTenure);
				}

				// Start a new tenure
				currentTenure = {
					franchiseId: parseInt(franchiseId),
					displayName: displayName,
					ownerNames: displayNameToOwners[displayName] || [displayName],
					startYear: year,
					endYear: null
				};
			}
		});

		// Push the final (current) tenure
		if (currentTenure) {
			tenures.push(currentTenure);
		}
	});

	return tenures;
}

// Group tenures by displayName to build regime documents
function buildRegimes(tenures) {
	var regimeMap = {};

	tenures.forEach(function(tenure) {
		var key = tenure.displayName;

		if (!regimeMap[key]) {
			regimeMap[key] = {
				displayName: tenure.displayName,
				ownerNames: tenure.ownerNames,
				tenures: []
			};
		}

		regimeMap[key].tenures.push({
			franchiseId: tenure.franchiseId,
			startYear: tenure.startYear,
			endYear: tenure.endYear
		});
	});

	return Object.values(regimeMap);
}

async function seed() {
	console.log('Seeding entities...\n');

	// Clear existing data (be careful with this!)
	var clearExisting = process.argv.includes('--clear');
	if (clearExisting) {
		console.log('Clearing existing data...');
		await Franchise.deleteMany({});
		await Person.deleteMany({});
		await Regime.deleteMany({});
	}

	// Seed franchises
	console.log('Seeding franchises...');
	var franchiseDocs = {};
	for (var i = 1; i <= 12; i++) {
		var doc = await Franchise.create({
			foundedYear: 2008,
			rosterId: i
		});
		franchiseDocs[i] = doc;
		console.log('  Created franchise', doc._id, '(Sleeper roster', doc.rosterId + ', currently', PSO.franchises[i] + ')');
	}

	// Seed people
	console.log('\nSeeding people...');
	var people = getAllPeople();
	var personMap = {};
	for (var i = 0; i < people.length; i++) {
		var name = people[i];
		var username = Person.generateUsername(name);
		var doc = await Person.create({ name: name, username: username });
		personMap[name] = doc;
		console.log('  Created person', doc.name, '(' + doc.username + ')');
	}

	// Seed regimes
	console.log('\nSeeding regimes...');
	var tenures = buildTenures();
	var regimes = buildRegimes(tenures);
	for (var i = 0; i < regimes.length; i++) {
		var r = regimes[i];
		var regime = {
			displayName: r.displayName,
			ownerIds: r.ownerNames.map(function(name) { return personMap[name]._id; }),
			tenures: r.tenures.map(function(t) {
				return {
					franchiseId: franchiseDocs[t.franchiseId]._id,
					startSeason: t.startYear,
					endSeason: t.endYear
				};
			})
		};
		var doc = await Regime.create(regime);
		var tenureSummary = r.tenures.map(function(t) {
			return 'franchise ' + t.franchiseId + ' (' + t.startYear + '-' + (t.endYear || 'present') + ')';
		}).join(', ');
		console.log('  Created regime:', doc.displayName, '-', tenureSummary);
	}

	console.log('\nDone!');
	console.log('\nSummary:');
	console.log('  Franchises:', Object.keys(franchiseDocs).length);
	console.log('  People:', people.length);
	console.log('  Regimes:', regimes.length, '(with', tenures.length, 'total tenures)');

	process.exit(0);
}

seed().catch(function(err) {
	console.error('Error:', err);
	process.exit(1);
});
