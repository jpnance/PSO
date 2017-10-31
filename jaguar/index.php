<!doctype html>
<html>
	<head>
		<title>The Jaguar Chart</title>
		<link rel="stylesheet" type="text/css" href="jaguar.css" />
	</head>
	<body>
		<h1>The Jaguar Chart</h1>
<?php

require '../vendor/autoload.php';

$franchiseMappings = [
	'Brett/Luke' => 'Luke',
	'Jake/Luke' => 'Luke',
	'Keyon' => 'Keyon',
	'Pat/Quinn' => 'Patrick',
	'Patrick' => 'Patrick',
	'Schex' => 'Schex',
	'Schex/Jeff' => 'Schex',
	'Schexes' => 'Schex'
];

$jaguarOwners = ['Keyon', 'Luke', 'Patrick', 'Schex'];

$m = new MongoDB\Client('mongodb://localhost:27017');
$c = $m->pso->games;

$cursor = $c->find([
	'$and' => [
		['season' => ['$gte' => 2012]],
		['home.name' => ['$in' => array_keys($franchiseMappings)]],
		['away.name' => ['$in' => array_keys($franchiseMappings)]],
		['type' => 'regular']
	]
]);

$seasons = [];
$records = [];

foreach ($cursor as $document) {
	$season = $document['season'];
	$homeName = $franchiseMappings[$document['home']['name']];
	$homeScore = $document['home']['score'] ?: null;
	$awayName = $franchiseMappings[$document['away']['name']];
	$awayScore = $document['away']['score'] ?: null;
	$tie = isset($document['tie']) ? true : false;
	$week = $document['week'];

	if (!isset($seasons[$season])) {
		$seasons[$season] = [];
	}

	if (!isset($seasons[$season]['owners'][$homeName])) {
		$seasons[$season]['owners'][$homeName] = [];
		$seasons[$season]['owners'][$homeName]['total'] = [];
		$seasons[$season]['owners'][$homeName]['total']['wins'] = 0;
		$seasons[$season]['owners'][$homeName]['total']['losses'] = 0;
		$seasons[$season]['owners'][$homeName]['total']['status'] = null;
		$seasons[$season]['owners'][$homeName]['opponents'] = [];
		$seasons[$season]['owners'][$homeName]['opponents'][$awayName] = [];
		$seasons[$season]['owners'][$homeName]['opponents'][$awayName]['games'] = [];
	}

	if (!isset($seasons[$season]['owners'][$awayName])) {
		$seasons[$season]['owners'][$awayName] = [];
		$seasons[$season]['owners'][$awayName]['total'] = [];
		$seasons[$season]['owners'][$awayName]['total']['wins'] = 0;
		$seasons[$season]['owners'][$awayName]['total']['losses'] = 0;
		$seasons[$season]['owners'][$awayName]['total']['status'] = null;
		$seasons[$season]['owners'][$awayName]['opponents'] = [];
		$seasons[$season]['owners'][$awayName]['opponents'][$homeName] = [];
		$seasons[$season]['owners'][$awayName]['opponents'][$homeName]['games'] = [];
	}

	if ($homeScore && $awayScore) {
		$seasons[$season]['owners'][$homeName]['opponents'][$awayName]['games'][] = ['week' => $week, 'result' => (($homeScore > $awayScore) ? 'win' : 'loss'), 'differential' => $homeScore - $awayScore];
		$seasons[$season]['owners'][$awayName]['opponents'][$homeName]['games'][] = ['week' => $week, 'result' => (($awayScore > $homeScore) ? 'win' : 'loss'), 'differential' => $awayScore - $homeScore];
	}
	else {
		$seasons[$season]['owners'][$homeName]['opponents'][$awayName]['games'][] = ['week' => $week, 'result' => 'scheduled'];
		$seasons[$season]['owners'][$awayName]['opponents'][$homeName]['games'][] = ['week' => $week, 'result' => 'scheduled'];
	}
}

krsort($seasons);

if (isset($_GET['season'])) {
	$currentSeason = intval($_GET['season']);
}
else {
	$currentSeason = array_keys($seasons)[0];
}

$results = 0;
$threeAndOh = false;

