module.exports = function(app) {
	app.get('/', function(request, response) {
		response.redirect('https://thedynastyleague.wordpress.com/');
	});
};
