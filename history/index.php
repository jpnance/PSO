<!doctype html>
<html>
	<head>
		<title>All-Time Results</title>
		<style type="text/css">
			body {
				font-family: sans-serif;
				font-size: 12px;
			}

			table {
				border-collapse: collapse;
			}

			table.results {
				margin-bottom: 40px;
			}

			table.results tr th,
			table.results tr td {
				border: 1px solid #cccccc;
				padding: 2px;
				width: 65px;
			}

			table.results tr th {
				text-align: right;
				vertical-align: bottom;
				white-space: nowrap;
			}

			table.results tr th.champion {
				color: rgb(191, 144, 0);
			}

			table.results tr th.runner-up {
				color: rgb(102, 102, 102);
			}

			table.results tr th.third-place {
				color: rgb(120, 63, 4);
			}

			table tr td {
				line-height: 14px;
			}

			table.results tr th.average,
			table.results tr td.average,
			table.results tr th.stdev,
			table.results tr td.stdev {
				background-color: #fadcb3;
			}

			table.results tr td.average,
			table.results tr td.stdev {
				font-style: italic;
			}

			table.results tr td div {
				text-align: right;
			}

			table.results tr td div.opponent {
				font-family: sans-serif;
				font-size: 90%;
			}

			table.results tr td div.score {
			}

			table.results tr td div.score.high {
				color: #008000;
			}

			table.results tr td div.score.low {
				color: #ff0000;
			}

			div.leaders {
				display: inline-block;
				margin-bottom: 20px;
				margin-right: 10px;
				padding: 4px;
				width: 150px;
			}

			div.leaders h3 {
				font-size: 12px;
				margin: 0;
				padding: 6px;
				text-align: center;
			}

			div.leaders table {
				margin: 0 auto;
			}

			div.leaders table tr td {
				font-size: 12px;
			}

			div.leaders table tr th,
			div.leaders table tr td {
				padding: 4px 6px;
			}

			div.leaders table tr td.value {
				text-align: right;
			}
		</style>
	</head>
	<body>
<?php

require '../vendor/autoload.php';

$franchises = [
	1 => 'Patrick',
	2 => 'Koci/Mueller',
	3 => 'Syed/Terence',
	4 => 'John/Zach',
	5 => 'Trevor',
	6 => 'Keyon',
	7 => 'Brett/Luke',
	8 => 'Daniel',
	9 => 'James/Charles',
	10 => 'Schex',
	11 => 'Quinn',
	12 => 'Mitch'

	/*
	1 => 'Patrick & Pat/Quinn',
	2 => 'Koci/Mueller & Koci',
	3 => 'Syed/Terence & Syed',
	4 => 'John/Zach & John',
	5 => 'Trevor',
	6 => 'Keyon',
	7 => 'Brett/Luke, Jake/Luke, Luke, & Jeff',
	8 => 'Daniel',
	9 => 'James/Charles & James',
	10 => 'Schex, Schex/Jeff, Schex, & Schexes',
	11 => 'Quinn & Charles',
	12 => 'Mitch'
	*/
];

$franchiseMappings = [
	'Brett/Luke' => 7,
	'Charles' => 11,
	'Daniel' => 8,
	'Jake/Luke' => 7,
	'James' => 9,
	'James/Charles' => 9,
	'Jeff' => 7,
	'John' => 4,
	'John/Zach' => 4,
	'Keyon' => 6,
	'Koci' => 2,
	'Koci/Mueller' => 2,
	'Mitch' => 12,
	'Pat/Quinn' => 1,
	'Patrick' => 1,
	'Quinn' => 11,
	'Schex' => 10,
	'Schex/Jeff' => 10,
	'Schexes' => 10,
	'Syed' => 3,
	'Syed/Terence' => 3,
	'Trevor' => 5
];

function allPlay($weekScores, $score) {
	$allPlay = ['losses' => 0, 'ties' => 0, 'wins' => 0];

	foreach ($weekScores as $weekScore) {
		if ($weekScore > $score) {
			$allPlay['losses']++;
		}
		else if ($weekScore < $score) {
			$allPlay['wins']++;
		}
		else {
			$allPlay['ties']++;
		}
	}

	$allPlay['ties']--;

	return $allPlay;
}

