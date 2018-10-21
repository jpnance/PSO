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
	1 => [
		2008 => 'Patrick',
		2009 => 'Patrick',
		2010 => 'Patrick',
		2011 => 'Patrick',
		2012 => 'Pat/Quinn',
		2013 => 'Pat/Quinn',
		2014 => 'Patrick',
		2015 => 'Patrick',
		2016 => 'Patrick',
		2017 => 'Patrick',
		2018 => 'Patrick'
	],
	2 => [
		2008 => 'Koci',
		2009 => 'Koci',
		2010 => 'Koci',
		2011 => 'Koci',
		2012 => 'Koci',
		2013 => 'Koci/Mueller',
		2014 => 'Koci/Mueller',
		2015 => 'Koci/Mueller',
		2016 => 'Koci/Mueller',
		2017 => 'Koci/Mueller',
		2018 => 'Koci/Mueller'
	],
	3 => [
		2008 => 'Syed',
		2009 => 'Syed',
		2010 => 'Syed',
		2011 => 'Syed',
		2012 => 'Syed',
		2013 => 'Syed',
		2014 => 'Syed',
		2015 => 'Syed/Terence',
		2016 => 'Syed/Terence',
		2017 => 'Syed/Terence',
		2018 => 'Syed/Terence'
	],
	4 => [
		2008 => 'John',
		2009 => 'John',
		2010 => 'John',
		2011 => 'John',
		2012 => 'John',
		2013 => 'John',
		2014 => 'John/Zach',
		2015 => 'John/Zach',
		2016 => 'John/Zach',
		2017 => 'John/Zach',
		2018 => 'John/Zach'
	],
	5 => [
		2008 => 'Trevor',
		2009 => 'Trevor',
		2010 => 'Trevor',
		2011 => 'Trevor',
		2012 => 'Trevor',
		2013 => 'Trevor',
		2014 => 'Trevor',
		2015 => 'Trevor',
		2016 => 'Trevor',
		2017 => 'Trevor',
		2018 => 'Trevor'
	],
	6 => [
		2008 => 'Keyon',
		2009 => 'Keyon',
		2010 => 'Keyon',
		2011 => 'Keyon',
		2012 => 'Keyon',
		2013 => 'Keyon',
		2014 => 'Keyon',
		2015 => 'Keyon',
		2016 => 'Keyon',
		2017 => 'Keyon',
		2018 => 'Keyon'
	],
	7 => [
		2008 => 'Jeff',
		2009 => 'Jake/Luke',
		2010 => 'Jake/Luke',
		2011 => 'Jake/Luke',
		2012 => 'Jake/Luke',
		2013 => 'Jake/Luke',
		2014 => 'Brett/Luke',
		2015 => 'Brett/Luke',
		2016 => 'Brett/Luke',
		2017 => 'Brett/Luke',
		2018 => 'Brett/Luke'
	],
	8 => [
		2008 => 'Daniel',
		2009 => 'Daniel',
		2010 => 'Daniel',
		2011 => 'Daniel',
		2012 => 'Daniel',
		2013 => 'Daniel',
		2014 => 'Daniel',
		2015 => 'Daniel',
		2016 => 'Daniel',
		2017 => 'Daniel',
		2018 => 'Daniel'
	],
	9 => [
		2008 => 'James',
		2009 => 'James',
		2010 => 'James',
		2011 => 'James',
		2012 => 'James',
		2013 => 'James',
		2014 => 'James',
		2015 => 'James',
		2016 => 'James',
		2017 => 'James/Charles',
		2018 => 'James/Charles'
	],
	10 => [
		2008 => 'Schexes',
		2009 => 'Schexes',
		2010 => 'Schexes',
		2011 => 'Schexes',
		2012 => 'Schex',
		2013 => 'Schex',
		2014 => 'Schex',
		2015 => 'Schex/Jeff',
		2016 => 'Schex/Jeff',
		2017 => 'Schex/Jeff',
		2018 => 'Schex'
	],
	11 => [
		2012 => 'Charles',
		2013 => 'Charles',
		2014 => 'Quinn',
		2015 => 'Quinn',
		2016 => 'Quinn',
		2017 => 'Quinn',
		2018 => 'Quinn'
	],
	12 => [
		2012 => 'Mitch',
		2013 => 'Mitch',
		2014 => 'Mitch',
		2015 => 'Mitch',
		2016 => 'Mitch',
		2017 => 'Mitch',
		2018 => 'Mitch'
	]
];

$m = new MongoDB\Client('mongodb://localhost:27017');
$c = $m->pso_dev->games;

$games = [];

foreach (range(1, $upToWeek) as $matchupPeriodId) {
	if (!isset($games[$seasonId])) {
		$games[$seasonId] = [];
	}

	$games[$seasonId][$matchupPeriodId] = [];

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
			'name' => $names[$awayFranchiseId][$seasonId]
		];

		$home = [
			'franchiseId' => $homeFranchiseId,
			'name' => $names[$homeFranchiseId][$seasonId]
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

		/*
		$c->updateOne(
			['season' => $seasonId, 'week' => $matchupPeriodId, 'away.franchiseId' => $awayFranchiseId, 'home.franchiseId' => $homeFranchiseId],
			['$set' => $game],
			['upsert' => true]
		);
		*/

		$games[$seasonId][$matchupPeriodId][] = $game;
		//echo json_encode($game) . "\n";
	}
}

