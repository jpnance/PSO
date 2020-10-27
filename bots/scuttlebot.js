let dotenv = require('dotenv').config({ path: __dirname + '/../.env' });

let request = require('superagent');
let Twitter = require('twitter');

let client = new Twitter({
	consumer_key: process.env.TWITTER_CONSUMER_KEY,
	consumer_secret: process.env.TWITTER_CONSUMER_SECRET,
	access_token_key: process.env.TWITTER_ACCESS_TOKEN,
	access_token_secret: process.env.TWITTER_ACCESS_TOKEN_SECRET
});

let lastTweet = {
	id: null
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

let twitterPoll = function() {
	let params = {
		//user_id: '1055099514355437600'
		screen_name: 'PsoScuttlebutt'
	};

	if (lastTweet.id) {
		params.since_id = lastTweet.id;
	}

	client.get('statuses/user_timeline', params, function(error, tweets, response) {
		if (!lastTweet.id) {
			tweets = [ tweets.shift() ];
		}
		else {
			tweets.reverse();
			tweets.shift();
		}

		if (tweets.length > 0) {
			groupMePost('https://twitter.com/' + tweets[0].user.screen_name + '/status/' + tweets[0].id_str);
			lastTweet.id = tweets[0].id;
		}
	});
};

setInterval(twitterPoll, 60000);
