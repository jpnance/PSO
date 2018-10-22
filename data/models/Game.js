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
			},
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
			}
		}
	},
	home: {
		franchiseId: { type: Number, required: true },
		name: { type: String, required: true },
		score: { type: Number },
		record: {
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
			},
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
			}
		}
	},
	winner: {
		franchiseId: { type: Number },
		name: { type: String },
		score: { type: Number },
		record: {
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
			},
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
			}
		}
	},
	loser: {
		franchiseId: { type: Number },
		name: { type: String },
		score: { type: Number },
		record: {
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
			},
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
			}
		}
	},
	tie: { type: Boolean }
});

module.exports = mongoose.model('Game', gameSchema);
