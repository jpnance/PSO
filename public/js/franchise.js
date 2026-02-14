(function() {
	var filterButtons = document.querySelectorAll('.franchise-roster-cards__filters button');
	var cards = document.querySelectorAll('.player-chip-wrapper');
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
				rosterCardBody.classList.add('manage-mode');
				if (manageLabel) manageLabel.textContent = 'Done';
			} else {
				rosterCardBody.classList.remove('manage-mode');
				if (manageLabel) manageLabel.textContent = 'Manage';
			}
		});
	}
	
	// Mark for cut toggle buttons
	var rosterId = window.location.pathname.match(/\/franchises\/(\d+)/);
	rosterId = rosterId ? rosterId[1] : null;
	
	if (rosterId) {
		document.querySelectorAll('.player-chip__cut-toggle').forEach(function(btn) {
			btn.addEventListener('click', function(e) {
				e.preventDefault();
				e.stopPropagation();
				
				var wrapper = this.closest('.player-chip-wrapper');
				var playerId = wrapper.dataset.playerId;
				
				fetch('/franchises/' + rosterId + '/mark-for-cut', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/x-www-form-urlencoded'
					},
					body: 'playerId=' + encodeURIComponent(playerId)
				})
				.then(function(response) {
					if (!response.ok) throw new Error('Request failed');
					return response.text();
				})
				.then(function(html) {
					// Parse the new marked state from the response
					var temp = document.createElement('div');
					temp.innerHTML = html;
					var newWrapper = temp.querySelector('.player-chip-wrapper');
					
					if (newWrapper) {
						var isNowMarked = newWrapper.dataset.markedForCut === 'true';
						
						// Update the current wrapper's state
						wrapper.dataset.markedForCut = isNowMarked ? 'true' : 'false';
						
						// Toggle the visual classes
						if (isNowMarked) {
							wrapper.classList.add('player-chip-wrapper--marked-for-cut');
							btn.classList.add('player-chip__cut-toggle--active');
							btn.title = 'Unmark for cut';
						} else {
							wrapper.classList.remove('player-chip-wrapper--marked-for-cut');
							btn.classList.remove('player-chip__cut-toggle--active');
							btn.title = 'Mark for cut';
						}
						
						// Update or add/remove the recoverable pill
						var detailEl = wrapper.querySelector('.player-chip__detail');
						var existingPill = detailEl ? detailEl.querySelector('.player-chip__recoverable') : null;
						var newPill = newWrapper.querySelector('.player-chip__recoverable');
						
						if (isNowMarked && newPill && detailEl) {
							if (existingPill) {
								existingPill.outerHTML = newPill.outerHTML;
							} else {
								detailEl.appendChild(newPill.cloneNode(true));
							}
						} else if (!isNowMarked && existingPill) {
							existingPill.remove();
						}
					}
				})
				.catch(function(err) {
					console.error('Mark for cut error:', err);
					alert('Failed to update cut status');
				});
			});
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
