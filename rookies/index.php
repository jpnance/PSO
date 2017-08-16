<?php

	require '../vendor/autoload.php';

	$positionOrder = array("QB", "RB", "WR", "TE", "LB", "DL", "DB", "K");

	$salaries = [
		'2017' => [ 'DB' => 2, 'DL' => 2, 'K' => 2, 'LB' => 1, 'QB' => 31, 'RB' => 24, 'TE' => 17, 'WR' => 18 ],
		'2016' => [ 'DB' => 2, 'DL' => 3, 'K' => 1, 'LB' => 2, 'QB' => 32, 'RB' => 25, 'TE' => 15, 'WR' => 17 ],
		'2015' => [ 'DB' => 2, 'DL' => 3, 'K' => 1, 'LB' => 1, 'QB' => 24, 'RB' => 27, 'TE' => 15, 'WR' => 17 ],
		'2014' => [ 'DB' => 2, 'DL' => 2, 'K' => 2, 'LB' => 1, 'QB' => 19, 'RB' => 24, 'TE' => 28, 'WR' => 19 ],
		'2013' => [ 'DB' => 2, 'DL' => 3, 'K' => 1, 'LB' => 2, 'QB' => 17, 'RB' => 26, 'TE' => 18, 'WR' => 18 ],
		'2012' => [ 'DB' => 1, 'DL' => 1, 'K' => 1, 'LB' => 1, 'QB' => 25, 'RB' => 25, 'TE' => 7, 'WR' => 16 ],
		'2011' => [ 'DB' => 1, 'DL' => 1, 'K' => 1, 'LB' => 2, 'QB' => 25, 'RB' => 25, 'TE' => 3, 'WR' => 26 ],
		'2010' => [ 'DB' => 1, 'DL' => 2, 'K' => 1, 'LB' => 2, 'QB' => 24, 'RB' => 28, 'TE' => 4, 'WR' => 15 ]
	];

	$seasons = array_keys($salaries);
	rsort($seasons);

	$currentSeason = $_GET['season'] ?? $seasons[0];

?>
<html>
	<head>
		<title>Rookie Salaries for <?= $currentSeason; ?></title>
		<style type="text/css">
			body {
				font-family: verdana;
			}

			h1 {
				margin: 0.5em;
				padding: 0;
				text-align: center;
			}

			h1 select {
				font-family: verdana;
				font-size: 100%;
				font-weight: bold;
			}

			table {
				border: 1px solid gray;
				border-collapse: collapse;
				font-size: 80%;
				margin-left: auto;
				margin-right: auto;
			}

			table.hidden {
				display: none;
			}

			th {
				padding: 10px;
			}

			td {
				padding: 5px;
				text-align: center;
			}

			.round0 {
			}

			.round1 {
				background-color: rgb(240, 240, 240);
			}
		</style>
		<script type="text/javascript" src="../vendor/components/jquery/jquery.slim.min.js"></script>
		<script type="text/javascript">
			$(document).ready(function() {
				$('select').on('change', function(e) {
					var $this = $(this);

					window.history.replaceState({ season: $this.val() }, 'Rookie Salaries for ' + $this.val(), '?season=' + $this.val());

					displaySeason($this.val());
				});

				window.onpopstate = function(e) {
					if (e.state) {
						displaySeason(e.state.season);
					}
					else {
						displaySeason(<?= $currentSeason; ?>);
					}
				};

			});

			function displaySeason(season) {
				$('title').text('Rookie Salaries for ' + season);

				$('table').addClass('hidden');
				$('table#rookies' + season).removeClass('hidden');

				$('select').val(season);
			}
		</script>
	</head>
	<body>
		<h1>
			Rookie Salaries for
			<select name="season">
			<?php foreach ($seasons as $season): ?>
				<option value="<?= $season; ?>" <?= ($season == $currentSeason) ? 'selected="selected"' : ''; ?>><?= $season; ?></option>
			<?php endforeach; ?>
			</select>
		</h1>

		<?php foreach ($seasons as $season): ?>
			<table id="rookies<?= $season; ?>" class="<?= ($season == $currentSeason) ? '' : 'hidden'; ?>">
				<tr>
					<th>Round</th>
					<?php foreach ($positionOrder as $position): ?>
						<th><?= $position; ?></th>
					<?php endforeach; ?>
				</tr>
				<?php foreach ([1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as $round): ?>
					<tr class="round<?= ($round % 2); ?>">
						<td><?= $round; ?></td>
						<?php foreach ($positionOrder as $position): ?>
							<td>$<?= ceil($salaries[$season][$position] / pow(2, $round - 1)); ?></td>
						<?php endforeach; ?>
					</tr>
				<?php endforeach; ?>
			</table>
		<?php endforeach; ?>
	</body>
</html>
