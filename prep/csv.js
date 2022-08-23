const projections = require('./sleeper-projections.json');

let data = [];

data.push(['player_id', 'first_name', 'last_name', 'team', 'position', 'years_exp', 'adp_dynasty_std', 'adp_idp', 'pts_std']);

projections.forEach((player) => {
	data.push([
		player.player_id,
		player.player.first_name,
		player.player.last_name,
		player.player.team,
		player.player.position,
		player.player.years_exp,
		player.stats.adp_dynasty_std,
		player.stats.adp_rookie,
		player.stats.adp_idp,
		player.stats.pts_std
	]);
});

data.forEach((row) => {
	console.log(row.join(','));
});
