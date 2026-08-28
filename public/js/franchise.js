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

	function getEffectiveEndYear(row) {
		var pending = parseInt(row.dataset.pendingendyear, 10);
		if (pending) return pending;
		var end = parseInt(row.dataset.endyear, 10);
		if (!isNaN(end)) return end;
		return NaN;
	}

	function applyFilter(filter) {
		if (filter === currentSeason) {
			rows.forEach(function(row) { row.classList.remove('is-dimmed'); });
			return;
		}

		rows.forEach(function(row) {
			if (isRfaRow(row)) return;

			var effectiveEnd = getEffectiveEndYear(row);
			var isExpiring = row.dataset.expiring === 'true';
			var pendingEnd = parseInt(row.dataset.pendingendyear, 10);
			if (pendingEnd && pendingEnd === parseInt(currentSeason, 10)) {
				isExpiring = true;
			}

			var matches = false;
			if (filter === 'expiring') {
				matches = isExpiring;
			} else {
				var year = parseInt(filter, 10);
				matches = !isNaN(effectiveEnd) && effectiveEnd >= year;
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

	// Track current sort state
	var currentSort = 'name';
	var ascending = true;

	// Icon classes for each sort type and direction
	var icons = {
		name: { asc: 'fa-sort-alpha-asc', desc: 'fa-sort-alpha-desc' }
	};

	function updateButtonIcon(btn, sortKey, isAsc) {
		var icon = btn.querySelector('i');
		if (!icon || !icons[sortKey]) return;
		icon.className = 'fa ' + icons[sortKey][isAsc ? 'asc' : 'desc'];
	}

	function applySort(sortBy, asc) {
		var dir = asc ? 1 : -1;

		document.querySelectorAll('.player-table__body').forEach(function(tbody) {
			if (tbody.closest('.player-table__group--rfa')) return;
			var dataRows = Array.from(tbody.querySelectorAll('.player-table__row'));
			if (dataRows.length === 0) return;

			dataRows.sort(function(a, b) {
				var result = 0;
				if (sortBy === 'salary') {
					var salaryA = a.querySelector('.player-table__detail--salary');
					var salaryB = b.querySelector('.player-table__detail--salary');
					var valA = salaryA ? parseInt(salaryA.textContent.replace(/\D/g, ''), 10) || 0 : 0;
					var valB = salaryB ? parseInt(salaryB.textContent.replace(/\D/g, ''), 10) || 0 : 0;
					result = valA - valB;
				} else {
					var nameA = a.querySelector('.player-table__name').textContent.trim();
					var nameB = b.querySelector('.player-table__name').textContent.trim();
					result = nameA.localeCompare(nameB);
				}
				return result * dir;
			});

			dataRows.forEach(function(row) { tbody.appendChild(row); });
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

	// Contract picker click handling (buttons are rendered server-side)
	if (rosterId && rosterCard) {
		function reapplyActiveFilter() {
			var activeBtn = document.querySelector('.franchise-roster__filters button.btn-primary');
			if (activeBtn) applyFilter(activeBtn.dataset.filter);
		}

		function refreshBudget() {
			var budgetBody = document.getElementById('budgetBody');
			if (!budgetBody) return;

			fetch('/franchises/' + rosterId + '/budget')
				.then(function(res) { return res.text(); })
				.then(function(html) {
					budgetBody.innerHTML = html;
				});
		}

		rosterCard.addEventListener('click', function(e) {
			var btn = e.target.closest('.contract-picker__btn');
			if (!btn) return;

			var picker = btn.closest('.contract-picker');
			if (!picker) return;

			var isActive = btn.classList.contains('contract-picker__btn--active');
			var years = parseInt(btn.dataset.years, 10);
			var newYears = isActive ? 0 : years;
			var pId = picker.dataset.playerId;

			picker.querySelectorAll('.contract-picker__btn').forEach(function(b) {
				b.disabled = true;
			});

			fetch('/franchises/' + rosterId + '/set-contract', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ playerId: pId, years: newYears })
			})
			.then(function(res) { return res.json(); })
			.then(function(data) {
				if (data.error) {
					alert(data.error);
					return;
				}

				var allPickers = document.querySelectorAll('.contract-picker[data-player-id="' + pId + '"]');
				allPickers.forEach(function(p) {
					p.querySelectorAll('.contract-picker__btn').forEach(function(b) {
						b.classList.remove('contract-picker__btn--active');
					});
					if (data.pendingEndYear) {
						var match = p.querySelector('[data-years="' + newYears + '"]');
						if (match) match.classList.add('contract-picker__btn--active');
					}
					var r = p.closest('.player-table__row');
					if (r) r.dataset.pendingendyear = data.pendingEndYear || '';
				});

				reapplyActiveFilter();
				refreshBudget();
			})
			.catch(function() {
				alert('Something went wrong. Please try again.');
			})
			.finally(function() {
				picker.querySelectorAll('.contract-picker__btn').forEach(function(b) {
					b.disabled = false;
				});
			});
		});
	}
})();
