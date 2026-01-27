// Progressive enhancement for trade history filters
// Intercepts filter/pagination clicks, fetches via AJAX, swaps DOM content
(function() {
	var tradeList = document.getElementById('trade-list');
	var filterSidebar = document.getElementById('filter-sidebar');
	var pagination = document.getElementById('pagination');
	
	// Only enhance the list view (not single trade view)
	if (!tradeList || !filterSidebar) return;
	
	var isLoading = false;
	
	function setLoading(loading) {
		isLoading = loading;
		filterSidebar.classList.toggle('trade-filter--loading', loading);
		tradeList.classList.toggle('trade-list--loading', loading);
	}
	
	function loadFiltered(url, updateHistory) {
		if (isLoading) return;
		setLoading(true);
		
		fetch(url)
			.then(function(response) {
				if (!response.ok) throw new Error('Network response was not ok');
				return response.text();
			})
		.then(function(html) {
			var parser = new DOMParser();
			var doc = parser.parseFromString(html, 'text/html');
			
			// Preserve mobile filter collapse state before replacing
			var pillsFilter = document.getElementById('pills-filters');
			var wasOpen = pillsFilter && pillsFilter.classList.contains('show');
			
			// Extract and swap content
			var newTradeList = doc.getElementById('trade-list');
			var newFilterSidebar = doc.getElementById('filter-sidebar');
			var newPagination = doc.getElementById('pagination');
			
			if (newTradeList) {
				tradeList.innerHTML = newTradeList.innerHTML;
			}
			
			if (newFilterSidebar) {
				filterSidebar.innerHTML = newFilterSidebar.innerHTML;
			}
			
			if (newPagination && pagination) {
				pagination.innerHTML = newPagination.innerHTML;
			}
			
			// Restore mobile filter collapse state
			if (wasOpen) {
				var newPillsFilter = document.getElementById('pills-filters');
				if (newPillsFilter) {
					newPillsFilter.classList.add('show');
				}
			}
			
			// Update browser history
			if (updateHistory) {
				history.pushState({ tradeHistory: true }, '', url);
			}
			
			setLoading(false);
		})
			.catch(function(error) {
				console.error('Trade history fetch error:', error);
				setLoading(false);
				// Fall back to normal navigation
				window.location = url;
			});
	}
	
	// Check if a link should be handled by AJAX
	function isFilterLink(link) {
		if (!link || !link.href) return false;
		
		// Must be a /trades link (not a single trade like /trades/123)
		var url = new URL(link.href, window.location.origin);
		if (!url.pathname.match(/^\/trades\/?$/)) return false;
		
		// Only filter sidebar links - pagination uses normal navigation
		return !!link.closest('#filter-sidebar');
	}
	
	// Event delegation for filter clicks (pagination uses normal navigation)
	document.addEventListener('click', function(e) {
		var link = e.target.closest('a');
		
		if (isFilterLink(link)) {
			e.preventDefault();
			loadFiltered(link.href, true);
		}
	});
	
	// Handle browser back/forward
	window.addEventListener('popstate', function(e) {
		// Only handle if we're on a /trades page
		if (window.location.pathname.match(/^\/trades\/?$/)) {
			loadFiltered(window.location.href, false);
		}
	});
	
	// Mark initial state for popstate handling
	if (!history.state || !history.state.tradeHistory) {
		history.replaceState({ tradeHistory: true }, '', window.location.href);
	}
})();
