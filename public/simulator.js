$(document).ready(function() {
	$.post('/simulator', function(data) {
		$('table').replaceWith(data);
		$('[data-toggle="tooltip"]').tooltip();
	});
});
