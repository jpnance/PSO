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
	player_id: 'player_id',
	first_name: 'player.first_name',
	last_name: 'player.last_name',
	team: 'player.team',
	position: 'player.position',
	years_exp: 'player.years_exp',
	adp_dynasty_2qb: 'stats.adp_dynasty_2qb',
	adp_idp: 'stats.adp_idp',
	pass_yd: 'stats.pass_yd',
	pass_td: 'stats.pass_td',
	pass_int: 'stats.pass_int',
	pass_2pt: 'stats.pass_2pt',
	rush_yd: 'stats.rush_yd',
	rush_td: 'stats.rush_td',
	rec_yd: 'stats.rec_yd',
	rec_td: 'stats.rec_td',
	fum_lost: 'stats.fum_lost',
	idp_tkl_solo: 'stats.idp_tkl_solo',
	idp_tkl_ast: 'stats.idp_tkl_ast',
	idp_sack: 'stats.idp_sack',
	idp_int: 'stats.idp_int',
	idp_ff: 'stats.idp_ff',
	idp_fum_rec: 'stats.idp_fum_rec',
	pass_int_td: 'stats.pass_int_td',
	pso_pts: 'stats.pso_pts',
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
		const jsonValue = drillDown(player, fields[key]);
		playerData.push(jsonValue);
	});

	data.push(playerData);
});

data.forEach((row) => {
	console.log(row.join(','));
});
