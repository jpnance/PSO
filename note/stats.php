<?php

require '../vendor/autoload.php';

$season = 2017;

$stats = array(
	'owners' => array(),
	'singleWeek' => array(
		'best' => array(
			'linkFranchiseId' => 0,
			'name' => '',
			'score' => 0,
			'opponent' => '',
			'week' => 0
		),
		'worst' => array(
			'linkFranchiseId' => 0,
			'name' => '',
			'score' => 0,
			'opponent' => '',
			'week' => 0
		)
	),
	'matchup' => array(
		'most' => array(
			'linkFranchiseId' => 0,
			'totalPoints' => 0,
			'awayName' => '',
			'homeName' => '',
			'week' => 0
		),
		'fewest' => array(
			'linkFranchiseId' => 0,
			'totalPoints' => 0,
			'awayName' => '',
			'homeName' => '',
			'week' => 0
		)
	),
	'decisiveVictory' => array(
		'most' => array(
			'linkFranchiseId' => 0,
			'winnerName' => '',
			'scoreDifference' => 0,
			'loserName' => '',
			'week' => 0
		),
		'least' => array(
			'linkFranchiseId' => 0,
			'winnerName' => '',
			'scoreDifference' => 0,
			'loserName' => '',
			'week' => 0
		)
	),
	'flukiestOutcome' => array(
		'win' => array(
			'linkFranchiseId' => 0,
			'score' => 0,
			'winnerName' => '',
			'loserName' => '',
			'week' => 0
		),
		'loss' => array(
			'linkFranchiseId' => 0,
			'loserName' => '',
			'score' => 0,
			'winnerName' => '',
			'week' => 0
		)
	),
	'scores' => array(
		'all' => array(),
		'owner' => array()
	),
	'averages' => array(
		'all' => 0,
		'owner' => array()
	),
	'standardDeviations' => array(
		'all' => 0,
		'owner' => array(),
		'highest' => array(
			'name' => '',
			'franchiseId' => 0,
			'value' => 0
		),
		'lowest' => array(
			'name' => '',
			'franchiseId' => 0,
			'value' => 0
		)
	)
);

$m = new MongoDB\Client('mongodb://localhost:27017/');
$c = $m->pso->games;

$cursor = $c->find(array(
	'season' => $season,
	'$or' => array(
		array('winner' => array('$exists' => true), 'loser' => array('$exists' => true)),
		array('tie' => array('$exists' => true))
	)
));

