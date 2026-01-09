var dotenv = require('dotenv').config({ path: '/app/.env' });

let request = require('superagent');

let botConfig = JSON.parse(process.env.SCUTTLEBOT);

let interval = 60000;

let last = {
	psoBlogPost: {
		link: null
	}
};

let groupMePost = function(post) {
	request
		.post('https://api.groupme.com/v3/bots/post')
		.send({ bot_id: botConfig['groupmeToken'], text: post })
		.then(response => {
			console.log(post);
		})
		.catch(error => {
			console.log(error);
		});
};

let psoBlogPoll = function() {
	request
		.get('https://thedynastyleague.wordpress.com/feed/')
		.then(response => {
			let feedString = response.body.toString();

			feedString = feedString.replace(/\r\n/g, '');
			feedString = feedString.replace(/\n/g, '');

			let entryRegexp = /<item>(.*?)<\/item>/;
			let entryMatch = entryRegexp.exec(feedString);

			let linkRegexp = /<link>(.*?)<\/link>/;
			let linkMatch = linkRegexp.exec(entryMatch[1]);

			let link = linkMatch[1];

			if (!last.psoBlogPost.link) {
				last.psoBlogPost.link = link;
			}

			if (link != last.psoBlogPost.link) {
				groupMePost(link);

				last.psoBlogPost.link = link;
			}
		});
};

setInterval(psoBlogPoll, interval);