/*
	record: {
		straight: {
			week: { wins: 0, losses: 1, ties: 0 },
			overall: { wins: 3, losses: 1, ties: 0 }
		},
		allPlay: {
			week: { wins: 8, losses: 5, ties: 0 },
			overall: { wins: 28, losses: 16, ties: 0 }
		},
		stern: {
			week: { wins: 1, losses: 1, ties: 0 },
			overall: { wins: 6, losses: 2, ties: 0 }
		}
	}
*/


$overall = [];
$allPlay = [];
$stern = [];
$homeAway = [ 'home', 'away' ];

foreach ($games[$seasonId] as $week => $weekGames) {
	$weekScores = [];
	$allPlay[$week] = [];
	$stern[$week] = [];

	foreach ($weekGames as $game) {
		if (isset($game['home']['score']) && isset($game['away']['score'])) {
			if ($game['type'] != 'consolation') {
				$weekScores[] = $game['home']['score'];
				$weekScores[] = $game['away']['score'];

				$stern[$week][$game['winner']['score']] = [ 'wins' => 1, 'losses' => 0, 'ties' => 0 ];
				$stern[$week][$game['loser']['score']] = [ 'wins' => 0, 'losses' => 1, 'ties' => 0 ];
			}
		}
	}


	foreach ($weekScores as $i => $weekScore) {
		$allPlayRecord = [
			'wins' => $i,
			'losses' => count($weekScores) - 1 - $i,
			'ties' => 0
		];

		if (isset($allPlay[$week][$weekScore])) {
			$allPlayRecord['wins']--;
			$allPlayRecord['ties']++;
		}

		$allPlay[$week][$weekScore] = $allPlayRecord;

		if ($allPlayRecord['wins'] > $allPlayRecord['losses']) {
			$stern[$week][$weekScore]['wins']++;
		}
		else if ($allPlayRecord['wins'] < $allPlayRecord['losses']) {
			$stern[$week][$weekScore]['losses']++;
		}
		else if ($allPlayRecord['wins'] == $allPlayRecord['losses']) {
			$stern[$week][$weekScore]['ties']++;
		}
	}

	foreach ($weekGames as $game) {
		if (isset($game['home']['score']) && isset($game['away']['score'])) {
			if ($game['type'] != 'consolation') {
				foreach ($homeAway as $team) {
					$game[$team]['record'] = [
						'straight' => [
							'week' => [
								'wins' => (!isset($game['tie']) && $game['winner']['score'] == $game[$team]['score']) ? 1 : 0,
								'losses' => (!isset($game['tie']) && $game['loser']['score'] == $game[$team]['score']) ? 1 : 0,
								'ties' => isset($game['tie']) ? 1 : 0
							]
						],
						'allPlay' => [
							'week' => $allPlay[$week][$game[$team]['score']]
						],
						'stern' => [
							'week' => $stern[$week][$game[$team]['score']]
						]
					];

					if (!isset($overall[$seasonId])) {
						$overall[$seasonId] = [];
					}

					if (!isset($overall[$seasonId][$game[$team]['franchiseId']])) {
						$overall[$seasonId][$game[$team]['franchiseId']] = [
							'straight' => [ 'wins' => 0, 'losses' => 0, 'ties' => 0 ],
							'allPlay' => [ 'wins' => 0, 'losses' => 0, 'ties' => 0 ],
							'stern' => [ 'wins' => 0, 'losses' => 0, 'ties' => 0 ]
						];
					}

					foreach ($overall[$seasonId][$game[$team]['franchiseId']] as $recordType => &$record) {
						$record['wins'] += $game[$team]['record'][$recordType]['week']['wins'];
						$record['losses'] += $game[$team]['record'][$recordType]['week']['losses'];
						$record['ties'] += $game[$team]['record'][$recordType]['week']['ties'];

						$game[$team]['record'][$recordType]['cumulative']['wins'] = $record['wins'];
						$game[$team]['record'][$recordType]['cumulative']['losses'] = $record['losses'];
						$game[$team]['record'][$recordType]['cumulative']['ties'] = $record['ties'];
					}

					if ($game[$team]['record']['straight']['week']['wins'] == 1) {
						$game['winner'] = $game[$team];
					}
					else if ($game[$team]['record']['straight']['week']['losses'] == 1) {
						$game['loser'] = $game[$team];
					}
				}
			}
		}

		$c->updateOne(
			['season' => $seasonId, 'week' => $matchupPeriodId, 'away.franchiseId' => $game['away']['franchiseId'], 'home.franchiseId' => $game['home']['franchiseId']],
			['$set' => $game],
			['upsert' => true]
		);

		echo print_r($game, true);
	}
}