$m = new MongoDB\Client('mongodb://localhost:27017');
$c = $m->pso->games;

$cursor = $c->find([
	'$or' => [
		['winner' => ['$exists' => true], 'loser' => ['$exists' => true]],
		['tie' => ['$exists' => true]]
	]
]);

$seasons = [];
$totals = [];

foreach ($cursor as $document) {
	$season = $document['season'];
	$homeName = $document['home']['name'];
	$homeScore = $document['home']['score'];
	$awayName = $document['away']['name'];
	$awayScore = $document['away']['score'];
	$winnerName = isset($document['winner']) ? $document['winner']['name'] : null;
	$loserName = isset($document['loser']) ? $document['loser']['name'] : null;
	$tie = isset($document['tie']) ? true : false;
	$week = $document['week'];
	$type = $document['type'];

	if (!isset($seasons[$season])) {
		$seasons[$season] = [];
	}

	if (!isset($seasons[$season]['owners'][$homeName])) {
		$seasons[$season]['owners'][$homeName] = [];
	}

	if (!isset($seasons[$season]['owners'][$awayName])) {
		$seasons[$season]['owners'][$awayName] = [];
	}

	if ($tie) {
		$seasons[$season]['owners'][$homeName]['weeks'][$week]['result'] = 'T';
		$seasons[$season]['owners'][$awayName]['weeks'][$week]['result'] = 'T';
	}
	else {
		$seasons[$season]['owners'][$winnerName]['weeks'][$week]['result'] = 'W';
		$seasons[$season]['owners'][$loserName]['weeks'][$week]['result'] = 'L';
	}

	$seasons[$season]['owners'][$homeName]['weeks'][$week]['score'] = $homeScore;
	$seasons[$season]['owners'][$awayName]['weeks'][$week]['score'] = $awayScore;

	$seasons[$season]['owners'][$homeName]['weeks'][$week]['opponent'] = $awayName;
	$seasons[$season]['owners'][$awayName]['weeks'][$week]['opponent'] = $homeName;

	$seasons[$season]['owners'][$homeName]['weeks'][$week]['type'] = $type;
	$seasons[$season]['owners'][$awayName]['weeks'][$week]['type'] = $type;

	if (!isset($seasons[$season]['weeks'][$week])) {
		$seasons[$season]['weeks'][$week] = ['scores' => []];
	}

	if ($type != 'consolation') {
		$seasons[$season]['weeks'][$week]['scores'][] = $homeScore;
		$seasons[$season]['weeks'][$week]['scores'][] = $awayScore;
	}

	if ($type != 'regular' && $type != 'consolation') {
		$seasons[$season]['owners'][$homeName]['playoffs'] = true;
		$seasons[$season]['owners'][$awayName]['playoffs'] = true;

		if ($type == 'championship') {
			$seasons[$season]['owners'][$homeName]['championshipGame'] = true;
			$seasons[$season]['owners'][$awayName]['championshipGame'] = true;

			$seasons[$season]['owners'][$winnerName]['champion'] = true;
			$seasons[$season]['owners'][$loserName]['runnerUp'] = true;
		}
		else if ($type == 'thirdPlace') {
			$seasons[$season]['owners'][$homeName]['thirdPlaceGame'] = true;
			$seasons[$season]['owners'][$awayName]['thirdPlaceGame'] = true;

			$seasons[$season]['owners'][$winnerName]['thirdPlace'] = true;
			$seasons[$season]['owners'][$loserName]['fourthPlace'] = true;
		}
	}
}

