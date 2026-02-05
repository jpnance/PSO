var superagent = require('superagent');

/**
 * Post a message to the commish-only GroupMe channel.
 * Used for alerting the commissioner when trades are accepted.
 * 
 * @param {string} message - The message text to post
 * @param {Object} [options] - Optional settings
 * @param {string} [options.pictureUrl] - URL of an image to attach
 * @returns {Promise}
 */
async function alertCommissioner(message, options) {
	options = options || {};
	
	var token = process.env.GROUPME_COMMISH_BOT;
	if (!token) {
		console.log('[NOTIFICATIONS] No GROUPME_COMMISH_BOT token configured, skipping alert:', message);
		return Promise.resolve();
	}
	
	var payload = {
		bot_id: token,
		text: message
	};
	
	if (options.pictureUrl) {
		payload.picture_url = options.pictureUrl;
	}
	
	return superagent
		.post('https://api.groupme.com/v3/bots/post')
		.send(payload)
		.then(function(response) {
			console.log('[NOTIFICATIONS] Posted to commish channel:', message);
		})
		.catch(function(error) {
			console.error('[NOTIFICATIONS] Failed to post to commish channel:', error.message);
		});
}

/**
 * Post a message to the main league GroupMe channel.
 * In dev, redirects to commish channel instead.
 * 
 * @param {string} message - The message text to post
 * @param {Object} [options] - Optional settings
 * @param {string} [options.pictureUrl] - URL of an image to attach
 * @returns {Promise}
 */
async function postToLeague(message, options) {
	options = options || {};
	
	// In dev, post to commish channel instead
	if (process.env.NODE_ENV !== 'production') {
		console.log('[NOTIFICATIONS] Dev mode - redirecting league post to commish channel');
		return alertCommissioner('[LEAGUE] ' + message, options);
	}
	
	var token = process.env.GROUPME_LEAGUE_BOT;
	if (!token) {
		console.log('[NOTIFICATIONS] No GROUPME_LEAGUE_BOT token configured, skipping post:', message);
		return Promise.resolve();
	}
	
	var payload = {
		bot_id: token,
		text: message
	};
	
	if (options.pictureUrl) {
		payload.picture_url = options.pictureUrl;
	}
	
	return superagent
		.post('https://api.groupme.com/v3/bots/post')
		.send(payload)
		.then(function(response) {
			console.log('[NOTIFICATIONS] Posted to league channel:', message);
		})
		.catch(function(error) {
			console.error('[NOTIFICATIONS] Failed to post to league channel:', error.message);
		});
}

module.exports = {
	alertCommissioner: alertCommissioner,
	postToLeague: postToLeague
};
