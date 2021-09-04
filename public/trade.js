$(document).ready(function() {
	$('.form-check-input:checked').each((i, input) => {
		var franchiseId = input.id;
		$('div[id=gets-' + franchiseId).removeClass('d-none');
	});

	$('.form-check').on('click', '.form-check-input', (e) => {
		var franchiseId = e.currentTarget.id;
		$('div[id=gets-' + franchiseId).toggleClass('d-none');
	});
});
