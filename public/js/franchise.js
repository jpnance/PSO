(function() {
	var filterButtons = document.querySelectorAll('.franchise-roster-cards__filters button');
	var cards = document.querySelectorAll('.franchise-roster-cards__card');
	var cardBody = document.querySelector('#rosterCard .card-body');
	var manageToggle = document.getElementById('manageToggle');
	
	if (filterButtons.length === 0) return;
	
	// Get current season from the default active button
	var currentSeasonBtn = document.querySelector('.franchise-roster-cards__filters button.btn-primary');
	var currentSeason = currentSeasonBtn ? currentSeasonBtn.dataset.filter : null;
	
	function applyFilter(filter) {
		// Current season shows everyone
		if (filter === currentSeason) {
			cards.forEach(function(card) {
				card.classList.remove('is-dimmed');
			});
			return;
		}
		
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
	
	// Manage mode toggle
	var rosterCardBody = document.getElementById('rosterCardBody');
	if (manageToggle && rosterCardBody) {
		var isManageMode = false;
		var manageLabel = manageToggle.querySelector('.manage-label');
		
		manageToggle.addEventListener('click', function() {
			isManageMode = !isManageMode;
			
			if (isManageMode) {
				rosterCardBody.classList.add('franchise-roster-cards--manage');
				if (manageLabel) manageLabel.textContent = 'Done';
				manageToggle.classList.remove('btn-outline-secondary');
				manageToggle.classList.add('btn-primary');
			} else {
				rosterCardBody.classList.remove('franchise-roster-cards--manage');
				if (manageLabel) manageLabel.textContent = 'Manage';
				manageToggle.classList.remove('btn-primary');
				manageToggle.classList.add('btn-outline-secondary');
			}
		});
	}
	
	// Cut player modal - just populates the form, form handles the POST
	var cutModal = document.getElementById('cutModal');
	
	if (cutModal) {
		var cutPlayerIdInput = document.getElementById('cutPlayerId');
		var cutPlayerNameInput = document.getElementById('cutPlayerNameInput');
		var cutPlayerNameEl = document.getElementById('cutPlayerName');
		
		function formatMoney(amount) {
			if (amount === null || amount === '' || isNaN(amount)) return '—';
			return '$' + parseInt(amount, 10);
		}
		
		function formatRecoverable(amount) {
			if (amount === null || amount === '' || isNaN(amount)) return '—';
			return '+' + formatMoney(amount);
		}
		
		document.querySelectorAll('.franchise-roster-cards__action').forEach(function(btn) {
			btn.addEventListener('click', function(e) {
				e.stopPropagation();
				
				var salary = this.dataset.salary;
				
				cutPlayerIdInput.value = this.dataset.playerId;
				cutPlayerNameInput.value = this.dataset.playerName;
				cutPlayerNameEl.textContent = this.dataset.playerName;
				
				// Year 0 (current)
				document.getElementById('cutSalary0').textContent = formatMoney(salary);
				document.getElementById('cutBuyout0').textContent = formatMoney(this.dataset.buyout0);
				document.getElementById('cutRecoverable0').textContent = formatRecoverable(this.dataset.recoverable0);
				
				// Year 1
				var r1 = this.dataset.recoverable1;
				document.getElementById('cutSalary1').textContent = r1 ? formatMoney(salary) : '—';
				document.getElementById('cutBuyout1').textContent = r1 ? formatMoney(this.dataset.buyout1) : '—';
				document.getElementById('cutRecoverable1').textContent = r1 ? formatRecoverable(r1) : '—';
				
				// Year 2
				var r2 = this.dataset.recoverable2;
				document.getElementById('cutSalary2').textContent = r2 ? formatMoney(salary) : '—';
				document.getElementById('cutBuyout2').textContent = r2 ? formatMoney(this.dataset.buyout2) : '—';
				document.getElementById('cutRecoverable2').textContent = r2 ? formatRecoverable(r2) : '—';
				
				$(cutModal).modal('show');
			});
		});
	}
})();
