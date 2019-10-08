var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var gameSchema = new Schema({
	season: { type: Number, required: true },
	week: { type: Number, required: true },
	type: { type: String, required: true },
	away: {
		franchiseId: { type: Number, required: true },
		name: { type: String, required: true },
		score: { type: Number },
		record: {
			allPlay: {
				week: {
					wins: { type: Number },
					losses: { type: Number },
					ties: { type: Number }
				},
				cumulative: {
					wins: { type: Number },
					losses: { type: Number },
					ties: { type: Number }
				}
			},
			stern: {
				week: {
					wins: { type: Number },
					losses: { type: Number },
					ties: { type: Number }
				},
				cumulative: {
					wins: { type: Number },
					losses: { type: Number },
					ties: { type: Number }
				}
			},
			straight: {
				week: {
					wins: { type: Number },
					losses: { type: Number },
					ties: { type: Number }
				},
				cumulative: {
					wins: { type: Number },
					losses: { type: Number },
					ties: { type: Number }
				}
			}
		}
	},
	home: {
		franchiseId: { type: Number, required: true },
		name: { type: String, required: true },
		score: { type: Number },
		record: {
			allPlay: {
				week: {
					wins: { type: Number },
					losses: { type: Number },
					ties: { type: Number }
				},
				cumulative: {
					wins: { type: Number },
					losses: { type: Number },
					ties: { type: Number }
				}
			},
			stern: {
				week: {
					wins: { type: Number },
					losses: { type: Number },
					ties: { type: Number }
				},
				cumulative: {
					wins: { type: Number },
					losses: { type: Number },
					ties: { type: Number }
				}
			},
			straight: {
				week: {
					wins: { type: Number },
					losses: { type: Number },
					ties: { type: Number }
				},
				cumulative: {
					wins: { type: Number },
					losses: { type: Number },
					ties: { type: Number }
				}
			}
		}
	}
});

module.exports = mongoose.model('Game', gameSchema);
