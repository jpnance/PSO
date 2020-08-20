var dotenv = require('dotenv').config({ path: '../.env' });

var mongoose = require('mongoose');
mongoose.Promise = global.Promise;
mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });

var Game = require('../models/Game');

process.argv.forEach(function(value, index, array) {
	if (index > 1) {
		var pair = value.split(/=/);

		switch (pair[0]) {
			case 'render':
				render = true;
				break;
		}
	}
});

if (render) {
	var fs = require('fs');
	var pug = require('pug');
	var compiledPug = pug.compileFile('../views/auction.pug');
	fs.writeFileSync('../public/auction/index.html', compiledPug());

	var compiledPugAdmin = pug.compileFile('../views/auction-admin.pug');
	fs.writeFileSync('../public/auction/admin.html', compiledPugAdmin());
}

process.exit();
