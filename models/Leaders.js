var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var leadersSchema = new Schema({
	_id: { type: String, required: true },
	value: { type: Schema.Types.Mixed, required: true }
});

module.exports = {
	PlayoffAppearances: mongoose.model('PlayoffAppearances', leadersSchema, 'playoffAppearances'),
	RegularSeasonWinningPercentage: mongoose.model('RegularSeasonWinningPercentage', leadersSchema, 'regularSeasonWinningPercentage'),
	RegularSeasonWins: mongoose.model('RegularSeasonWins', leadersSchema, 'regularSeasonWins'),
	WeeklyScoringTitles: mongoose.model('WeeklyScoringTitles', leadersSchema, 'weeklyScoringTitles')
};
