// change {SEASON} to the current season in the command below
//
// from the current directory:
// curl "https://api.sleeper.com/projections/nfl/{SEASON}/?season_type=regular&position[]=DB&position[]=DL&position[]=K&position[]=LB&position[]=QB&position[]=RB&position[]=TE&position[]=WR&position[]=LB&position[]=DB&position[]=DL&order_by=pts_dynasty_2qb" > ../public/data/sleeper-projections.json

const projections = require('../public/data/sleeper-projections.json');

const drillDown = function(player, path) {
	var value = player;
	var hierarchy = path.split('.');

	hierarchy.forEach(tier => {
		value = value[tier];
	});

	return value;
};

const fields = {
	player_id: {
		fieldName: 'player_id'
	},
	first_name: {
		fieldName: 'player.first_name'
	},
	last_name: {
		fieldName: 'player.last_name'
	},
	team: {
		fieldName: 'player.team'
	},
	fantasy_positions: {
		fieldName: 'player.fantasy_positions',
		sanitize: (value) => {
			return value.map((position) => positionMap[position] || position).join('/');
		}
	},
	/*
	position: {
		fieldName: 'player.position',
		sanitize: (value) => {
			const uppercaseValue = value.toUpperCase();

			return positionMap[uppercaseValue] || uppercaseValue;
		}
	},
	*/
	years_exp: {
		fieldName: 'player.years_exp'
	},
	adp_dynasty_2qb: {
		fieldName: 'stats.adp_dynasty_2qb'
	},
	adp_idp: {
		fieldName: 'stats.adp_idp'
	},
	pass_yd: {
		fieldName: 'stats.pass_yd'
	},
	pass_td: {
		fieldName: 'stats.pass_td'
	},
	pass_int: {
		fieldName: 'stats.pass_int'
	},
	pass_2pt: {
		fieldName: 'stats.pass_2pt'
	},
	rush_yd: {
		fieldName: 'stats.rush_yd'
	},
	rush_td: {
		fieldName: 'stats.rush_td'
	},
	rec_yd: {
		fieldName: 'stats.rec_yd'
	},
	rec_td: {
		fieldName: 'stats.rec_td'
	},
	fum_lost: {
		fieldName: 'stats.fum_lost'
	},
	idp_tkl_solo: {
		fieldName: 'stats.idp_tkl_solo'
	},
	idp_tkl_ast: {
		fieldName: 'stats.idp_tkl_ast'
	},
	idp_sack: {
		fieldName: 'stats.idp_sack'
	},
	idp_int: {
		fieldName: 'stats.idp_int'
	},
	idp_ff: {
		fieldName: 'stats.idp_ff'
	},
	idp_fum_rec: {
		fieldName: 'stats.idp_fum_rec'
	},
	pass_int_td: {
		fieldName: 'stats.pass_int_td'
	},
	pso_pts: {
		fieldName: 'stats.pso_pts'
	}
};

const scoringSystem = {
	pass_yd: 0.04,
	pass_td: 4.0,
	pass_int: -2.0,
	pass_2pt: 2.0,
	rush_yd: 0.1,
	rush_td: 6.0,
	rec_yd: 0.1,
	rec_td: 6.0,
	fum_lost: -1.0,
	idp_tkl_solo: 1.0,
	idp_tkl_ast: 0.5,
	idp_sack: 3.5,
	idp_int: 3.0,
	idp_ff: 3.0,
	idp_fum_rec: 1.0,
	pass_int_td: 6.0
};

const positionMap = {
	CB: 'DB',
	DE: 'DL',
	DT: 'DL',
	FB: 'RB',
	FS: 'DB',
	ILB: 'LB',
	OLB: 'LB',
	NT: 'DL',
	S: 'DB',
	SS: 'DB',
};

let data = [];

data.push(Object.keys(fields));

projections.forEach((player) => {
	let psoPoints = 0.0;

	Object.keys(scoringSystem).forEach((category) => {
		if (player.stats[category]) {
			psoPoints += scoringSystem[category] * player.stats[category];
		}
	});

	player.stats.pso_pts = psoPoints.toFixed(2);
});

projections.forEach((player) => {
	let playerData = [];

	Object.keys(fields).forEach((key) => {
		const columnData = fields[key];
		let jsonValue = drillDown(player, columnData.fieldName);

		if (columnData.sanitize) {
			jsonValue = columnData.sanitize(jsonValue);
		}

		playerData.push(jsonValue);
	});

	data.push(playerData);
});

data.forEach((row) => {
	console.log(row.join(','));
});
