/**
 * Navigation structure helper
 * Builds the bottom tab bar navigation as data, computing active states
 */

/**
 * Build the complete navigation structure for bottom tab bar
 * @param {Object} options
 * @param {string} options.activePage - Current page identifier
 * @param {number} options.currentRosterId - Roster ID of franchise being viewed (if any)
 * @param {Object} options.userFranchise - Logged-in user's franchise { rosterId, displayName }
 * @param {Array} options.franchises - All franchises [{ rosterId, displayName }]
 * @param {boolean} options.isAdmin - Whether user is admin
 * @param {number} options.pendingApprovalCount - Number of proposals awaiting admin approval
 * @returns {Object} Navigation structure with tabs array
 */
function buildNav(options) {
	var activePage = options.activePage || '';
	var currentRosterId = options.currentRosterId || null;
	var userFranchise = options.userFranchise || null;
	var franchises = options.franchises || [];
	var isAdmin = options.isAdmin || false;
	var pendingApprovalCount = options.pendingApprovalCount || 0;

	// Helper to check if a link is active
	function isActive(page) {
		return activePage === page;
	}

	// Determine which tab should be highlighted based on current page
	function getActiveTab() {
		if (activePage === 'franchise' || activePage === 'franchises' || activePage === 'timeline') {
			return 'franchises';
		}
		if (activePage === 'standings' || activePage === 'schedule' || activePage === 'jaguar' || activePage === 'h2h') {
			return 'season';
		}
		if (activePage === 'trade-machine' || activePage === 'trades' || activePage === 'proposal') {
			return 'transactions';
		}
		// Admin pages
		if (activePage.startsWith('admin')) {
			return 'admin';
		}
		// Everything else falls under "more" or no tab highlighted
		if (activePage === 'draft' || activePage === 'rookies' || activePage === 'rfa' || activePage === 'ufa' ||
			activePage === 'sunk' || activePage === 'calendar' || activePage === 'rules') {
			return 'more';
		}
		return null;
	}

	var activeTab = getActiveTab();

	// Build franchise list with user's franchise marked
	var franchiseItems = franchises.map(function(f) {
		return {
			rosterId: f.rosterId,
			displayName: f.displayName,
			href: '/franchises/' + f.rosterId,
			isUserFranchise: userFranchise && userFranchise.rosterId === f.rosterId
		};
	});

	// Build the 4 tabs
	var tabs = [
		{
			id: 'franchises',
			label: 'Franchises',
			icon: 'fa-shield',
			active: activeTab === 'franchises',
			items: franchiseItems,
			extraLinks: [
				{ label: 'Franchise Timeline', icon: 'fa-align-left', href: '/timeline' }
			]
		},
		{
			id: 'season',
			label: 'Season',
			icon: 'fa-trophy',
			active: activeTab === 'season',
			items: [
				{ label: 'Standings', icon: 'fa-list-ol', href: '/standings', active: isActive('standings') },
				{ label: 'Schedule', icon: 'fa-calendar', href: '/schedule', active: isActive('schedule') },
				{ label: 'Jaguar Chart', icon: 'fa-paw', href: '/jaguar', active: isActive('jaguar') },
				{ label: 'Head-to-Head', icon: 'fa-users', href: '#', soon: true }
			]
		},
		{
			id: 'transactions',
			label: 'Transactions',
			icon: 'fa-exchange',
			active: activeTab === 'transactions',
			items: [
				{ label: 'Trade Machine', icon: 'fa-exchange', href: '/trade-machine', active: isActive('trade-machine') },
				{ label: 'Trade History', icon: 'fa-history', href: '/trades', active: isActive('trades') },
				{ label: 'FAAB', icon: 'fa-gavel', href: '#', soon: true }
			]
		},
		{
			id: 'more',
			label: 'More',
			icon: 'fa-ellipsis-h',
			active: activeTab === 'more',
			hasNotification: isAdmin && pendingApprovalCount > 0,
			sections: [
				{
					label: 'Offseason',
					items: [
						{ label: 'Rookie Draft', icon: 'fa-list-ol', href: '/draft', active: isActive('draft') },
						{ label: 'Rookie Salaries', icon: 'fa-graduation-cap', href: '/rookies', active: isActive('rookies') },
						{ label: 'RFAs', icon: 'fa-user-plus', href: '/rfa', active: isActive('rfa') },
						{ label: 'UFAs', icon: 'fa-user-o', href: '/ufa', active: isActive('ufa') },
						{ label: 'Free Agent Auction', icon: 'fa-gavel', href: '#', soon: true }
					]
				},
				{
					label: 'Tools & Reference',
					items: [
						{ label: 'Sunk Cost Calculator', icon: 'fa-calculator', href: '/sunk', active: isActive('sunk') },
						{ label: 'Calendar', icon: 'fa-calendar-o', href: '/calendar', active: isActive('calendar') },
						{ label: 'Rules', icon: 'fa-book', href: '/rules', active: isActive('rules') },
						{ label: 'Blog', icon: 'fa-rss', href: 'https://thedynastyleague.wordpress.com/', external: true }
					]
				}
			]
		}
	];

	// Add admin tab if user is admin
	if (isAdmin) {
		tabs.push({
			id: 'admin',
			label: 'Admin',
			icon: 'fa-cog',
			active: activeTab === 'admin',
			hasNotification: pendingApprovalCount > 0,
			items: [
				{ label: 'Dashboard', icon: 'fa-tachometer', href: '/admin', active: isActive('admin') || isActive('admin-dashboard') },
				{ label: 'Players', icon: 'fa-user', href: '/admin/players', active: isActive('admin-players') },
				{ label: 'People', icon: 'fa-users', href: '/admin/people', active: isActive('admin-people') },
				{ label: 'Manage Trades', icon: 'fa-exchange', href: '/admin/trades', active: isActive('admin-trades') },
				{ label: 'Proposals', icon: 'fa-check-circle', href: '/admin/proposals', active: isActive('admin-proposals'), badge: pendingApprovalCount > 0 ? pendingApprovalCount : null }
			]
		});
	}

	return {
		tabs: tabs,
		activeTab: activeTab,
		userFranchise: userFranchise,
		pendingApprovalCount: pendingApprovalCount
	};
}

module.exports = {
	buildNav: buildNav
};