foreach ($seasons as $season => &$seasonData) {
	$seasonSum = 0;
	$seasonScores = 0;
	$seasonVariance = 0;

	foreach ($seasonData['weeks'] as $week => $weekData) {
		$weekSum = 0;
		$weekScores = 0;
		$weekVariance = 0;

		foreach ($weekData['scores'] as $score) {
			$weekSum += $score;
			$weekScores++;

			$seasonSum += $score;
			$seasonScores++;
		}

		$weekAverage = $weekSum / $weekScores;

		foreach ($weekData['scores'] as $score) {
			$weekVariance += pow($score - $weekAverage, 2);
		}

		$weekStdev = sqrt($weekVariance / ($weekScores - 1));

		$seasonData['weeks'][$week]['average'] = $weekAverage;
		$seasonData['weeks'][$week]['stdev'] = $weekStdev;
	}

	$seasonAverage = $seasonSum / $seasonScores;

	foreach ($seasonData['weeks'] as $week => $weekData) {
		foreach ($weekData['scores'] as $score) {
			$seasonVariance += pow($score - $seasonAverage, 2);
		}
	}

	$seasonStdev = sqrt($seasonVariance / ($seasonScores - 1));

	$seasonData['average'] = $seasonAverage;
	$seasonData['stdev'] = $seasonStdev;

	foreach ($seasonData['owners'] as $seasonOwner => &$seasonOwnerData) {
		$ownerSum = 0;
		$ownerScores = 0;
		$ownerVariance = 0;

		ksort($seasonOwnerData['weeks']);

		$franchise = $franchises[$franchiseMappings[$seasonOwner]];

		if (!isset($totals[$franchise])) {
			$totals[$franchise] = [
				'regularSeason' => [
					'games' => 0,
					'wins' => 0, 'losses' => 0, 'ties' => 0,
					'allPlayWins' => 0, 'allPlayLosses' => 0, 'allPlayTies' => 0,
					'flukyWins' => 0, 'flukyLosses' => 0,
					'weeklyScoringTitles' => 0
				],
				'postseason' => [
					'games' => 0, 'playoffAppearances' => 0, 'championshipGameAppearances' => 0,
					'wins' => 0, 'losses' => 0, 'ties' => 0,
					'allPlayWins' => 0, 'allPlayLosses' => 0, 'allPlayTies' => 0,
					'flukyWins' => 0, 'flukyLosses' => 0
				]
			];
		}

		$cumulativeWins = 0;
		$cumulativeLosses = 0;
		$cumulativeTies = 0;

		$cumulativeAllPlayWins = 0;
		$cumulativeAllPlayLosses = 0;
		$cumulativeAllPlayTies = 0;

		$cumulativeSternWins = 0;
		$cumulativeSternLosses = 0;

		foreach ($seasonOwnerData['weeks'] as $week => &$gameData) {
			$seasonType = 'regularSeason';

			if ($week > 14) {
				if (!isset($seasonOwnerData['playoffs']) || ($week == 16 && isset($seasonOwnerData['thirdPlaceGame']))) {
					continue;
				}
				else {
					$seasonType = 'postseason';
				}
			}

			$ownerSum += $gameData['score'];
			$ownerScores++;

			if (max($seasonData['weeks'][$week]['scores']) == $gameData['score']) {
				$gameData['highScore'] = true;
			}
			else if (min($seasonData['weeks'][$week]['scores']) == $gameData['score']) {
				$gameData['lowScore'] = true;
			}

			$allPlay = allPlay($seasonData['weeks'][$week]['scores'], $gameData['score']);

			$gameData['allPlayWins'] = $allPlay['wins'];
			$gameData['allPlayLosses'] = $allPlay['losses'];
			$gameData['allPlayTies'] = $allPlay['ties'];

			$totals[$franchise][$seasonType]['allPlayWins'] += $allPlay['wins'];
			$totals[$franchise][$seasonType]['allPlayLosses'] += $allPlay['losses'];
			$totals[$franchise][$seasonType]['allPlayTies'] += $allPlay['ties'];

			$cumulativeAllPlayWins += $allPlay['wins'];
			$cumulativeAllPlayLosses += $allPlay['losses'];
			$cumulativeAllPlayTies += $allPlay['ties'];

			$gameData['cumulativeAllPlayWins'] = $cumulativeAllPlayWins;
			$gameData['cumulativeAllPlayLosses'] = $cumulativeAllPlayLosses;
			$gameData['cumulativeAllPlayTies'] = $cumulativeAllPlayTies;

			if ($gameData['result'] == 'W') {
				$cumulativeWins++;
				$totals[$franchise][$seasonType]['wins']++;
			}
			else if ($gameData['result'] == 'L') {
				$cumulativeLosses++;
				$totals[$franchise][$seasonType]['losses']++;
			}
			else if ($gameData['result'] == 'T') {
				$cumulativeTies++;
				$totals[$franchise][$seasonType]['ties']++;
			}

			$gameData['cumulativeWins'] = $cumulativeWins;
			$gameData['cumulativeLosses'] = $cumulativeLosses;
			$gameData['cumulativeTies'] = $cumulativeTies;

			if ($gameData['result'] == 'W' && $allPlay['losses'] > 2 * ($allPlay['wins'] + $allPlay['losses'] + $allPlay['ties']) / 3) {
				$gameData['fluky'] = true;
				$totals[$franchise][$seasonType]['flukyWins']++;
			}

			if ($gameData['result'] == 'L' && $allPlay['wins'] > 2 * ($allPlay['wins'] + $allPlay['losses'] + $allPlay['ties']) / 3) {
				$gameData['fluky'] = true;
				$totals[$franchise][$seasonType]['flukyLosses']++;
			}

			$aboveMedian = ($allPlay['wins'] > ($allPlay['wins'] + $allPlay['losses'] + $allPlay['ties']) / 2);

			$gameData['sternWins'] = ($gameData['result'] == 'W' ? 1 : 0) + ($aboveMedian ? 1 : 0);
			$gameData['sternLosses'] = ($gameData['result'] == 'L' ? 1 : 0) + ($aboveMedian ? 0 : 1);

			$cumulativeSternWins += $gameData['sternWins'];
			$cumulativeSternLosses += $gameData['sternLosses'];

			$gameData['cumulativeSternWins'] = $cumulativeSternWins;
			$gameData['cumulativeSternLosses'] = $cumulativeSternLosses;

			if ($seasonType == 'regularSeason' && $allPlay['losses'] == 0) {
				$totals[$franchise][$seasonType]['weeklyScoringTitles']++;
			}

			if ($seasonType == 'postseason') {
				if ($gameData['type'] == 'semifinal') {
					$totals[$franchise][$seasonType]['playoffAppearances']++;
				}
				else if ($gameData['type'] == 'championship') {
					$totals[$franchise][$seasonType]['championshipGameAppearances']++;
				}
			}

			$totals[$franchise][$seasonType]['games']++;
		}

		$ownerAverage = $ownerSum / $ownerScores;

		unset($gameData);

		foreach ($seasonOwnerData['weeks'] as $week => &$gameData) {
			if ($week > 14) {
				continue;
			}

			$ownerVariance += pow($gameData['score'] - $ownerAverage, 2);
		}

		$ownerStdev = sqrt($ownerVariance / ($ownerScores - 1));

		$seasonOwnerData['average'] = $ownerAverage;
		$seasonOwnerData['stdev'] = $ownerStdev;

		unset($gameData);
	}

	unset($seasonOwnerData);
}

