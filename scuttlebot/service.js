var dotenv = require('dotenv').config({ path: '/app/.env' });

var superagent = require('superagent');

module.exports.prompt = function(request, response) {
	const prompts = [
		'What are you hearing?',
		'What\'s the word on the street?',
		'Which way is the wind blowing?',
		'What\'s the latest?',
		'What are your sources saying?',
		'Who sux?',
		'Who\'s on the block?',
		'Which cornerstone is on the move?',
		'Who\'s unhappy in their current situation?',
		'What\'s the commissioner considering?',
		'Who tradin\'?',
		'Who\'s buying?',
		'Who\'s selling?',
		'Who\'s going for it?',
		'How ya feelin\'?',
	];

	const characterLimit = 138;

	response.render('scuttlebot', {
		prompt: selectRandomElement(prompts),
		characterLimit
	});
};

module.exports.postMessage = function(request, response) {
	const token = JSON.parse(process.env.SCUTTLEBOT).groupmeToken;
	const message = request.body.message;

	superagent
		.post('https://api.groupme.com/v3/bots/post')
		.send({ bot_id: token, text: message })
		.then(function(apiResponse) {
			response.redirect('/scuttlebot');
		});
};

function selectRandomElement(array) {
	const index = Math.floor(Math.random() * array.length);

	return array[index];
}
