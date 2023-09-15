$(document).ready(function() {
	var query = location.search.substring(1).split(/=/);

	if (query.length > 1 && query[1].match(/^20\d\d/)) {
		window.history.replaceState({ season: query[1] }, 'Rookie Salaries for ' + query[1] + '?season=' + query[1]);

		displaySeason(query[1]);
	}

	$('select').on('change', function(e) {
		var $this = $(this);

		window.history.pushState({ season: $this.val() }, 'Rookie Salaries for ' + $this.val(), '?season=' + $this.val());

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
