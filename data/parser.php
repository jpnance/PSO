<?php

require '../vendor/autoload.php';

$debug = false;

$seasonId = isset($argv[1]) ? intval($argv[1]) : false;
$upToWeek = isset($argv[2]) ? intval($argv[2]) : 16;

if ($seasonId === false) {
	echo "Invalid season.\n";
	echo "Usage: php " . basename(__FILE__) . " <season> [week to stop]\n";
	exit(1);
}

$names = [
	1 => 'Patrick',
	2 => 'Koci/Mueller',
	3 => 'Syed/Terence',
	4 => 'John/Zach',
	5 => 'Trevor',
	6 => 'Keyon',
	7 => 'Brett/Luke',
	8 => 'Daniel',
	9 => 'James',
	10 => 'Schex/Jeff',
	11 => 'Quinn',
	12 => 'Mitch'
];

$m = new MongoDB\Client('mongodb://localhost:27017');
$c = $m->pso->games;

foreach (range(1, $upToWeek) as $matchupPeriodId) {
	$scoreboardUrl = 'http://games.espn.go.com/ffl/scoreboard?leagueId=122885&matchupPeriodId=' . $matchupPeriodId . '&seasonId=' . $seasonId;
	$scoreboardHtml = file_get_contents($scoreboardUrl);

	$resultPattern = '/<table class="ptsBased matchup"><tr id="teamscrg_(\d\d?)_activeteamrow">.*?<td class=".*?score"title="(.*?)".*?>.*?<\/td><\/tr><tr id="teamscrg_(\d\d?)_activeteamrow">.*?<td class=".*?score"title="(.*?)".*?>.*?<\/td><\/tr>.*?<\/td><\/tr><\/table>/';
	preg_match_all($resultPattern, $scoreboardHtml, $resultMatches);

	foreach ($resultMatches[0] as $i => $resultMatch) {
		$game = [
			'season' => $seasonId,
			'week' => $matchupPeriodId
		];

		$awayFranchiseId = intval($resultMatches[1][$i]);
		$awayScore = floatval($resultMatches[2][$i]);
		$homeFranchiseId = intval($resultMatches[3][$i]);
		$homeScore = floatval($resultMatches[4][$i]);

		$away = [
			'franchiseId' => $awayFranchiseId,
			'name' => $names[$awayFranchiseId]
		];

		$home = [
			'franchiseId' => $homeFranchiseId,
			'name' => $names[$homeFranchiseId]
		];

		if ($awayScore > 0) {
			$away['score'] = $awayScore;
		}
		if ($homeScore > 0) {
			$home['score'] = $homeScore;
		}

		$game['away'] = $away;
		$game['home'] = $home;

		if ($awayScore > 0 || $homeScore > 0) {
			if ($awayScore > $homeScore) {
				$game['winner'] = $away;
				$game['loser'] = $home;
			}
			else if ($homeScore > $awayScore) {
				$game['winner'] = $home;
				$game['loser'] = $away;
			}
			else {
				$game['tie'] = true;
			}
		}

		if ($matchupPeriodId <= 14) {
			$game['type'] = 'regular';
		}
		else if ($matchupPeriodId > 14) {
			if ($matchupPeriodId == 15 && ($i == 0 || $i == 1)) {
				$game['type'] = 'semifinal';
			}
			else if ($matchupPeriodId == 16 && $i == 0) {
				$game['type'] = 'championship';
			}
			else if ($matchupPeriodId == 16 && $i == 1) {
				$game['type'] = 'thirdPlace';
			}
			else {
				$game['type'] = 'consolation';
			}
		}

		$c->updateOne(
			['season' => $seasonId, 'week' => $matchupPeriodId, 'away.franchiseId' => $awayFranchiseId, 'home.franchiseId' => $homeFranchiseId],
			['$set' => $game],
			['upsert' => true]
		);

		echo json_encode($game) . "\n";
	}
}
