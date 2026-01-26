var superagent = require('superagent');
var Person = require('../models/Person');

/**
 * Attaches session and user to request if logged in.
 * Always calls next() - doesn't block unauthenticated users.
 * Use on all routes via app.use().
 */
async function attachSession(req, res, next) {
	req.session = null;
	req.user = null;

	var sessionKey = req.cookies.sessionKey;
	if (!sessionKey) {
		return next();
	}

	try {
		var request = superagent
			.post(process.env.LOGIN_SERVICE_PUBLIC + '/sessions/retrieve')
			.send({ key: sessionKey });

		// In development, allow self-signed certificates for local login service
		if (process.env.NODE_ENV === 'dev') {
			//request.disableTLSCerts();
		}

		var response = await request;

		if (response.body?.user) {
			var localUser = await Person.findOne({ username: response.body.user.username });

			req.session = response.body;
			req.user = localUser;
		}
	} catch (err) {
		// Log but don't crash - treat as unauthenticated
		console.error('Auth service error:', err.message);
	}

	next();
}

/**
 * Requires a logged-in user. Redirects to /login if not.
 * Use on specific routes: app.get('/picks', requireLogin, handler)
 */
function requireLogin(req, res, next) {
	if (!req.user) {
		return res.redirect('/login');
	}
	next();
}

/**
 * Requires an admin user. Returns 403 if not.
 * Admin status comes from the auth service's User object, not the local Person.
 * Use after requireLogin: app.get('/admin', requireLogin, requireAdmin, handler)
 */
function requireAdmin(req, res, next) {
	if (!req.session || !req.session.user || !req.session.user.admin) {
		return res.status(403).send('Forbidden');
	}
	next();
}

module.exports = {
	attachSession: attachSession,
	requireLogin: requireLogin,
	requireAdmin: requireAdmin
};