foreach ($cursor as $document) {
	$stats['owners'][$document['away']['franchiseId']] = $document['away']['name'];
	$stats['owners'][$document['home']['franchiseId']] = $document['home']['name'];

	$singleWeekBestScore = $stats['singleWeek']['best']['score'];
	$singleWeekWorstScore = $stats['singleWeek']['worst']['score'];

	if ($singleWeekBestScore == 0 || $document['away']['score'] > $singleWeekBestScore) {
		$stats['singleWeek']['best'] = array(
			'linkFranchiseId' => $document['away']['franchiseId'],
			'name' => $document['away']['name'],
			'score' => $document['away']['score'],
			'opponent' => $document['home']['name'],
			'week' => $document['week']
		);
		$singleWeekBestScore = $document['away']['score'];
	}

	if ($document['home']['score'] > $singleWeekBestScore) {
		$stats['singleWeek']['best'] = array(
			'linkFranchiseId' => $document['away']['franchiseId'],
			'name' => $document['home']['name'],
			'score' => $document['home']['score'],
			'opponent' => $document['away']['name'],
			'week' => $document['week']
		);
		$singleWeekBestScore = $document['home']['score'];
	}

	if ($singleWeekWorstScore == 0 || $document['away']['score'] < $singleWeekWorstScore) {
		$stats['singleWeek']['worst'] = array(
			'linkFranchiseId' => $document['away']['franchiseId'],
			'name' => $document['away']['name'],
			'score' => $document['away']['score'],
			'opponent' => $document['home']['name'],
			'week' => $document['week']
		);
		$singleWeekWorstScore = $document['away']['score'];
	}

	if ($document['home']['score'] < $singleWeekWorstScore) {
		$stats['singleWeek']['worst'] = array(
			'linkFranchiseId' => $document['away']['franchiseId'],
			'name' => $document['home']['name'],
			'score' => $document['home']['score'],
			'opponent' => $document['away']['name'],
			'week' => $document['week']
		);
		$singleWeekWorstScore = $document['home']['score'];
	}

	$matchupMostTotalPoints = $stats['matchup']['most']['totalPoints'];
	$matchupFewestTotalPoints = $stats['matchup']['fewest']['totalPoints'];

	if ($matchupMostTotalPoints == 0 || ($document['away']['score'] + $document['home']['score']) > $matchupMostTotalPoints) {
		$stats['matchup']['most'] = array(
			'linkFranchiseId' => $document['away']['franchiseId'],
			'totalPoints' => $document['away']['score'] + $document['home']['score'],
			'awayName' => $document['away']['name'],
			'homeName' => $document['home']['name'],
			'week' => $document['week']
		);
	}

	if ($matchupFewestTotalPoints == 0 || ($document['away']['score'] + $document['home']['score']) < $matchupFewestTotalPoints) {
		$stats['matchup']['fewest'] = array(
			'linkFranchiseId' => $document['away']['franchiseId'],
			'totalPoints' => $document['away']['score'] + $document['home']['score'],
			'awayName' => $document['away']['name'],
			'homeName' => $document['home']['name'],
			'week' => $document['week']
		);
	}

	$decisiveVictoryMostScoreDifference = $stats['decisiveVictory']['most']['scoreDifference'];
	$decisiveVictoryLeastScoreDifference = $stats['decisiveVictory']['least']['scoreDifference'];

	if ($decisiveVictoryMostScoreDifference == 0 || ($document['winner']['score'] - $document['loser']['score']) > $decisiveVictoryMostScoreDifference) {
		$stats['decisiveVictory']['most'] = array(
			'linkFranchiseId' => $document['away']['franchiseId'],
			'winnerName' => $document['winner']['name'],
			'scoreDifference' => $document['winner']['score'] - $document['loser']['score'],
			'loserName' => $document['loser']['name'],
			'week' => $document['week']
		);
	}

	if ($decisiveVictoryLeastScoreDifference == 0 || ($document['winner']['score'] - $document['loser']['score']) < $decisiveVictoryLeastScoreDifference) {
		$stats['decisiveVictory']['least'] = array(
			'linkFranchiseId' => $document['away']['franchiseId'],
			'winnerName' => $document['winner']['name'],
			'scoreDifference' => $document['winner']['score'] - $document['loser']['score'],
			'loserName' => $document['loser']['name'],
			'week' => $document['week']
		);
	}

	$flukiestOutcomeWinScore = $stats['flukiestOutcome']['win']['score'];
	$flukiestOutcomeLossScore = $stats['flukiestOutcome']['loss']['score'];

	if ($flukiestOutcomeWinScore == 0 || $document['winner']['score'] < $flukiestOutcomeWinScore) {
		$stats['flukiestOutcome']['win'] = array(
			'linkFranchiseId' => $document['away']['franchiseId'],
			'winnerName' => $document['winner']['name'],
			'score' => $document['winner']['score'],
			'loserName' => $document['loser']['name'],
			'week' => $document['week']
		);
	}

	if ($flukiestOutcomeLossScore == 0 || $document['loser']['score'] > $flukiestOutcomeLossScore) {
		$stats['flukiestOutcome']['loss'] = array(
			'linkFranchiseId' => $document['away']['franchiseId'],
			'loserName' => $document['loser']['name'],
			'score' => $document['loser']['score'],
			'winnerName' => $document['winner']['name'],
			'week' => $document['week']
		);
	}

	array_push($stats['scores']['all'], $document['away']['score'], $document['home']['score']);

	if (!isset($stats['scores']['owner'][$document['away']['franchiseId']])) {
		$stats['scores']['owner'][$document['away']['franchiseId']] = array();
	}
	if (!isset($stats['scores']['owner'][$document['home']['franchiseId']])) {
		$stats['scores']['owner'][$document['home']['franchiseId']] = array();
	}

	array_push($stats['scores']['owner'][$document['away']['franchiseId']], $document['away']['score']);
	array_push($stats['scores']['owner'][$document['home']['franchiseId']], $document['home']['score']);
}

$leagueScores = $stats['scores']['all'];
$leagueAverage = array_sum($leagueScores) / count($leagueScores);
$leagueVariance = 0;

