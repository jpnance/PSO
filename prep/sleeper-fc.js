const fs = require('fs');
const https = require('https');

const LEAGUE_ID = '1385361367577407488';
const PLAYERS_FILE = './clubsoccer-epl-players.json';
const SPORT = 'clubsoccer:epl';
const POSITIONS = ['D', 'F', 'GK', 'M'];
const STATS_SEASONS = [2023, 2024, 2025];
const PROJ_SEASON = 2026;

function fetch(url) {
	return new Promise((resolve, reject) => {
		https.get(url, (res) => {
			let data = '';
			res.on('data', (chunk) => { data += chunk; });
			res.on('end', () => {
				try { resolve(JSON.parse(data)); }
				catch (e) { reject(new Error('Failed to parse: ' + url)); }
			});
		}).on('error', reject);
	});
}

function buildPositionQuery() {
	return POSITIONS.map((p) => 'position[]=' + p).join('&');
}

function computeCustomPoints(stats, scoringSettings) {
	let total = 0;

	Object.keys(scoringSettings).forEach((key) => {
		if (stats[key]) {
			total += stats[key] * scoringSettings[key];
		}
	});

	return total;
}

function escapeCsv(value) {
	if (value == null) return '';
	var str = String(value);
	if (str.includes(',') || str.includes('"') || str.includes('\n')) {
		return '"' + str.replace(/"/g, '""') + '"';
	}
	return str;
}

async function main() {
	var statsUrl = 'https://api.sleeper.com/stats/' + SPORT + '/';
	var posQuery = buildPositionQuery();

	var fetches = [
		fetch('https://api.sleeper.app/v1/league/' + LEAGUE_ID),
		fetch('https://api.sleeper.com/projections/' + SPORT + '/' + PROJ_SEASON + '?season_type=regular&' + posQuery + '&order_by=pts_std'),
	];

	STATS_SEASONS.forEach((season) => {
		fetches.push(fetch(statsUrl + season + '?season_type=regular&' + posQuery + '&order_by=pts_std'));
	});

	var results = await Promise.all(fetches);

	var league = results[0];
	var projData = results[1];
	var scoring = league.scoring_settings;

	var allPlayers = JSON.parse(fs.readFileSync(PLAYERS_FILE, 'utf-8'));

	var statsBySeason = {};
	STATS_SEASONS.forEach((season, i) => {
		statsBySeason[season] = {};
		results[i + 2].forEach((entry) => {
			statsBySeason[season][entry.player_id] = entry;
		});
	});

	var projById = {};
	projData.forEach((entry) => {
		projById[entry.player_id] = entry;
	});

	var allPlayerIds = new Set(Object.keys(projById));
	STATS_SEASONS.forEach((season) => {
		Object.keys(statsBySeason[season]).forEach((id) => allPlayerIds.add(id));
	});

	var rows = [];

	allPlayerIds.forEach((id) => {
		var proj = projById[id];

		var source = proj;
		if (!source) {
			for (var i = STATS_SEASONS.length - 1; i >= 0; i--) {
				if (statsBySeason[STATS_SEASONS[i]][id]) {
					source = statsBySeason[STATS_SEASONS[i]][id];
					break;
				}
			}
		}

		var player = source.player;

		var name = (player.metadata && player.metadata.full_name)
			|| ((player.first_name || '') + ' ' + (player.last_name || '')).trim();

		var age = allPlayers[id] ? (allPlayers[id].age || '') : '';

		var row = {
			player_id: id,
			name: name,
			age: age,
			position: player.position,
			team: player.team_abbr || '',
			injury_status: player.injury_status || '',
		};

		STATS_SEASONS.forEach((season) => {
			var stat = statsBySeason[season][id];
			row['stats_gp_' + season] = stat ? (stat.stats.gp || 0) : '';
			row['stats_pts_' + season] = stat ? computeCustomPoints(stat.stats, scoring).toFixed(1) : '';
		});

		row.proj_gp = proj ? (proj.stats.gp || 0) : '';
		row.proj_pts = proj ? computeCustomPoints(proj.stats, scoring).toFixed(1) : '';
		row.adp = proj ? (proj.stats.adp_std || '') : '';

		rows.push(row);
	});

	rows.sort((a, b) => {
		var aVal = parseFloat(a.proj_pts) || 0;
		var bVal = parseFloat(b.proj_pts) || 0;
		return bVal - aVal;
	});

	var headers = ['Player ID', 'Name', 'Age', 'Pos', 'Team', 'Injury'];

	STATS_SEASONS.forEach((season) => {
		headers.push(season + ' GP', season + ' Pts');
	});

	headers.push(PROJ_SEASON + ' GP', PROJ_SEASON + ' Pts', 'ADP');

	console.log(headers.join(','));

	rows.forEach((row) => {
		var fields = [
			row.player_id,
			escapeCsv(row.name),
			row.age,
			row.position,
			row.team,
			row.injury_status,
		];

		STATS_SEASONS.forEach((season) => {
			fields.push(row['stats_gp_' + season], row['stats_pts_' + season]);
		});

		fields.push(row.proj_gp, row.proj_pts, row.adp);

		console.log(fields.join(','));
	});
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
