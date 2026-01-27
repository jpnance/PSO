var mongoose = require('mongoose');
var Schema = mongoose.Schema;

/**
 * Season model - stores computed season-level data
 * 
 * Populated by data/analysis/seasons.js which runs via cronjob
 * The standings page reads directly from this model
 */

var standingSchema = new Schema({
	rank: { type: Number, required: true },
	franchiseId: { type: Number, required: true },
	franchiseName: { type: String, required: true },
	division: { type: String },           // Only present in division era
	
	// Regular season record
	wins: { type: Number, default: 0 },
	losses: { type: Number, default: 0 },
	ties: { type: Number, default: 0 },
	pointsFor: { type: Number, default: 0 },
	pointsAgainst: { type: Number, default: 0 },
	
	// Alternative records (cumulative through end of regular season)
	allPlay: {
		wins: { type: Number },
		losses: { type: Number },
		ties: { type: Number }
	},
	stern: {
		wins: { type: Number },
		losses: { type: Number },
		ties: { type: Number }
	},
	
	// Playoff qualification (only present when regular season complete)
	playoffSeed: { type: Number },        // 1-4 for playoff teams
	divisionWinner: { type: Boolean },    // Only present when true
	wildCard: { type: Number },           // 1 or 2 for wild card teams
	
	// Playoff performance (only present for playoff teams after games played)
	playoffWins: { type: Number },
	playoffLosses: { type: Number },
	playoffPointsFor: { type: Number },
	playoffPointsAgainst: { type: Number },
	playoffFinish: { type: String }       // 'champion', 'runner-up', 'third-place', 'fourth-place'
}, { _id: false });

var divisionStandingSchema = new Schema({
	name: { type: String, required: true },
	franchiseIds: [{ type: Number }]      // Sorted by division standing
}, { _id: false });

var playoffGameSchema = new Schema({
	type: { type: String, required: true }, // 'semifinal', 'championship', 'thirdPlace'
	away: {
		franchiseId: { type: Number },
		name: { type: String },
		seed: { type: Number },
		score: { type: Number }
	},
	home: {
		franchiseId: { type: Number },
		name: { type: String },
		seed: { type: Number },
		score: { type: Number }
	},
	winner: { type: String }              // 'away' or 'home'
}, { _id: false });

var divisionConfigSchema = new Schema({
	name: { type: String, required: true },
	franchiseIds: [{ type: Number }]
}, { _id: false });

var seasonSchema = new Schema({
	_id: { type: Number, required: true }, // The year (2008, 2009, etc.)
	
	// Full standings (all teams, tiebreaker-applied order)
	standings: [standingSchema],
	
	// Division standings (sorted franchise IDs per division, division era only)
	divisionStandings: [divisionStandingSchema],
	
	// Playoff games with scores
	playoffGames: [playoffGameSchema],
	
	// Season status
	status: {
		regularSeasonComplete: { type: Boolean, default: false },
		playoffsComplete: { type: Boolean, default: false },
		gamesPlayed: { type: Number, default: 0 },
		totalRegularSeasonGames: { type: Number }
	},
	
	// Season configuration
	config: {
		hasDivisions: { type: Boolean, default: false },
		divisions: [divisionConfigSchema],
		tiebreakerAlgorithm: { type: String }, // 'h2h-graduation' or 'h2h-percentage'
		regularSeasonWeeks: { type: Number },
		teamCount: { type: Number }
	}
});

module.exports = mongoose.model('Season', seasonSchema);
