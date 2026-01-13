// Player search typeahead for navbar
(function() {
	var searchInput = document.getElementById('searchInput');
	var mobileSearchInput = document.getElementById('mobileSearchInput');
	var searchContainer = document.getElementById('searchContainer');
	
	// Create dropdown container
	var dropdown = document.createElement('div');
	dropdown.className = 'search-dropdown';
	dropdown.id = 'searchDropdown';
	
	if (searchContainer) {
		searchContainer.appendChild(dropdown);
	}
	
	// Create mobile dropdown
	var mobileDropdown = document.createElement('div');
	mobileDropdown.className = 'search-dropdown';
	mobileDropdown.id = 'mobileSearchDropdown';
	
	var mobileWrapper = document.querySelector('.mobile-search-wrapper');
	if (mobileWrapper) {
		mobileWrapper.appendChild(mobileDropdown);
	}
	
	var debounceTimer = null;
	var currentFocusIndex = -1;
	
	function debounce(fn, delay) {
		return function() {
			var args = arguments;
			clearTimeout(debounceTimer);
			debounceTimer = setTimeout(function() {
				fn.apply(null, args);
			}, delay);
		};
	}
	
	function showDropdown(dropdownEl) {
		dropdownEl.classList.add('show');
	}
	
	function hideDropdown(dropdownEl) {
		dropdownEl.classList.remove('show');
		currentFocusIndex = -1;
	}
	
	function hideAllDropdowns() {
		hideDropdown(dropdown);
		hideDropdown(mobileDropdown);
	}
	
	function getResults(dropdownEl) {
		return dropdownEl.querySelectorAll('.search-result');
	}
	
	function updateFocus(dropdownEl) {
		var results = getResults(dropdownEl);
		results.forEach(function(el, i) {
			if (i === currentFocusIndex) {
				el.classList.add('focused');
			} else {
				el.classList.remove('focused');
			}
		});
		
		// Scroll focused item into view
		if (currentFocusIndex >= 0 && results[currentFocusIndex]) {
			results[currentFocusIndex].scrollIntoView({ block: 'nearest' });
		}
	}
	
	function performSearch(query, dropdownEl) {
		if (query.length < 2) {
			hideDropdown(dropdownEl);
			return;
		}
		
		fetch('/league/search?q=' + encodeURIComponent(query))
			.then(function(response) {
				return response.text();
			})
			.then(function(html) {
				dropdownEl.innerHTML = html;
				currentFocusIndex = -1;
				
				if (html.trim()) {
					showDropdown(dropdownEl);
				} else {
					hideDropdown(dropdownEl);
				}
			})
			.catch(function(err) {
				console.error('Search error:', err);
				hideDropdown(dropdownEl);
			});
	}
	
	var debouncedSearch = debounce(performSearch, 250);
	
	function handleInput(inputEl, dropdownEl) {
		var query = inputEl.value.trim();
		debouncedSearch(query, dropdownEl);
	}
	
	function handleKeydown(e, inputEl, dropdownEl) {
		var results = getResults(dropdownEl);
		
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			if (currentFocusIndex < results.length - 1) {
				currentFocusIndex++;
				updateFocus(dropdownEl);
			}
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			if (currentFocusIndex > 0) {
				currentFocusIndex--;
				updateFocus(dropdownEl);
			}
		} else if (e.key === 'Enter') {
			if (currentFocusIndex >= 0 && results[currentFocusIndex]) {
				e.preventDefault();
				results[currentFocusIndex].click();
			}
		} else if (e.key === 'Escape') {
			hideDropdown(dropdownEl);
			inputEl.blur();
		}
	}
	
	// Desktop search
	if (searchInput) {
		searchInput.addEventListener('input', function() {
			handleInput(searchInput, dropdown);
		});
		
		searchInput.addEventListener('keydown', function(e) {
			handleKeydown(e, searchInput, dropdown);
		});
		
		searchInput.addEventListener('focus', function() {
			if (searchInput.value.trim().length >= 2) {
				performSearch(searchInput.value.trim(), dropdown);
			}
		});
	}
	
	// Mobile search
	if (mobileSearchInput) {
		mobileSearchInput.addEventListener('input', function() {
			handleInput(mobileSearchInput, mobileDropdown);
		});
		
		mobileSearchInput.addEventListener('keydown', function(e) {
			handleKeydown(e, mobileSearchInput, mobileDropdown);
		});
		
		mobileSearchInput.addEventListener('focus', function() {
			if (mobileSearchInput.value.trim().length >= 2) {
				performSearch(mobileSearchInput.value.trim(), mobileDropdown);
			}
		});
	}
	
	// Close dropdowns when clicking outside
	document.addEventListener('click', function(e) {
		if (!e.target.closest('.topbar-search') && !e.target.closest('.mobile-search-wrapper')) {
			hideAllDropdowns();
		}
	});
	
	// Handle clicks on dropdown results (delegate since they're dynamically added)
	dropdown.addEventListener('click', function(e) {
		var result = e.target.closest('.search-result');
		if (result && result.href) {
			// Clear search and close dropdown
			if (searchInput) searchInput.value = '';
			hideDropdown(dropdown);
		}
	});
	
	mobileDropdown.addEventListener('click', function(e) {
		var result = e.target.closest('.search-result');
		if (result && result.href) {
			if (mobileSearchInput) mobileSearchInput.value = '';
			hideDropdown(mobileDropdown);
		}
	});
})();
