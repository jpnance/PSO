let dotenv = require('dotenv').config({ path: __dirname + '/../.env' });

let request = require('superagent');
let Twitter = require('twitter');

let client = new Twitter({
	consumer_key: process.env.TWITTER_CONSUMER_KEY,
	consumer_secret: process.env.TWITTER_CONSUMER_SECRET,
	access_token_key: process.env.TWITTER_ACCESS_TOKEN,
	access_token_secret: process.env.TWITTER_ACCESS_TOKEN_SECRET
});

let interval = 60000;

let last = {
	groupMeMessage: {
		id: null
	},
	tweet: {
		id: null
	}
};

let groupMePost = function(post) {
	request
		.post('https://api.groupme.com/v3/bots/post')
		.send({ bot_id: process.env.GROUPME_BOT_TOKEN, text: post })
		.then(response => {
			console.log(post);
		})
		.catch(error => {
			console.log(error);
		});
};

let rotoPoll = function() {
	request
		.get('https://www.rotoworld.com/api/player_news')
		.query({ sort: '-created' })
		.query({ 'page[limit]': 1 })
		.query({ 'page[offset]': 0 })
		.query({ 'filter[player-group][group][conjunction]': 'OR' })
		.query({ 'filter[primary-player-filter][condition][path]': 'player.meta.drupal_internal__id' })
		.query({ 'filter[primary-player-filter][condition][value]': 251226 })
		.query({ 'filter[primary-player-filter][condition][operator]': '=' })
		.query({ 'filter[primary-player-filter][condition][memberOf]': 'player-group' })
		.query({ 'filter[related-player-filter][condition][path]': 'related_players.meta.drupal_internal__id' })
		.query({ 'filter[related-player-filter][condition][value]': 251226 })
		.query({ 'filter[related-player-filter][condition][operator]': 'IN' })
		.query({ 'filter[related-player-filter][condition][memberOf]': 'player-group' })
		.then(response => {
			let newsItemId = JSON.parse(response.text).data[0].attributes.drupal_internal__id;

			if (!last.groupMeMessage.id) {
				last.groupMeMessage.id = newsItemId;
				return;
			}

			if (newsItemId != last.groupMeMessage.id) {
				groupMePost('https://www.rotoworld.com/football/nfl/player-news/' + newsItemId);

				last.groupMeMessage.id = newsItemId;
			}
		});
};

let twitterPoll = function() {
	let params = {
		//user_id: '1055099514355437600'
		screen_name: 'PsoScuttlebutt'
	};

	if (last.tweet.id) {
		params.since_id = last.tweet.id;
	}

	client.get('statuses/user_timeline', params, function(error, tweets, response) {
		if (!last.tweet.id) {
			let mostRecentTweet = tweets[0];

			last.tweet.id = mostRecentTweet.id_str;
			return;
		}
		else {
			tweets.reverse();
		}

		if (tweets.length > 0) {
			groupMePost('https://twitter.com/' + tweets[0].user.screen_name + '/status/' + tweets[0].id_str);
			last.tweet.id = tweets[0].id_str;
		}
	});
};

setInterval(twitterPoll, interval);
setInterval(rotoPoll, interval);
