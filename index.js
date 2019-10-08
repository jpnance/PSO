var dotenv = require('dotenv').config();

var express = require('express');
var app = express();

app.use(express.static('public'));

app.set('view engine', 'pug');
require('./routes')(app);

var mongoose = require('mongoose');
mongoose.Promise = global.Promise;
mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });

process.env.PORT = process.env.PORT || 3333;
app.listen(process.env.PORT, function() { console.log('yes okay ' + process.env.PORT); });