foreach ($leagueScores as $score) {
	$leagueVariance += pow($score - $leagueAverage, 2);
}

$leagueStandardDeviation = sqrt($leagueVariance / (count($leagueScores) - 1));

$stats['averages']['all'] = $leagueAverage;
$stats['standardDeviations']['all'] = $leagueStandardDeviation;

foreach ($stats['scores']['owner'] as $ownerFranchiseId => $ownerScores) {
	$ownerName = $stats['owners'][$ownerFranchiseId];
	$ownerAverage = array_sum($ownerScores) / count($ownerScores);
	$ownerVariance = 0;

	/*
	echo $ownerName;
	echo '<pre>' . print_r($ownerScores, true) . '</pre>';
	*/

	foreach ($ownerScores as $score) {
		$ownerVariance += pow($score - $ownerAverage, 2);
	}

	$ownerStandardDeviation = sqrt($ownerVariance / (count($ownerScores) - 1));

	$stats['averages']['owner'][$ownerFranchiseId] = $ownerAverage;
	$stats['standardDeviations']['owner'][$ownerFranchiseId] = $ownerStandardDeviation;

	if ($stats['standardDeviations']['highest']['value'] == 0 || $ownerStandardDeviation > $stats['standardDeviations']['highest']['value']) {
		$stats['standardDeviations']['highest']['name'] = $ownerName;
		$stats['standardDeviations']['highest']['franchiseId'] = $ownerFranchiseId;
		$stats['standardDeviations']['highest']['value'] = $ownerStandardDeviation;
	}
	if ($stats['standardDeviations']['lowest']['value'] == 0 || $ownerStandardDeviation < $stats['standardDeviations']['lowest']['value']) {
		$stats['standardDeviations']['lowest']['name'] = $ownerName;
		$stats['standardDeviations']['lowest']['franchiseId'] = $ownerFranchiseId;
		$stats['standardDeviations']['lowest']['value'] = $ownerStandardDeviation;
	}
}

?>
<textarea rows="40" cols="120">
<strong>Single Week Performances</strong>
<em>Best:</em> <a href="http://games.espn.go.com/ffl/boxscorequick?leagueId=122885&teamId=<?= $stats['singleWeek']['best']['linkFranchiseId']; ?>&scoringPeriodId=<?= $stats['singleWeek']['best']['week']; ?>&seasonId=<?= $season; ?>&view=scoringperiod&version=quick"><?= $stats['singleWeek']['best']['name']; ?></a> (<?= number_format($stats['singleWeek']['best']['score'], 2); ?> points against <?= $stats['singleWeek']['best']['opponent']; ?> in Week <?= $stats['singleWeek']['best']['week']; ?>)
<em>Worst:</em> <a href="http://games.espn.go.com/ffl/boxscorequick?leagueId=122885&teamId=<?= $stats['singleWeek']['worst']['linkFranchiseId']; ?>&scoringPeriodId=<?= $stats['singleWeek']['worst']['week']; ?>&seasonId=<?= $season; ?>&view=scoringperiod&version=quick"><?= $stats['singleWeek']['worst']['name']; ?></a> (<?= number_format($stats['singleWeek']['worst']['score'], 2); ?> points against <?= $stats['singleWeek']['worst']['opponent']; ?> in Week <?= $stats['singleWeek']['worst']['week']; ?>)
<em>Average:</em> <?= number_format($stats['averages']['all'], 2); ?> points

<strong>Combined Matchup Points</strong>
<em>Most:</em> <a href="http://games.espn.go.com/ffl/boxscorequick?leagueId=122885&teamId=<?= $stats['matchup']['most']['linkFranchiseId']; ?>&scoringPeriodId=<?= $stats['matchup']['most']['week']; ?>&seasonId=<?= $season; ?>&view=scoringperiod&version=quick"><?= $stats['matchup']['most']['awayName']; ?> vs. <?= $stats['matchup']['most']['homeName']; ?></a> (<?= number_format($stats['matchup']['most']['totalPoints'], 2); ?> points in Week <?= $stats['matchup']['most']['week']; ?>)
<em>Fewest:</em> <a href="http://games.espn.go.com/ffl/boxscorequick?leagueId=122885&teamId=<?= $stats['matchup']['fewest']['linkFranchiseId']; ?>&scoringPeriodId=<?= $stats['matchup']['fewest']['week']; ?>&seasonId=<?= $season; ?>&view=scoringperiod&version=quick"><?= $stats['matchup']['fewest']['awayName']; ?> vs. <?= $stats['matchup']['fewest']['homeName']; ?></a> (<?= number_format($stats['matchup']['fewest']['totalPoints'], 2); ?> points in Week <?= $stats['matchup']['fewest']['week']; ?>)