foreach ($seasons[$currentSeason]['owners'] as &$owner) {
	foreach ($owner['opponents'] as &$matchup) {
		$status = '';
		$unresolvedMatchups = false;
		$differential = 0;

		foreach ($matchup['games'] as $game) {
			if ($game['result'] == 'scheduled') {
				$unresolvedMatchups = true;
			}
			else {
				$differential += $game['differential'];
			}
		}

		if ($unresolvedMatchups) {
			if ($differential > 0) {
				$status = 'winning';
			}
			else if ($differential < 0) {
				$status = 'losing';
			}
			else {
				$status = 'scheduled';
			}
		}
		else {
			if ($differential > 0) {
				$status = 'won';
				$owner['total']['wins'] += 1;
				$results += 1;
			}
			else if ($differential < 0) {
				$status = 'lost';
				$owner['total']['losses'] += 1;
				$results += 1;
			}
		}

		$matchup['summary'] = compact('status', 'differential');
	}

	if ($owner['total']['losses'] >= 2) {
		$owner['total']['status'] = 'eliminated';
	}
	else if ($owner['total']['wins'] == 3) {
		$threeAndOh = true;
	}

	unset($matchup);
}

unset($owner);

$tiedOwners = [];

foreach ($seasons[$currentSeason]['owners'] as $owner => &$ownerData) {
	if ($threeAndOh && $ownerData['total']['wins'] != 3) {
		$ownerData['total']['status'] = 'eliminated';
	}
	else if ($results == 12 && $ownerData['total']['wins'] == 2) {
		array_push($tiedOwners, $owner);
	}
}

unset($ownerData);

if (count($tiedOwners) > 0) {
	$winner = ['differential' => 0, 'owner' => null];
	$differentials = [];

	foreach ($tiedOwners as $owner) {
		$differential = 0;

		foreach ($tiedOwners as $opponent) {
			if ($owner != $opponent) {
				$differential += $seasons[$currentSeason]['owners'][$owner]['opponents'][$opponent]['summary']['differential'];
			}
		}

		$differentials[$owner] = $differential;

		if ($differential > $winner['differential']) {
			$winner['differential'] = $differential;
			$winner['owner'] = $owner;
		}
	}

	foreach ($seasons[$currentSeason]['owners'] as $owner => &$ownerData) {
		if ($owner != $winner['owner']) {
			$ownerData['total']['status'] = 'eliminated';
		}
	}

	unset($ownerData);
}

?>
<div class="navigation">
<?php foreach ($seasons as $season => $seasonData): ?>
	<?php if ($season == $currentSeason): ?>
		<strong><?= $season; ?></strong>
	<?php else: ?>
		<a href="index.php?season=<?= $season; ?>"><?= $season; ?></a>
	<?php endif; ?>
<?php endforeach; ?>
</div>

		<table border="1">
			<tr>
				<td></td>
				<?php foreach ($jaguarOwners as $owner): ?>
					<th>vs. <?= $owner; ?></th>
				<?php endforeach ?>
				<th>Total</th>
			</tr>
			<?php foreach ($jaguarOwners as $owner): ?>
				<tr>
					<th><?= $owner; ?></th>
					<?php foreach ($jaguarOwners as $opponent): ?>
						<?php $opponentCssClass = strtolower($opponent); ?>

						<?php if ($owner == $opponent): ?>
							<td class="<?= $opponentCssClass; ?> self">--</td>
						<?php else: ?>
							<?php $matchup = $seasons[$currentSeason]['owners'][$owner]['opponents'][$opponent]; ?>
							<td class="<?= $opponentCssClass; ?> <?= $matchup['summary']['status']; ?>">
							<?php if ($matchup['summary']['status'] == 'won' || $matchup['summary']['status'] == 'lost'): ?>
									<?= $matchup['summary']['differential'] > 0 ? '+' : ''; ?><?= number_format($matchup['summary']['differential'], 2); ?>
							<?php else: ?>
								<?php foreach ($matchup['games'] as $game): ?>
									<?php if ($game['result'] == 'scheduled'): ?>
										<span class="scheduled">Week <?= $game['week']; ?></span>
									<?php else: ?>
										<?= $game['differential'] > 0 ? '+' : ''; ?><?= number_format($game['differential'], 2); ?>
									<?php endif; ?>
								<?php endforeach; ?>
							<?php endif; ?>
							</td>
						<?php endif; ?>
					<?php endforeach ?>
					<?php $total = $seasons[$currentSeason]['owners'][$owner]['total']; ?>
					<td class="<?= $total['status']; ?>"><?= $total['wins']; ?>-<?= $total['losses']; ?></td>
				</tr>
			<?php endforeach; ?>
		</table>

	</body>
</html>
