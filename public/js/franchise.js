(function() {
	var filterButtons = document.querySelectorAll('.franchise-roster-cards__filters button');
	var cards = document.querySelectorAll('.franchise-roster-cards__card');
	
	if (filterButtons.length === 0) return;
	
	function applyFilter(filter) {
		cards.forEach(function(card) {
			var startYear = parseInt(card.dataset.startYear, 10);
			var endYear = parseInt(card.dataset.endYear, 10);
			var isExpiring = card.dataset.expiring === 'true';
			
			var matches = false;
			
			if (filter === 'expiring') {
				matches = isExpiring;
			} else {
				var year = parseInt(filter, 10);
				matches = startYear <= year && endYear >= year;
			}
			
			if (matches) {
				card.classList.remove('is-dimmed');
			} else {
				card.classList.add('is-dimmed');
			}
		});
	}
	
	filterButtons.forEach(function(btn) {
		btn.addEventListener('click', function() {
			var filter = this.dataset.filter;
			
			// Update button states
			filterButtons.forEach(function(b) {
				b.classList.remove('btn-primary');
				b.classList.add('btn-outline-secondary');
			});
			this.classList.remove('btn-outline-secondary');
			this.classList.add('btn-primary');
			
			applyFilter(filter);
		});
	});
})();
