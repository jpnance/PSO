var gatherConditions = function() {
	var conditions = [];

	$('input:checked').each(function() {
		var $this = $(this);
		var condition = $this.val();

		if (condition != 'vs') {
			conditions.push(condition);
		}
	});

	return conditions;
};

var replaceTable = function(conditions) {
	var conditions = conditions || gatherConditions();
	console.log(conditions);

	$.post('/simulator/' + conditions.join(','), function(data) {
		$('table').replaceWith(data);
		$('[data-toggle="tooltip"]').tooltip();
	});
};

$(document).ready(function() {
	$('label.winner.active').removeClass('active');

	replaceTable([]);

	$('div.btn-group-vertical').on('click', 'input', function(e) {
		$('table').animate({ opacity: 0.3 }, 100, 'linear', replaceTable);
	});
});