unset($seasonData);

$records = [
	'regularSeasonWins' => [
		'description' => 'Regular Season Wins',
		'leaders' => []
	],
	'regularSeasonWinPercentage' => [
		'description' => 'Regular Season Winning Percentage',
		'leaders' => []
	],
	'weeklyScoringTitles' => [
		'description' => 'Weekly Scoring Titles',
		'leaders' => []
	],
	'playoffAppearances' => [
		'description' => 'Playoff Appearances',
		'leaders' => []
	],
	'playoffWins' => [
		'description' => 'Playoff Wins',
		'leaders' => []
	],
	'championshipGameAppearances' => [
		'description' => 'Championship Game Appearances',
		'leaders' => []
	]
];

foreach ($totals as $franchise => $franchiseTotalData) {
	$records['regularSeasonWins']['leaders'][$franchise] = $franchiseTotalData['regularSeason']['wins'];
	$records['regularSeasonWinPercentage']['leaders'][$franchise] = number_format($franchiseTotalData['regularSeason']['wins'] / $franchiseTotalData['regularSeason']['games'], 3);
	$records['playoffAppearances']['leaders'][$franchise] = $franchiseTotalData['postseason']['playoffAppearances'];
	$records['playoffWins']['leaders'][$franchise] = $franchiseTotalData['postseason']['wins'];
	$records['weeklyScoringTitles']['leaders'][$franchise] = $franchiseTotalData['regularSeason']['weeklyScoringTitles'];
	$records['championshipGameAppearances']['leaders'][$franchise] = $franchiseTotalData['postseason']['championshipGameAppearances'];
}