<strong>Decisive Victories</strong>
<em>Most:</em> <a href="http://games.espn.go.com/ffl/boxscorequick?leagueId=122885&teamId=<?= $stats['decisiveVictory']['most']['linkFranchiseId']; ?>&scoringPeriodId=<?= $stats['decisiveVictory']['most']['week']; ?>&seasonId=<?= $season; ?>&view=scoringperiod&version=quick"><?= $stats['decisiveVictory']['most']['winnerName']; ?></a> (won by <?= number_format($stats['decisiveVictory']['most']['scoreDifference'], 2); ?> points against <?= $stats['decisiveVictory']['most']['loserName']; ?> in Week <?= $stats['decisiveVictory']['most']['week']; ?>)
<em>Least:</em> <a href="http://games.espn.go.com/ffl/boxscorequick?leagueId=122885&teamId=<?= $stats['decisiveVictory']['least']['linkFranchiseId']; ?>&scoringPeriodId=<?= $stats['decisiveVictory']['least']['week']; ?>&seasonId=<?= $season; ?>&view=scoringperiod&version=quick"><?= $stats['decisiveVictory']['least']['winnerName']; ?></a> (won by <?= number_format($stats['decisiveVictory']['least']['scoreDifference'], 2); ?> points against <?= $stats['decisiveVictory']['least']['loserName']; ?> in Week <?= $stats['decisiveVictory']['least']['week']; ?>)

<strong>Flukiest Outcomes</strong>
<em>Win:</em> <a href="http://games.espn.go.com/ffl/boxscorequick?leagueId=122885&teamId=<?= $stats['flukiestOutcome']['win']['linkFranchiseId']; ?>&scoringPeriodId=<?= $stats['flukiestOutcome']['win']['week']; ?>&seasonId=<?= $season; ?>&view=scoringperiod&version=quick"><?= $stats['flukiestOutcome']['win']['winnerName']; ?></a> (won despite scoring <?= number_format($stats['flukiestOutcome']['win']['score'], 2); ?> points against <?= $stats['flukiestOutcome']['win']['loserName']; ?> in Week <?= $stats['flukiestOutcome']['win']['week']; ?>)
<em>Loss:</em> <a href="http://games.espn.go.com/ffl/boxscorequick?leagueId=122885&teamId=<?= $stats['flukiestOutcome']['loss']['linkFranchiseId']; ?>&scoringPeriodId=<?= $stats['flukiestOutcome']['loss']['week']; ?>&seasonId=<?= $season; ?>&view=scoringperiod&version=quick"><?= $stats['flukiestOutcome']['loss']['loserName']; ?></a> (lost despite scoring <?= number_format($stats['flukiestOutcome']['loss']['score'], 2); ?> points against <?= $stats['flukiestOutcome']['loss']['winnerName']; ?> in Week <?= $stats['flukiestOutcome']['loss']['week']; ?>)

<strong>Week-to-Week Consistency</strong>
<em>Most:</em> <a href="http://games.espn.go.com/ffl/schedule?leagueId=122885&teamId=<?= $stats['standardDeviations']['lowest']['franchiseId']; ?>"><?= $stats['standardDeviations']['lowest']['name']; ?></a> (standard deviation of <?= number_format($stats['standardDeviations']['lowest']['value'], 2); ?> points)
<em>Least:</em> <a href="http://games.espn.go.com/ffl/schedule?leagueId=122885&teamId=<?= $stats['standardDeviations']['highest']['franchiseId']; ?>"><?= $stats['standardDeviations']['highest']['name']; ?></a> (standard deviation of <?= number_format($stats['standardDeviations']['highest']['value'], 2); ?> points)
<em>Overall:</em> <?= number_format($stats['standardDeviations']['all'], 2); ?> points</textarea>
