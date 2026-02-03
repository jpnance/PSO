<html>
	<head>
		<title>Rookie Contract Values</title>
		<style type="text/css">
			body {
				font-family: verdana;
			}

			table {
				border: 1px solid gray;
				border-collapse: collapse;
				float: left;
				font-size: 80%;
				margin-right: 1em;
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
	</head>
	<body>
<?
	$positions = array("DB", "DL", "K", "LB", "QB", "RB", "TE", "WR");
	$positions = array("QB", "RB", "WR", "TE", "LB", "DL", "DB", "K");

	$rookies = array(
		"DB" => (76 + 15 + 7 + 7 + 5 + 4 + 3 + 3 + 2 + 2) / 10,
		"DL" => (35 + 31 + 21 + 15 + 10 + 8 + 4 + 4 + 3 + 3 ) / 10,
		"K" => (7 + 4 + 3 + 2 + 1 + 1 + 1 + 1 + 1 + 1) / 10,
		"LB" => (35 + 30 + 17 + 15 + 13 + 12 + 10 + 3 + 3 + 2) / 10,
		"QB" => (255 + 220 + 161 + 120 + 100 + 100 + 100 + 71 + 60 + 58) / 10,
		"RB" => (401 + 370 + 360 + 331 + 320 + 201 + 185 + 180 + 178 + 176) / 10,
		"TE" => (130 + 127 + 60 + 45 + 43 + 42 + 26 + 22 + 20 + 15) / 10,
		"WR" => (211 + 161 + 156 + 148 + 138 + 120 + 117 + 115 + 105 + 102) / 10
	);
?>

		<table>
			<tr>
				<th>Round</th>
<?
	foreach ($positions as $position) {
		echo "\t\t\t\t<th>" . $position . "</th>\n";
	}
?>
			</tr>
<?

	for ($i = 1; $i <= 10; $i++) {
		echo "\t\t\t<tr class=\"round" . ($i % 2) . "\">\n";
		echo "\t\t\t\t<td>" . $i . "</td>\n";

		foreach ($positions as $position) {
			echo "\t\t\t\t<td>$" . ceil(((11 - $i) / 10) * $rookies[$position]) . "</td>\n";
		}

		echo "\t\t\t</tr>\n";
	}
?>
		</table>
	</body>
</html>
