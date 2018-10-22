var Game = require('./models/Game');

var mongoose = require('mongoose');
mongoose.promise = global.Promise;
mongoose.connect('mongodb://localhost:27017/pso_dev');

Game.findOne().then(game => {
	console.log(game);
	process.exit();
});
