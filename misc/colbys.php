<!DOCTYPE html>
<html>
	<head>
		<title>The Colbys Rookie Draft Simulator</title>
		<script src="../vendor/components/jquery/jquery.slim.min.js"></script>
		<script type="text/javascript">
			var generateDraft = function() {
				var rounds = $('select[name=rounds]').val();
				var salary = $('input[name=salary]').val();
				var discount = $('input[name=discount]').val() / 100;

				var $table = $('<table>').append('<tr><td></td><th>1</th><th>2</th><th>3</th><th>4</th><th>5</th><th>6</th><th>7</th><th>8</th><th>9</th><th>10</th></tr>');

				for (var round = 1; round <= rounds; round++) {
					var $row = $('<tr>').append('<td>Round ' + round + '</td>');

					for (var pick = 1; pick <= 10; pick++) {
						$row.append('<td>$' + Math.ceil(salary) + '</td>');
						salary *= 1 - discount;
					}

					$table.append($row);
				}

				$('body table').remove();
				$('body').append($table);
			};

			$(document).ready(generateDraft);
			$(document).ready(function() {
				$('select, input').on('change', generateDraft);
			});
		</script>
		<style type="text/css">
			body {
				font-family: sans-serif;
			}

			table {
				border-collapse: collapse;
				margin-top: 20px;
			}

			td {
				padding: 10px;
				text-align: right;
			}
		</style>
	</head>
	<body>
		Rounds: 
		<select name="rounds">
			<option value="1">1</option>
			<option value="2">2</option>
			<option value="3">3</option>
			<option value="4" selected="selected">4</option>
			<option value="5">5</option>
			<option value="6">6</option>
			<option value="7">7</option>
			<option value="8">8</option>
			<option value="9">9</option>
			<option value="10">10</option>
		</select>
		<br />
		First Slot Money: <input type="text" name="salary" value="40" size="4" />
		<br />
		Discount: <input type="text" name="discount" value="10" size="4" />%
		<br />
	</body>
</html>
