<?php

	$owners = [
		'Brett/Luke' => 7,
		'Daniel' => 8,
		'James' => 9,
		'John/Zach' => 4,
		'Keyon' => 6,
		'Koci/Mueller' => 2,
		'Mitch' => 12,
		'Patrick' => 1,
		'Quinn' => 11,
		'Schex/Jeff' => 10,
		'Syed/Terence' => 3,
		'Trevor' => 5
	];

	$ownersOrder = array_keys($owners);
	sort($ownersOrder);

?>
<!doctype html>
<html>
	<head>
		<title>PSO Scheduler</title>
		<script type="text/javascript" src="../vendor/components/jquery/jquery.slim.min.js"></script>
		<script type="text/javascript">
			var template = [
				[ [1, 2], [3, 4], [5, 8], [6, 7], [9, 12], [10, 11] ],
				[ [1, 8], [2, 7], [3, 11], [4, 12], [5, 6], [9, 10] ],
				[ [1, 11], [2, 12], [3, 5], [4, 10], [6, 8], [7, 9] ],
				[ [1, 4], [2, 3], [5, 12], [6, 11], [7, 10], [8, 9] ],
				[ [1, 10], [2, 5], [3, 12], [4, 7], [6, 9], [8, 11] ],
				[ [1, 7], [2, 6], [3, 9], [4, 8], [5, 10], [11, 12] ],
				[ [1, 3], [2, 4], [5, 9], [6, 10], [7, 11], [8, 12] ],
				[ [1, 2], [3, 4], [5, 8], [6, 7], [9, 12], [10, 11] ],
				[ [1, 6], [2, 8], [3, 7], [4, 9], [5, 11], [10, 12] ],
				[ [1, 9], [2, 11], [3, 10], [4, 5], [6, 12], [7, 8] ],
				[ [1, 4], [2, 3], [5, 12], [6, 11], [7, 10], [8, 9] ],
				[ [1, 12], [2, 9], [3, 6], [4, 11], [5, 7], [8, 10] ],
				[ [1, 5], [2, 10], [3, 8], [4, 6], [7, 12], [9, 11] ],
				[ [1, 3], [2, 4], [5, 9], [6, 10], [7, 11], [8, 12] ]
			];

			$(document).ready(function() {
				$('button').on('click', function(e) {
					$('div.results').empty();

					var teamIds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

					var champion = parseInt($('select[name=champion]').val());
					var runnerUp = parseInt($('select[name=runner-up]').val());

					teamIds = teamIds.filter(function(id) {
						return id != champion && id != runnerUp;
					});

					teamIds = shuffle(teamIds);

					teamIds.unshift(runnerUp);
					teamIds.unshift(champion);
					teamIds.unshift('--');

					var output = '';
					var url = 'http://games.espn.com/ffl/tools/lmeditschedule?leagueId=122885&matchupPeriodId=1';

					var $p = $('<p>');
					var $textarea = $('<textarea rows="20" cols="120">');
					var $link = $('<a href="' + url + '">Schedule Editor</a><br />');

					template.forEach(function(games, week) {
						var params = { incoming: 1 };

						games.forEach(function(matchup, game) {
							params['home' + game] = teamIds[matchup[1]];
							params['away' + game] = teamIds[matchup[0]];
						});

						output += 'jQuery.post(\'http://games.espn.com/ffl/tools/lmeditschedule?leagueId=122885&matchupPeriodId=' + (week + 1) + '\', ' + JSON.stringify(params) + ').then(function() {';
					});

					output += '});});});});});});});});});});});});});});';

					$textarea.text(output);
					$p.append($link).append($textarea);
					$('div.results').append($p);
				});
			});

			function shuffle(array) {
				var m = array.length, t, i;

				// While there remain elements to shuffle…
				while (m) {

					// Pick a remaining element…
					i = Math.floor(Math.random() * m--);

					// And swap it with the current element.
					t = array[m];
					array[m] = array[i];
					array[i] = t;
				}

				return array;
			}
		</script>
	</head>
	<body>
		<h1>PSO Scheduler</h1>
		<p>
			Who won last year?<br />
			<select name="champion">
				<option value="--">--</option>
				<?php foreach ($ownersOrder as $owner): ?>
					<option value="<?= $owners[$owner]; ?>"><?= $owner; ?></option>
				<?php endforeach; ?>
			</select>
		</p>
		<p>
			Who came in second?<br />
			<select name="runner-up">
				<option value="--">--</option>
				<?php foreach ($ownersOrder as $owner): ?>
					<option value="<?= $owners[$owner]; ?>"><?= $owner; ?></option>
				<?php endforeach; ?>
			</select>
		</p>
		<p>
			<button type="submit">Go</button>
		</p>
		<div class="results">
		</div>
	</body>
</html>
