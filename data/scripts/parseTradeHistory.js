var request = require('superagent');

var PSO = require('../../pso.js');

async function fetchAllTrades() {
	var allTrades = [];
	var page = 1;
	var hasMore = true;

	while (hasMore) {
		console.log('Fetching page', page, '...');

		var response = await request
			.get('https://public-api.wordpress.com/rest/v1.1/sites/thedynastyleague.wordpress.com/posts')
			.query({ category: 'trades', number: 100, page: page });

		var posts = response.body.posts;

		if (posts.length === 0) {
			hasMore = false;
		}
		else {
			allTrades = allTrades.concat(posts);
			page++;
		}
	}

	console.log('Fetched', allTrades.length, 'trades total');
	return allTrades;
}

function parseTradeContent(html) {
	var trade = {
		parties: []
	};

	// Split by <strong> tags to find each party's section
	var sections = html.split(/<strong>/);

	for (var i = 1; i < sections.length; i++) {
		var section = sections[i];

		// Extract owner name (everything before </strong>)
		var ownerMatch = section.match(/^([^<]+)<\/strong>/);
		if (!ownerMatch) continue;

		var ownerName = ownerMatch[1].trim();
		var party = {
			owner: ownerName,
			franchiseId: PSO.franchiseIds[ownerName] || null,
			receives: {
				players: [],
				picks: [],
				cash: []
			}
		};

		// Extract list items - handle both text-first and tag-first content
		var listItems = section.match(/<li>.*?<\/li>/g) || [];

		for (var j = 0; j < listItems.length; j++) {
			var item = listItems[j];

			// Player with link: <a href="...">Player Name</a> ($salary, start/end) or ($salary, year)
			var playerMatch = item.match(/<a[^>]*>([^<]+)<\/a>\s*\((\$?\d+),?\s*([^)]+)\)/);
			if (playerMatch) {
				var contractStr = playerMatch[3].trim();
				var contractParts = contractStr.split('/');
				var startYear, endYear;

				if (contractParts.length === 1) {
					// Old format: single year like "2008", or special status like "unsigned", "FA"
					var year = contractParts[0];
					if (year === 'FA' || year === 'unsigned' || year === 'Franchise') {
						startYear = null;
						endYear = null;
					}
					else {
						startYear = year.length === 2 ? parseInt('20' + year) : parseInt(year);
						endYear = startYear;
					}
				}
				else {
					// New format: start/end like "08/10"
					startYear = contractParts[0] === 'FA' ? null : (contractParts[0].length === 2 ? parseInt('20' + contractParts[0]) : parseInt(contractParts[0]));
					endYear = contractParts[1] ? (contractParts[1].length === 2 ? parseInt('20' + contractParts[1]) : parseInt(contractParts[1])) : null;
				}

				party.receives.players.push({
					name: playerMatch[1].trim(),
					salary: parseInt(playerMatch[2].replace('$', '')),
					startYear: startYear,
					endYear: endYear
				});
				continue;
			}

			// Player without link (plain text): Player Name ($salary, start/end) or ($salary, year)
			var plainPlayerMatch = item.match(/<li>\s*([A-Za-z][A-Za-z\.\s'-]+[A-Za-z])\s*\((\$?\d+),?\s*([^)]+)\)/);
			if (plainPlayerMatch) {
				var contractStr = plainPlayerMatch[3].trim();
				var contractParts = contractStr.split('/');
				var startYear, endYear;

				if (contractParts.length === 1) {
					var year = contractParts[0];
					if (year === 'FA' || year === 'unsigned' || year === 'Franchise') {
						startYear = null;
						endYear = null;
					}
					else {
						startYear = year.length === 2 ? parseInt('20' + year) : parseInt(year);
						endYear = startYear;
					}
				}
				else {
					startYear = contractParts[0] === 'FA' ? null : (contractParts[0].length === 2 ? parseInt('20' + contractParts[0]) : parseInt(contractParts[0]));
					endYear = contractParts[1] ? (contractParts[1].length === 2 ? parseInt('20' + contractParts[1]) : parseInt(contractParts[1])) : null;
				}

				party.receives.players.push({
					name: plainPlayerMatch[1].trim(),
					salary: parseInt(plainPlayerMatch[2].replace('$', '')),
					startYear: startYear,
					endYear: endYear
				});
				continue;
			}

			// Cash: $X from Owner in Year
			var cashMatch = item.match(/\$(\d+)\s+from\s+([^\s]+(?:\/[^\s]+)?)\s+in\s+(\d+)/i);
			if (cashMatch) {
				party.receives.cash.push({
					amount: parseInt(cashMatch[1]),
					fromOwner: cashMatch[2],
					season: parseInt(cashMatch[3])
				});
				continue;
			}

			// Cash without "from" (old format): $X in Year
			var cashNoFromMatch = item.match(/\$(\d+)\s+in\s+(\d+)/i);
			if (cashNoFromMatch) {
				party.receives.cash.push({
					amount: parseInt(cashNoFromMatch[1]),
					fromOwner: null,  // Will need to infer from other party
					season: parseInt(cashNoFromMatch[2])
				});
				continue;
			}

			// Pick: Xth round [draft] pick from Owner in Year (draft word optional for old trades)
			var pickMatch = item.match(/(\d+)(?:st|nd|rd|th)\s+round\s+(?:draft\s+)?pick\s+from\s+([^\s(]+(?:\/[^\s(]+)?)\s+in\s+(\d+)/i);
			if (pickMatch) {
				party.receives.picks.push({
					round: parseInt(pickMatch[1]),
					fromOwner: pickMatch[2],
					season: parseInt(pickMatch[3])
				});
				continue;
			}

			// Pick with "via" notation: Xth round [draft] pick from Owner (via OtherOwner [via ...]) in Year
			var pickViaMatch = item.match(/(\d+)(?:st|nd|rd|th)\s+round\s+(?:draft\s+)?pick\s+from\s+([^\s(]+(?:\/[^\s(]+)?)\s*\(via\s+([^)]+)\)\s+in\s+(\d+)/i);
			if (pickViaMatch) {
				party.receives.picks.push({
					round: parseInt(pickViaMatch[1]),
					fromOwner: pickViaMatch[2],
					viaOwner: pickViaMatch[3],
					season: parseInt(pickViaMatch[4])
				});
				continue;
			}

			// Pick with year before via: Xth round [draft] pick from Owner in Year (via OtherOwner)
			var pickYearBeforeViaMatch = item.match(/(\d+)(?:st|nd|rd|th)\s+round\s+(?:draft\s+)?pick\s+from\s+([^\s(]+(?:\/[^\s(]+)?)\s+in\s+(\d+)\s*\(via\s+([^)]+)\)/i);
			if (pickYearBeforeViaMatch) {
				party.receives.picks.push({
					round: parseInt(pickYearBeforeViaMatch[1]),
					fromOwner: pickYearBeforeViaMatch[2],
					season: parseInt(pickYearBeforeViaMatch[3]),
					viaOwner: pickYearBeforeViaMatch[4]
				});
				continue;
			}

			// Old format pick without year: Xth round [draft] pick from Owner (via OtherOwner)
			var pickNoYearViaMatch = item.match(/(\d+)(?:st|nd|rd|th)\s+round\s+(?:draft\s+)?pick\s+from\s+([^\s(]+(?:\/[^\s(]+)?)\s*\(via\s+([^)]+)\)$/i);
			if (pickNoYearViaMatch) {
				party.receives.picks.push({
					round: parseInt(pickNoYearViaMatch[1]),
					fromOwner: pickNoYearViaMatch[2],
					viaOwner: pickNoYearViaMatch[3],
					season: null  // Will need to infer from trade date
				});
				continue;
			}

			// RFA rights: Player Name (RFA rights)
			var rfaMatch = item.match(/<a[^>]*>([^<]+)<\/a>\s*\(RFA rights\)/i) || item.match(/<li>\s*([A-Za-z][A-Za-z\.\s'&#;0-9-]+[A-Za-z])\s*\(RFA rights\)/i);
			if (rfaMatch) {
				party.receives.players.push({
					name: rfaMatch[1].trim().replace(/&#8217;/g, "'"),
					rfaRights: true,
					salary: null,
					startYear: null,
					endYear: null
				});
				continue;
			}

			// Nothing: explicitly traded nothing
			if (item.match(/Nothing/i)) {
				continue;
			}

			// Unrecognized item
			console.log('Unrecognized trade item:', item.replace(/<[^>]+>/g, ''));
		}

		trade.parties.push(party);
	}

	return trade;
}

async function main() {
	var posts = await fetchAllTrades();

	var parsedTrades = [];

	for (var i = 0; i < posts.length; i++) {
		var post = posts[i];

		var tradeNumberMatch = post.title.match(/Trade #(\d+)/);
		var tradeNumber = tradeNumberMatch ? parseInt(tradeNumberMatch[1]) : null;

		var parsed = parseTradeContent(post.content);
		parsed.tradeNumber = tradeNumber;
		parsed.timestamp = new Date(post.date);
		parsed.wordpressId = post.ID;
		parsed.url = post.URL;

		parsedTrades.push(parsed);
	}

	// Sort by trade number
	parsedTrades.sort((a, b) => a.tradeNumber - b.tradeNumber);

	// Output summary
	console.log('\n--- Sample of parsed trades ---\n');

	for (var i = 0; i < Math.min(5, parsedTrades.length); i++) {
		var trade = parsedTrades[i];
		console.log('Trade #' + trade.tradeNumber, '(' + trade.timestamp.toISOString().split('T')[0] + ')');

		for (var j = 0; j < trade.parties.length; j++) {
			var party = trade.parties[j];
			console.log('  ' + party.owner + ' receives:');

			for (var k = 0; k < party.receives.players.length; k++) {
				var player = party.receives.players[k];
				console.log('    - Player:', player.name, '$' + player.salary, player.startYear + '/' + player.endYear);
			}

			for (var k = 0; k < party.receives.picks.length; k++) {
				var pick = party.receives.picks[k];
				console.log('    - Pick: Round', pick.round, 'from', pick.fromOwner, 'in', pick.season);
			}

			for (var k = 0; k < party.receives.cash.length; k++) {
				var cash = party.receives.cash[k];
				console.log('    - Cash: $' + cash.amount, 'from', cash.fromOwner, 'in', cash.season);
			}
		}

		console.log('');
	}

	// Extract all cash transfers for seeding
	console.log('\n--- Cash Transfer Summary ---\n');

	var cashByOwnerBySeason = {};

	for (var i = 0; i < parsedTrades.length; i++) {
		var trade = parsedTrades[i];

		for (var j = 0; j < trade.parties.length; j++) {
			var party = trade.parties[j];

			for (var k = 0; k < party.receives.cash.length; k++) {
				var cash = party.receives.cash[k];

				// Receiving owner gets positive
				if (!cashByOwnerBySeason[party.owner]) cashByOwnerBySeason[party.owner] = {};
				if (!cashByOwnerBySeason[party.owner][cash.season]) cashByOwnerBySeason[party.owner][cash.season] = 0;
				cashByOwnerBySeason[party.owner][cash.season] += cash.amount;

				// Sending owner gets negative
				if (!cashByOwnerBySeason[cash.fromOwner]) cashByOwnerBySeason[cash.fromOwner] = {};
				if (!cashByOwnerBySeason[cash.fromOwner][cash.season]) cashByOwnerBySeason[cash.fromOwner][cash.season] = 0;
				cashByOwnerBySeason[cash.fromOwner][cash.season] -= cash.amount;
			}
		}
	}

	// Only show recent/current seasons
	var currentYear = new Date().getFullYear();
	var relevantSeasons = [currentYear, currentYear + 1, currentYear + 2];

	Object.keys(cashByOwnerBySeason).sort().forEach(function(owner) {
		var seasons = cashByOwnerBySeason[owner];
		var hasRelevant = false;

		relevantSeasons.forEach(function(season) {
			if (seasons[season]) hasRelevant = true;
		});

		if (hasRelevant) {
			console.log(owner + ':');

			relevantSeasons.forEach(function(season) {
				if (seasons[season]) {
					var sign = seasons[season] > 0 ? '+' : '';
					console.log('  ' + season + ': ' + sign + '$' + seasons[season]);
				}
			});
		}
	});

	// Write full data to file
	var fs = require('fs');
	var outputPath = __dirname + '/trade-history.json';
	fs.writeFileSync(outputPath, JSON.stringify(parsedTrades, null, 2));
	console.log('\nFull data written to', outputPath);
}

main().catch(console.error);

