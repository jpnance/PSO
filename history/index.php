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
				margin-bottom: 40px;
			}

			table tr th,
			table tr td {
				border: 1px solid #cccccc;
				padding: 2px;
				width: 65px;
			}

			table tr th {
				text-align: right;
				vertical-align: bottom;
				white-space: nowrap;
			}

			table tr th.champion {
				color: rgb(191, 144, 0);
			}

			table tr th.runner-up {
				color: rgb(102, 102, 102);
			}

			table tr th.third-place {
				color: rgb(120, 63, 4);
			}

			table tr td {
				line-height: 14px;
			}

			table tr th.average,
			table tr td.average,
			table tr th.stdev,
			table tr td.stdev {
				background-color: #fadcb3;
			}

			table tr td.average,
			table tr td.stdev {
				font-style: italic;
			}

			table tr td div {
				text-align: right;
			}

			table tr td div.opponent {
				font-family: sans-serif;
				font-size: 90%;
			}

			table tr td div.score {
			}

			table tr td div.score.high {
				color: #008000;
			}

			table tr td div.score.low {
				color: #ff0000;
			}
		</style>
	</head>
	<body>
<?php

require '../vendor/autoload.php';

$franchiseMappings = [
	'Brett/Luke' => 'Brett/Luke',
	'Charles' => 'Quinn',
	'Daniel' => 'Daniel',
	'Jake/Luke' => 'Brett/Luke',
	'James' => 'James',
	'James/Charles' => 'James/Charles',
	'Jeff' => 'Brett/Luke',
	'John' => 'John/Zach',
	'John/Zach' => 'John/Zach',
	'Keyon' => 'Keyon',
	'Koci' => 'Koci/Mueller',
	'Koci/Mueller' => 'Koci/Mueller',
	'Mitch' => 'Mitch',
	'Pat/Quinn' => 'Patrick',
	'Patrick' => 'Patrick',
	'Quinn' => 'Quinn',
	'Schex' => 'Schex/Jeff',
	'Schex/Jeff' => 'Schex/Jeff',
	'Schexes' => 'Schex/Jeff',
	'Syed' => 'Syed/Terence',
	'Syed/Terence' => 'Syed/Terence',
	'Trevor' => 'Trevor'
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
$records = [];

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

		$franchise = $franchiseMappings[$seasonOwner];

		if (!isset($records[$franchise])) {
			$records[$franchise] = [
				'regularSeason' => [
					'wins' => 0, 'losses' => 0, 'ties' => 0,
					'allPlayWins' => 0, 'allPlayLosses' => 0, 'allPlayTies' => 0,
					'flukyWins' => 0, 'flukyLosses' => 0
				],
				'postseason' => [
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

			$records[$franchise][$seasonType]['allPlayWins'] += $allPlay['wins'];
			$records[$franchise][$seasonType]['allPlayLosses'] += $allPlay['losses'];
			$records[$franchise][$seasonType]['allPlayTies'] += $allPlay['ties'];

			$cumulativeAllPlayWins += $allPlay['wins'];
			$cumulativeAllPlayLosses += $allPlay['losses'];
			$cumulativeAllPlayTies += $allPlay['ties'];

			$gameData['cumulativeAllPlayWins'] = $cumulativeAllPlayWins;
			$gameData['cumulativeAllPlayLosses'] = $cumulativeAllPlayLosses;
			$gameData['cumulativeAllPlayTies'] = $cumulativeAllPlayTies;

			if ($gameData['result'] == 'W') {
				$cumulativeWins++;
				$records[$franchise][$seasonType]['wins']++;
			}
			else if ($gameData['result'] == 'L') {
				$cumulativeLosses++;
				$records[$franchise][$seasonType]['losses']++;
			}
			else if ($gameData['result'] == 'T') {
				$cumulativeTies++;
				$records[$franchise][$seasonType]['ties']++;
			}

			$gameData['cumulativeWins'] = $cumulativeWins;
			$gameData['cumulativeLosses'] = $cumulativeLosses;
			$gameData['cumulativeTies'] = $cumulativeTies;

			$aboveMedian = ($allPlay['wins'] > 2 * ($allPlay['wins'] + $allPlay['losses'] + $allPlay['ties']) / 3);

			if ($gameData['result'] == 'W' && $allPlay['losses'] > 2 * ($allPlay['wins'] + $allPlay['losses'] + $allPlay['ties']) / 3) {
				$gameData['fluky'] = true;
				$records[$franchise][$seasonType]['flukyWins']++;
			}

			if ($gameData['result'] == 'L' && $allPlay['wins'] > 2 * ($allPlay['wins'] + $allPlay['losses'] + $allPlay['ties']) / 3) {
				$gameData['fluky'] = true;
				$records[$franchise][$seasonType]['flukyLosses']++;
			}

			$gameData['sternWins'] = ($gameData['result'] == 'W' ? 1 : 0) + ($aboveMedian ? 1 : 0);
			$gameData['sternLosses'] = ($gameData['result'] == 'L' ? 1 : 0) + ($aboveMedian ? 0 : 1);

			$cumulativeSternWins += $gameData['sternWins'];
			$cumulativeSternLosses += $gameData['sternLosses'];

			$gameData['cumulativeSternWins'] = $cumulativeSternWins;
			$gameData['cumulativeSternLosses'] = $cumulativeSternLosses;
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

krsort($seasons);

?>

<?php foreach ($seasons as $season => $seasonData) { ?>
		<table>
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
