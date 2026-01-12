var auction = require('./auction/service.js');
var simulator = require('./simulator/service.js');
var scuttlebot = require('./scuttlebot/service.js');
var league = require('./league/service.js');
var admin = require('./admin/service.js');
var adminPlayers = require('./admin/players.js');
var adminTrades = require('./admin/trades.js');
var draft = require('./draft/service.js');
var trades = require('./trades/service.js');
var propose = require('./propose/service.js');
var calendar = require('./calendar/service.js');
var rookies = require('./rookies/service.js');
var auth = require('./auth/service.js');
var { requireLogin, requireAdmin } = require('./auth/middleware.js');

module.exports = function(app) {
	app.get('/', league.overview);

	// Auth routes
	app.get('/login', auth.loginPage);
	app.get('/auth/callback', auth.authCallback);
	app.get('/logout', auth.logout);
	app.get('/logout/all', auth.logoutAll);

	app.get('/league', league.overview);
	app.get('/franchise/:id', league.franchise);
	
	app.get('/trades', trades.tradeHistory);
	app.get('/trades/:id', trades.singleTrade);
	
	app.get('/propose', propose.proposePage);
	app.post('/propose/budget-impact', propose.budgetImpactPartial);
	
	// Trade proposals (owners)
	app.post('/propose', requireLogin, propose.createProposal);
	app.get('/propose/:id', propose.viewProposal);
	app.post('/propose/:id/formalize', requireLogin, propose.formalizeProposal);
	app.post('/propose/:id/accept', requireLogin, propose.acceptProposal);
	app.post('/propose/:id/reject', requireLogin, propose.rejectProposal);
	app.post('/propose/:id/withdraw', requireLogin, propose.withdrawProposal);
	app.post('/propose/:id/counter', requireLogin, propose.counterProposal);

	app.get('/draft', draft.draftBoard);
	
	app.get('/calendar', calendar.calendar);
	
	app.get('/rookies', rookies.rookieSalaries);

	app.get('/components', (req, res) => res.render('components', { pageTitle: 'Component Library — PSO' }));

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
	app.get('/admin/process-trade', requireLogin, requireAdmin, propose.processPage);
	app.post('/admin/process-trade', requireLogin, requireAdmin, propose.submitTrade);
	
	// Trade proposal approval (require login + admin)
	app.get('/admin/proposals', requireLogin, requireAdmin, propose.listProposalsForApproval);
	app.post('/admin/proposals/:id/approve', requireLogin, requireAdmin, propose.approveProposal);
	app.post('/admin/proposals/:id/reject', requireLogin, requireAdmin, propose.adminRejectProposal);
};
