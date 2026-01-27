/**
 * Navigation structure helper
 * Builds the sidebar navigation as data, computing active/expanded states
 */

/**
 * Build the complete navigation structure
 * @param {Object} options
 * @param {string} options.activePage - Current page identifier
 * @param {number} options.currentRosterId - Roster ID of franchise being viewed (if any)
 * @param {Object} options.userFranchise - Logged-in user's franchise { rosterId, displayName }
 * @param {Array} options.franchises - All franchises [{ rosterId, displayName }]
 * @param {boolean} options.isAdmin - Whether user is admin
 * @param {number} options.pendingApprovalCount - Number of proposals awaiting admin approval
 * @returns {Object} Navigation structure
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

	// Helper to check if we're in an admin section
	function isAdminPage() {
		return activePage && activePage.startsWith('admin');
	}

	// Helper to check if current franchise matches
	function isFranchiseActive(rosterId) {
		return currentRosterId && currentRosterId === rosterId;
	}

	// Build primary navigation (always visible)
	var primary = [
		{
			id: 'league',
			label: 'League Overview',
			icon: 'fa-home',
			href: '/league',
			active: isActive('league')
		},
		{
			id: 'schedule',
			label: 'Schedule',
			icon: 'fa-calendar',
			href: '#',
			soon: true
		},
		{
			id: 'faab',
			label: 'FAAB',
			icon: 'fa-gavel',
			href: '#',
			soon: true
		},
		{
			id: 'standings',
			label: 'Standings',
			icon: 'fa-trophy',
			href: '#',
			soon: true
		},
		{
			id: 'trade-machine',
			label: 'Trade Machine',
			icon: 'fa-exchange',
			href: '/trade-machine',
			active: isActive('trade-machine')
		}
	];

	// Add "My Franchise" if user has one
	if (userFranchise) {
		primary.splice(1, 0, {
			id: 'my-franchise',
			label: 'My Franchise',
			icon: 'fa-star',
			href: '/franchises/' + userFranchise.rosterId,
			active: isFranchiseActive(userFranchise.rosterId)
		});
	}

	// Build sections (collapsible)
	var sections = [];

	// All Franchises
	sections.push({
		id: 'franchises',
		label: 'All Franchises',
		icon: 'fa-shield',
		expanded: activePage === 'franchise' || activePage === 'franchises',
		items: franchises.map(function(f) {
			return {
				label: f.displayName,
				href: '/franchises/' + f.rosterId,
				active: isFranchiseActive(f.rosterId)
			};
		}),
		isFranchiseList: true
	});

	// History & Results
	sections.push({
		id: 'history',
		label: 'History & Results',
		icon: 'fa-history',
		expanded: isActive('trades') || isActive('timeline'),
		items: [
			{ label: 'History', icon: 'fa-calendar-check-o', href: '#', soon: true },
			{ label: 'Trade History', icon: 'fa-exchange', href: '/trades', active: isActive('trades') },
			{ label: 'Franchise Timeline', icon: 'fa-align-left', href: '/timeline', active: isActive('timeline') },
			{ label: 'Head-to-Head', icon: 'fa-users', href: '#', soon: true },
			{ label: 'Jaguar Chart', icon: 'fa-paw', href: '/jaguar', active: isActive('jaguar') }
		]
	});

	// Draft & Auction
	sections.push({
		id: 'draft',
		label: 'Draft & Auction',
		icon: 'fa-list-ol',
		expanded: isActive('rookies') || isActive('draft'),
		items: [
			{ label: 'Rookie Salaries', icon: 'fa-graduation-cap', href: '/rookies', active: isActive('rookies') },
			{ label: 'Rookie Draft', icon: 'fa-list-ol', href: '/draft', active: isActive('draft') },
			{ label: 'Free Agent Auction', icon: 'fa-money', href: '#', soon: true }
		]
	});

	// Tools
	sections.push({
		id: 'tools',
		label: 'Tools',
		icon: 'fa-wrench',
		expanded: isActive('simulator') || isActive('sunk'),
		items: [
			{ label: 'Simulator', icon: 'fa-random', href: '#', soon: true },
			{ label: 'Sunk Cost Calculator', icon: 'fa-calculator', href: '/sunk', active: isActive('sunk') }
		]
	});

	// Resources
	sections.push({
		id: 'resources',
		label: 'Resources',
		icon: 'fa-bookmark',
		expanded: isActive('calendar') || isActive('rules'),
		items: [
			{ label: 'Calendar', icon: 'fa-calendar-o', href: '/calendar', active: isActive('calendar') },
			{ label: 'Rules', icon: 'fa-book', href: '/rules', active: isActive('rules') },
			{ label: 'Blog', icon: 'fa-rss', href: 'https://thedynastyleague.wordpress.com/', external: true }
		]
	});

	// Admin (only for admins)
	if (isAdmin) {
		sections.push({
			id: 'admin',
			label: 'Admin',
			icon: 'fa-cog',
			expanded: isAdminPage(),
			isAdmin: true,
			hasNotification: pendingApprovalCount > 0,
			items: [
				{ label: 'Dashboard', icon: 'fa-tachometer', href: '/admin', active: isActive('admin') || isActive('admin-dashboard') },
				{ label: 'Players', icon: 'fa-user', href: '/admin/players', active: isActive('admin-players') },
				{ label: 'Manage Trades', icon: 'fa-exchange', href: '/admin/trades', active: isActive('admin-trades') },
				{ label: 'Proposals', icon: 'fa-check-circle', href: '/admin/proposals', active: isActive('admin-proposals'), badge: pendingApprovalCount > 0 ? pendingApprovalCount : null }
			]
		});
	}

	return {
		primary: primary,
		sections: sections
	};
}

module.exports = {
	buildNav: buildNav
};
