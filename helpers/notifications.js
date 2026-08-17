var superagent = require('superagent');

/**
 * Send a push notification to the commissioner via ntfy.
 * Used for alerting when trades are accepted and need approval.
 * 
 * @param {string} message - The message text to send
 * @param {Object} [options] - Optional settings
 * @param {string} [options.priority] - ntfy priority: min, low, default, high, urgent
 * @returns {Promise}
 */
async function alertCommissioner(message, options) {
	options = options || {};
	
	var topic = process.env.NTFY_COMMISH_TOPIC;
	if (!topic) {
		console.log('[NOTIFICATIONS] No NTFY_COMMISH_TOPIC configured, skipping alert:', message);
		return Promise.resolve();
	}
	
	var priority = options.priority || 'high';
	
	return superagent
		.post('https://ntfy.sh/' + topic)
		.set('Priority', priority)
		.send(message)
		.then(function(response) {
			console.log('[NOTIFICATIONS] Sent ntfy alert:', message.split('\n')[0] + '...');
		})
		.catch(function(error) {
			console.error('[NOTIFICATIONS] Failed to send ntfy alert:', error.message);
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
