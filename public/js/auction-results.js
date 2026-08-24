(function() {
	var sortButtons = document.querySelectorAll('.auction-results__sorts button:not(:disabled)');
	var list = document.querySelector('.auction-results__list');

	if (!sortButtons.length || !list) return;

	// Track current sort state
	var currentSort = null;
	var ascending = true;

	// Detect initial sort from selected button
	var initialBtn = document.querySelector('.auction-results__sorts button.btn-primary:not(:disabled)');
	if (initialBtn) {
		currentSort = initialBtn.dataset.sort;
		// Time defaults to ascending (chronological) for completed auctions
		// Name defaults to ascending (A-Z)
		// Salary defaults to descending (highest first)
		ascending = currentSort !== 'salary';
	}

	// Icon classes for each sort type and direction
	var icons = {
		time: { asc: 'fa-clock-o', desc: 'fa-clock-o' },
		name: { asc: 'fa-sort-alpha-asc', desc: 'fa-sort-alpha-desc' }
	};

	function updateButtonIcon(btn, sortKey, isAsc) {
		var icon = btn.querySelector('i');
		if (!icon || !icons[sortKey]) return;
		icon.className = 'fa ' + icons[sortKey][isAsc ? 'asc' : 'desc'];
	}

	function applySort(sortBy, asc) {
		var rows = Array.from(list.querySelectorAll('.auction-results__row'));
		var dir = asc ? 1 : -1;

		rows.sort(function(a, b) {
			var result = 0;
			if (sortBy === 'name') {
				result = a.dataset.name.localeCompare(b.dataset.name);
			} else if (sortBy === 'salary') {
				result = parseInt(a.dataset.salary, 10) - parseInt(b.dataset.salary, 10);
			} else if (sortBy === 'time') {
				result = parseInt(a.dataset.time, 10) - parseInt(b.dataset.time, 10);
			}
			return result * dir;
		});

		rows.forEach(function(row) {
			list.appendChild(row);
		});
	}

	sortButtons.forEach(function(btn) {
		btn.addEventListener('click', function() {
			var sortKey = this.dataset.sort;

			if (currentSort === sortKey) {
				// Toggle direction
				ascending = !ascending;
			} else {
				// New sort key - use default direction
				currentSort = sortKey;
				ascending = sortKey !== 'salary'; // Salary defaults to descending
			}

			// Update button styles
			sortButtons.forEach(function(b) {
				b.classList.remove('btn-primary');
				b.classList.add('btn-outline-secondary');
				// Reset icons to default
				var key = b.dataset.sort;
				if (icons[key]) {
					updateButtonIcon(b, key, key !== 'salary');
				}
			});
			this.classList.remove('btn-outline-secondary');
			this.classList.add('btn-primary');
			updateButtonIcon(this, sortKey, ascending);

			applySort(sortKey, ascending);
		});
	});
})();
