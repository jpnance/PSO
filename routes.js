var auction = require('./auction/service.js');
var jaguar = require('./jaguar/service.js');
var simulator = require('./simulator/service.js');
var scuttlebot = require('./scuttlebot/service.js');
var league = require('./league/service.js');
var admin = require('./admin/service.js');
var adminPlayers = require('./admin/players.js');
var adminTrades = require('./admin/trades.js');
var draft = require('./draft/service.js');
var trades = require('./trades/service.js');
var proposals = require('./proposals/service.js');
var calendar = require('./calendar/service.js');
var rookies = require('./rookies/service.js');
var auth = require('./auth/service.js');
var { requireLogin, requireAdmin } = require('./auth/middleware.js');

// Middleware to prevent caching of dynamic partials
function noCache(req, res, next) {
	res.set('Cache-Control', 'no-store');
	next();
}

module.exports = function(app) {
	app.get('/', league.overview);

	// Auth routes
	app.get('/login', auth.loginPage);
	app.get('/auth/callback', auth.authCallback);
	app.get('/logout', auth.logout);
	app.get('/logout/all', auth.logoutAll);

	app.get('/league', league.overview);
	app.get('/league/search', noCache, league.search);
	app.get('/franchise/:rosterId', league.franchise);
	
	app.get('/trades', trades.tradeHistory);
	app.get('/trades/:id', trades.singleTrade);
	
	app.get('/timeline', league.timeline);
	
	// Trade Machine
	app.get('/trade-machine', proposals.tradeMachinePage);
	app.post('/trade-machine', requireLogin, proposals.createProposal);
	app.post('/trade-machine/budget-impact', noCache, proposals.budgetImpactPartial);
	
	// Proposals (trade negotiations)
	app.get('/proposals/:slug', proposals.viewProposal);
	app.post('/proposals/:slug/propose', requireLogin, proposals.proposeProposal);
	app.post('/proposals/:slug/accept', requireLogin, proposals.acceptProposal);
	app.post('/proposals/:slug/reject', requireLogin, proposals.rejectProposal);
	app.post('/proposals/:slug/cancel', requireLogin, proposals.cancelProposal);

	app.get('/draft', draft.draftBoard);
	
	app.get('/calendar', calendar.calendar);
	
	app.get('/rookies', rookies.rookieSalaries);

	app.get('/components', (req, res) => res.render('components'));
	
	app.get('/sunk', (req, res) => res.render('sunk', { activePage: 'sunk' }));

	app.get('/jaguar', jaguar.jaguarPage);

	app.get('/auction/login/:key', auction.authenticateOwner);
	app.get('/auction/resetorder', auction.resetNominationOrder);

	app.post('/simulator', simulator.filterByConditions);
	app.post('/simulator/:conditions', simulator.filterByConditions);
	app.get('/simulator/clear', simulator.clearCache);

	app.get('/scuttlebutt', (request, response) => {
		response.redirect('/scuttlebot');
	});
	app.get('/scuttlebot', scuttlebot.prompt);
	app.post('/scuttlebot/message', scuttlebot.postMessage);
	
	// Admin routes (require login + admin)
	app.get('/admin', requireLogin, requireAdmin, admin.configPage);
	app.post('/admin/config', requireLogin, requireAdmin, admin.updateConfig);
	app.get('/admin/advance-season', requireLogin, requireAdmin, admin.advanceSeasonForm);
	app.post('/admin/advance-season', requireLogin, requireAdmin, admin.advanceSeason);
	app.get('/admin/transfer-franchise', requireLogin, requireAdmin, admin.transferFranchiseForm);
	app.post('/admin/transfer-franchise', requireLogin, requireAdmin, admin.transferFranchise);
	app.get('/admin/rosters', requireLogin, requireAdmin, admin.rostersPage);
	app.post('/admin/rosters/cut', requireLogin, requireAdmin, admin.cutPlayer);
	
	// Player management (require login + admin)
	app.get('/admin/players', requireLogin, requireAdmin, adminPlayers.listPlayers);
	app.get('/admin/players/new', requireLogin, requireAdmin, adminPlayers.newPlayerForm);
	app.post('/admin/players/new', requireLogin, requireAdmin, adminPlayers.createPlayer);
	app.get('/admin/players/:id', requireLogin, requireAdmin, adminPlayers.editPlayerForm);
	app.post('/admin/players/:id', requireLogin, requireAdmin, adminPlayers.editPlayer);
	app.post('/admin/players/:id/merge', requireLogin, requireAdmin, adminPlayers.mergePlayer);
	
	// Trade management (require login + admin)
	app.get('/admin/trades', requireLogin, requireAdmin, adminTrades.listTrades);
	app.get('/admin/trades/:id', requireLogin, requireAdmin, adminTrades.editTradeForm);
	app.post('/admin/trades/:id', requireLogin, requireAdmin, adminTrades.editTrade);
	
	// Process new trades (require login + admin)
	app.get('/admin/process-trade', requireLogin, requireAdmin, proposals.processPage);
	app.post('/admin/process-trade', requireLogin, requireAdmin, proposals.submitTrade);
	
	// Proposal approval (require login + admin)
	app.get('/admin/proposals', requireLogin, requireAdmin, proposals.listProposalsForApproval);
	app.post('/admin/proposals/:id/approve', requireLogin, requireAdmin, proposals.approveProposal);
	app.post('/admin/proposals/:id/reject', requireLogin, requireAdmin, proposals.adminRejectProposal);
	
};