foreach ($records as $key => &$record) {
	arsort($record['leaders']);
}

unset($record);

krsort($seasons);

?>

		<?php foreach ($records as $key => $record) { ?>
		<div class="leaders">
			<h3><?= $record['description']; ?></h3>
			<table>
				<?php foreach ($record['leaders'] as $franchise => $value) { ?>
					<tr>
						<td class="franchise"><?= $franchise; ?></td>
						<td class="value"><?= $value; ?></td>
					</tr>
				<?php } ?>
			</table>
		</div>
		<?php } ?>

<?php foreach ($seasons as $season => $seasonData) { ?>
		<table class="results">
			<tr>
				<th><?= $season; ?></th>
				<th>Week 1</th>
				<th>Week 2</th>
				<th>Week 3</th>
				<th>Week 4</th>
				<th>Week 5</th>
				<th>Week 6</th>
				<th>Week 7</th>
				<th>Week 8</th>
				<th>Week 9</th>
				<th>Week 10</th>
				<th>Week 11</th>
				<th>Week 12</th>
				<th>Week 13</th>
				<th>Week 14</th>
				<th>Semifinals</th>
				<th>Finals</th>
				<th class="average">Average</th>
				<th class="stdev">St. Dev</th>
			</tr>
<?php
	ksort($seasonData['owners']);

	foreach ($seasonData['owners'] as $seasonOwner => $seasonOwnerData) {
		$finishCss = '';

		if (isset($seasonOwnerData['champion'])) {
			$finishCss = 'champion';
		}
		else if (isset($seasonOwnerData['runnerUp'])) {
			$finishCss = 'runner-up';
		}
		else if (isset($seasonOwnerData['thirdPlace'])) {
			$finishCss = 'third-place';
		}
		else if (isset($seasonOwnerData['fourthPlace'])) {
			$finishCss = 'fourthPlace';
		}
?>
			<tr>
				<th class="<?= $finishCss; ?>"><?= isset($seasonOwnerData['playoffs']) ? '* ' : ''; ?><?= $seasonOwner; ?></th>
<?php
		ksort($seasonOwnerData['weeks']);

		foreach ($seasonOwnerData['weeks'] as $week => $gameData) {
			$result = $gameData['result'];
			$score = $gameData['score'];
			$opponent = $gameData['opponent'];

			if (isset($gameData['highScore'])) {
				$scoreCssClass = 'high';
			}
			else if (isset($gameData['lowScore'])) {
				$scoreCssClass = 'low';
			}
			else {
				$scoreCssClass = '';
			}

			$cumulativeWins = $gameData['cumulativeWins'] ?? null;
			$cumulativeLosses = $gameData['cumulativeLosses'] ?? null;
			$cumulativeTies = $gameData['cumulativeTies'] ?? null;

			$cumulativeRecord = $cumulativeWins . '-' . $cumulativeLosses . ($cumulativeTies > 0 ? '-' . $cumulativeTies : '');

			$allPlayWins = $gameData['allPlayWins'] ?? null;

			$cumulativeAllPlayWins = $gameData['cumulativeAllPlayWins'] ?? null;
			$cumulativeAllPlayLosses = $gameData['cumulativeAllPlayLosses'] ?? null;
			$cumulativeAllPlayTies = $gameData['cumulativeAllPlayTies'] ?? null;

			$cumulativeAllPlayRecord = $cumulativeAllPlayWins . '-' . $cumulativeAllPlayLosses . ($cumulativeAllPlayTies > 0 ? '-' . $cumulativeAllPlayTies : '');
			$cumulativeAllPlayWinPercentage = ($cumulativeAllPlayWins + $cumulativeAllPlayLosses + $cumulativeAllPlayTies > 0) ? ($cumulativeAllPlayWins + (0.5 * $cumulativeAllPlayTies)) / ($cumulativeAllPlayWins + $cumulativeAllPlayLosses + $cumulativeAllPlayTies) : null;

			$cumulativeSternWins = $gameData['cumulativeSternWins'] ?? null;
			$cumulativeSternLosses = $gameData['cumulativeSternLosses'] ?? null;
			$cumulativeSternRecord = $cumulativeSternWins . '-' . $cumulativeSternLosses;

			$fluky = 0;

			if (isset($gameData['fluky'])) {
				if ($result == 'W') {
					$fluky = 1;
				}
				else if ($result == 'L') {
					$fluky = -1;
				}
			}

			if ($week <= 14 || ($week > 14 && isset($seasonOwnerData['playoffs']))) {
?>
				<td>
					<div class="score <?= $scoreCssClass; ?>"><?= number_format($score, 2); ?></div>
					<div class="record"><?= $cumulativeRecord; ?></div>
					<div class="all-play-record"><?= $cumulativeAllPlayRecord; ?></div>
					<div class="stern-record"><?= $cumulativeSternRecord; ?></div>
					<div class="opponent"><?= $opponent; ?></div>
					<!--
					<div class="result"><?= $result; ?></div>
					<div class="record"><?= $cumulativeRecord; ?></div>
					<div class="score <?= $scoreCssClass; ?>"><?= number_format($score, 2); ?></div>
					<div class="opponent"><?= $opponent; ?></div>
					<div class="all-play-wins"><?= $allPlayWins; ?></div>
					<div class="all-play-record"><?= $cumulativeAllPlayRecord; ?></div>
					<div class="all-play-win-percentage"><?= number_format($cumulativeAllPlayWinPercentage, 3); ?></div>
					<div class="fluky"><?= $fluky; ?></div>
					<div class="stern-record"><?= $cumulativeSternRecord; ?></div>
					-->
				</td>
<?php
			}
			else {
?>
				<td><div></div></td>
<?php
			}
		}

		if (count($seasonOwnerData['weeks']) <= 14) {
			foreach (range(1, 16 - count($seasonOwnerData['weeks'])) as $space) {
?>
				<td><div></div></td>
<?php
			}
		}
?>
				<td class="average"><div class="score"><?= number_format($seasonOwnerData['average'], 2); ?></div></td>
				<td class="stdev"><div class="score"><?= number_format($seasonOwnerData['stdev'], 2); ?></div></td>
			</tr>
<?php
	}
?>
			<tr>
				<th class="average">Average</th>
<?php
	ksort($seasonData['weeks']);

	foreach ($seasonData['weeks'] as $weekData) {
?>
				<td class="average"><div class="score"><?= number_format($weekData['average'], 2); ?></div></td>
<?php
	}

	if (count($seasonData['weeks']) <= 14) {
		foreach (range(1, 16 - count($seasonData['weeks'])) as $space) {
?>
				<td class="average"></td>
<?php
		}
	}
?>
				<td class="average"><div class="score"><?= number_format($seasonData['average'], 2); ?></div></td>
				<td class="average"></td>
			</tr>
			<tr>
				<th class="stdev">St. Dev.</th>
<?php
	foreach ($seasonData['weeks'] as $weekData) {
?>
				<td class="stdev"><div class="score"><?= number_format($weekData['stdev'], 2); ?></div></td>
<?php
	}

	if (count($seasonData['weeks']) <= 14) {
		foreach (range(1, 16 - count($seasonData['weeks'])) as $space) {
?>
				<td class="stdev"></td>
<?php
		}
	}
?>
				<td class="stdev"></td>
				<td class="stdev"><div class="score"><?= number_format($seasonData['stdev'], 2); ?></div></td>
			</tr>
		</table>
<?php
}
?>
	</body>
</html>
