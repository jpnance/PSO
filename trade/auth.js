const dotenv = require('dotenv').config({ path: '../.env' });

const request = require('superagent');

const postData = {
	client_id: parseInt(process.env.WORDPRESS_CLIENT_ID),
	client_secret: process.env.WORDPRESS_CLIENT_SECRET,
	code: process.argv[2],
	grant_type: 'authorization_code',
	redirect_uri: 'http://localhost:9528/trade/'
};

request
	.post('https://public-api.wordpress.com/oauth2/token')
	.type('form')
	.send(postData)
	.then((response) => {
		console.log(response.body.access_token);
		process.exit();
	})
	.catch((error) => {
		console.error(error);
		process.exit();
	});
