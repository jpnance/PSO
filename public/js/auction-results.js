(function() {
	var sortButtons = document.querySelectorAll('.auction-results__sorts button');
	var list = document.querySelector('.auction-results__list');

	if (!sortButtons.length || !list) return;

	function applySort(sortBy) {
		var rows = Array.from(list.querySelectorAll('.auction-results__row'));

		rows.sort(function(a, b) {
			if (sortBy === 'name') {
				return a.dataset.name.localeCompare(b.dataset.name);
			} else if (sortBy === 'salary') {
				return parseInt(b.dataset.salary, 10) - parseInt(a.dataset.salary, 10);
			} else if (sortBy === 'time') {
				return parseInt(b.dataset.time, 10) - parseInt(a.dataset.time, 10);
			}
			return 0;
		});

		rows.forEach(function(row) {
			list.appendChild(row);
		});
	}

	sortButtons.forEach(function(btn) {
		btn.addEventListener('click', function() {
			sortButtons.forEach(function(b) {
				b.classList.remove('btn-primary');
				b.classList.add('btn-outline-secondary');
			});
			this.classList.remove('btn-outline-secondary');
			this.classList.add('btn-primary');
			applySort(this.dataset.sort);
		});
	});
})();
