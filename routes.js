var auction = require('./services/auction');
var jaguar = require('./services/jaguar');
var simulator = require('./services/simulator');
var scuttlebot = require('./services/scuttlebot');
var league = require('./services/league');
var standings = require('./services/standings');
var schedule = require('./services/schedule');
var admin = require('./services/admin');
var adminPlayers = require('./services/admin-players');
var adminTrades = require('./services/admin-trades');
var adminCuts = require('./services/admin-cuts');
var sleeperImport = require('./services/sleeper-import');
var draft = require('./services/draft');
var trades = require('./services/trades');
var proposals = require('./services/proposals');
var calendar = require('./services/calendar');
var rookies = require('./services/rookies');
var freeAgents = require('./services/free-agents');
var players = require('./services/players');
var auth = require('./services/auth');
var { requireLogin, requireAdmin } = require('./middleware/auth');

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
	
	// Franchises
	app.get('/franchises', league.franchisesList);
	app.get('/franchises/:id', league.franchiseDetail);
	app.get('/franchises/:id/schedule', league.franchiseSchedule);
	app.get('/franchises/:id/schedule/:season', league.franchiseSchedule);
	app.post('/franchises/:id/cut', requireLogin, league.cutPlayer);
	
	app.get('/trades', trades.tradeHistory);
	app.get('/trades/:id', trades.singleTrade);
	
	app.get('/standings', standings.standingsPage);
	app.get('/standings/:season', standings.standingsPage);
	
	app.get('/schedule', schedule.schedulePage);
	app.get('/schedule/:season', schedule.schedulePage);
	app.get('/schedule/:season/:week', schedule.schedulePage);
	
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
	app.get('/draft/:season', draft.draftBoard);
	
	app.get('/calendar', calendar.calendar);
	
	app.get('/rookies', rookies.rookieSalaries);
	app.get('/rookies/:season', rookies.rookieSalaries);
	
	app.get('/rfa', freeAgents.rfa);
	
	app.get('/players/:id', players.playerDetail);

	app.get('/components', (req, res) => res.render('components'));
	
	app.get('/sunk', (req, res) => res.render('sunk', { activePage: 'sunk' }));
	app.get('/rules', (req, res) => res.render('rules', { activePage: 'rules' }));

	app.get('/jaguar', jaguar.jaguarPage);
	app.get('/jaguar/:season', jaguar.jaguarPage);

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
	app.get('/admin/sanity', requireLogin, requireAdmin, admin.sanityPage);
	
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
	
	// Cut timestamp management (require login + admin)
	app.get('/admin/cuts', requireLogin, requireAdmin, adminCuts.listCuts);
	app.get('/admin/cuts/:id', requireLogin, requireAdmin, adminCuts.editCutForm);
	app.post('/admin/cuts/:id', requireLogin, requireAdmin, adminCuts.editCut);
	app.post('/admin/cuts/:id/auto-fix', requireLogin, requireAdmin, adminCuts.autoFixCut);
	
	// Sleeper transaction import (require login + admin)
	app.get('/admin/sleeper-import', requireLogin, requireAdmin, sleeperImport.importForm);
	app.post('/admin/sleeper-import', requireLogin, requireAdmin, sleeperImport.parseTransactions);
	
	// Process new trades (require login + admin)
	app.get('/admin/process-trade', requireLogin, requireAdmin, proposals.processPage);
	app.post('/admin/process-trade', requireLogin, requireAdmin, proposals.submitTrade);
	
	// Proposal approval (require login + admin)
	app.get('/admin/proposals', requireLogin, requireAdmin, proposals.listProposalsForApproval);
	app.post('/admin/proposals/:id/approve', requireLogin, requireAdmin, proposals.approveProposal);
	app.post('/admin/proposals/:id/reject', requireLogin, requireAdmin, proposals.adminRejectProposal);
	
};
