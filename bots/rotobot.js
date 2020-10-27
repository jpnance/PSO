let request = require('superagent');
let lastMessage = {
	id: null
};

let groupMePost = function(post) {
	request
		.post('https://api.groupme.com/v3/bots/post')
		.send({ bot_id: process.env.GROUPME_BOT_TOKEN, text: post }) // prod
		.then(response => {
			console.log('done');
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
		.query({ 'filter[league.meta.drupal_internal__id]': 21 })
		.then(response => {
			let newsItemId = JSON.parse(response.text).data[0].attributes.drupal_internal__id;

			if (newsItemId != lastMessage.id) {
				groupMePost('https://www.rotoworld.com/football/nfl/player-news/' + newsItemId);

				lastMessage.id = newsItemId;
			}
		});
};

setInterval(rotoPoll, 6000);
