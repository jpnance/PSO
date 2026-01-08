var superagent = require('superagent');

module.exports.loginPage = function(request, response) {
	var data = {};

	if (request.query.error === 'invalid-email') {
		data.error = { message: 'Invalid email address.' };
	} else if (request.query.error === 'not-found') {
		data.error = { message: 'No user found for that email address.' };
	} else if (request.query.error === 'no-token') {
		data.error = { message: 'Login link was missing a token. Please try again.' };
	} else if (request.query.error === 'no-user') {
		data.error = { message: 'Session is valid but no matching user found. Contact the commissioner.' };
	} else if (request.query.error === 'retrieve-failed') {
		data.error = { message: 'Could not validate your session. Please try again.' };
	} else if (request.query.error === 'unknown') {
		data.error = { message: 'Unknown server error.' };
	} else if (request.query.success === 'email-sent') {
		data.success = { message: 'Check your email for your login link!' };
	}

	response.render('login', data);
};

module.exports.authCallback = async function(request, response) {
	var token = request.query.token;

	if (!token) {
		return response.redirect('/login?error=no-token');
	}

	try {
		// Validate the token with the auth service
		var result = await superagent
			.post(process.env.LOGIN_SERVICE_PUBLIC + '/sessions/retrieve')
			.send({ key: token });

		if (!result.body || !result.body.user) {
			return response.redirect('/login?error=no-user');
		}

		// Set our own session cookie
		response.cookie('sessionKey', token, {
			expires: new Date('2038-01-01'),
			secure: true,
			httpOnly: true
		});

		response.redirect('/');
	} catch (error) {
		response.redirect('/login?error=retrieve-failed');
	}
};

module.exports.logout = async function(request, response) {
	var sessionKey = request.cookies.sessionKey;

	if (sessionKey) {
		try {
			// Delete just this session
			await superagent
				.get(process.env.LOGIN_SERVICE_PUBLIC + '/sessions/delete/' + sessionKey);
		} catch (error) {
			// Session might already be invalid, that's fine
		}
	}

	response.clearCookie('sessionKey');
	response.redirect('/');
};

module.exports.logoutAll = async function(request, response) {
	var sessionKey = request.cookies.sessionKey;

	if (sessionKey) {
		try {
			// Delete all sessions for this user
			await superagent
				.get(process.env.LOGIN_SERVICE_PUBLIC + '/sessions/deleteAll/' + sessionKey);
		} catch (error) {
			// Session might already be invalid, that's fine
		}
	}

	response.clearCookie('sessionKey');
	response.redirect('/');
};
