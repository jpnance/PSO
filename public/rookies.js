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
			displaySeason(currentSeason);
		}
	};

});

function displaySeason(season) {
	$('title').text('Rookie Salaries for ' + season);

	$('table').addClass('hidden');
	$('table#rookies' + season).removeClass('hidden');

	$('select').val(season);
}
