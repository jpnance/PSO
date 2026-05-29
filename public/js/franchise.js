(function() {
	var filterButtons = document.querySelectorAll('.franchise-roster__filters button');
	var sortButtons = document.querySelectorAll('.franchise-roster__sorts button');
	var rows = document.querySelectorAll('.player-table__row');

	if (filterButtons.length === 0) return;

	var currentSeasonBtn = document.querySelector('.franchise-roster__filters button.btn-primary');
	var currentSeason = currentSeasonBtn ? currentSeasonBtn.dataset.filter : null;

	function isRfaRow(row) {
		return row.closest('.player-table__group--rfa') !== null;
	}

	function applyFilter(filter) {
		if (filter === currentSeason) {
			rows.forEach(function(row) { row.classList.remove('is-dimmed'); });
			return;
		}

		rows.forEach(function(row) {
			if (isRfaRow(row)) return;

			var endYear = parseInt(row.dataset.endyear, 10);
			var isExpiring = row.dataset.expiring === 'true';

			var matches = false;
			if (filter === 'expiring') {
				matches = isExpiring;
			} else {
				var year = parseInt(filter, 10);
				matches = !isNaN(endYear) && endYear >= year;
			}

			if (matches) {
				row.classList.remove('is-dimmed');
			} else {
				row.classList.add('is-dimmed');
			}
		});
	}

	filterButtons.forEach(function(btn) {
		btn.addEventListener('click', function() {
			filterButtons.forEach(function(b) {
				b.classList.remove('btn-primary');
				b.classList.add('btn-outline-secondary');
			});
			this.classList.remove('btn-outline-secondary');
			this.classList.add('btn-primary');
			applyFilter(this.dataset.filter);
		});
	});

	function applySalarySort() {
		document.querySelectorAll('.player-table__body').forEach(function(tbody) {
			if (tbody.closest('.player-table__group--rfa')) return;
			var dataRows = Array.from(tbody.querySelectorAll('.player-table__row'));
			if (dataRows.length === 0) return;

			dataRows.sort(function(a, b) {
				var salaryA = a.querySelector('.player-table__detail--salary');
				var salaryB = b.querySelector('.player-table__detail--salary');
				var valA = salaryA ? parseInt(salaryA.textContent.replace(/\D/g, ''), 10) || 0 : 0;
				var valB = salaryB ? parseInt(salaryB.textContent.replace(/\D/g, ''), 10) || 0 : 0;
				return valB - valA;
			});

			dataRows.forEach(function(row) { tbody.appendChild(row); });
		});
	}

	function applyNameSort() {
		document.querySelectorAll('.player-table__body').forEach(function(tbody) {
			if (tbody.closest('.player-table__group--rfa')) return;
			var dataRows = Array.from(tbody.querySelectorAll('.player-table__row'));
			if (dataRows.length === 0) return;

			dataRows.sort(function(a, b) {
				var nameA = a.querySelector('.player-table__name').textContent.trim();
				var nameB = b.querySelector('.player-table__name').textContent.trim();
				return nameA.localeCompare(nameB);
			});

			dataRows.forEach(function(row) { tbody.appendChild(row); });
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

			if (this.dataset.sort === 'salary') {
				applySalarySort();
			} else {
				applyNameSort();
			}
		});
	});

	var rosterCard = document.getElementById('rosterCardBody');
	var rosterId = rosterCard ? rosterCard.dataset.rosterId : null;

	if (rosterId) {
		rosterCard.addEventListener('click', function(e) {
			var btn = e.target.closest('.player-table__cut-toggle');
			if (!btn) return;

			var playerId = btn.dataset.playerId;
			if (!playerId) return;

			btn.disabled = true;

			fetch('/franchises/' + rosterId + '/mark-for-cut', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ playerId: playerId })
			})
			.then(function(res) { return res.json(); })
			.then(function(data) {
				if (data.error) {
					alert(data.error);
					return;
				}

				var row = btn.closest('.player-table__row');
				var recoverableEl = row.querySelector('.player-table__recoverable');
				if (data.markedForCut) {
					row.classList.add('player-table__row--marked-for-cut');
					btn.classList.add('player-table__cut-toggle--active');
					btn.title = 'Unmark for cut';
					if (recoverableEl) recoverableEl.textContent = '+$' + data.recoverable;
				} else {
					row.classList.remove('player-table__row--marked-for-cut');
					btn.classList.remove('player-table__cut-toggle--active');
					btn.title = 'Mark for cut';
				}
			})
			.catch(function() {
				alert('Something went wrong. Please try again.');
			})
			.finally(function() {
				btn.disabled = false;
			});
		});
	}
})();
