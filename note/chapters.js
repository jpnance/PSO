const fs = require('fs')

const formatTimestamp = function(timestamp) {
	var hours = 0;
	var minutes = 0;
	var seconds = 0;

	if (timestamp > 3600) {
		hours = parseInt(timestamp / 3600);

		timestamp -= hours * 3600;
	}

	if (timestamp > 60) {
		minutes = parseInt(timestamp / 60);

		timestamp -= minutes * 60;
	}

	seconds = timestamp % 60;

	var formattedTimestamp = '';

	if (hours > 0) {
		formattedTimestamp += hours + ':';
	}

	if (hours > 0 && minutes < 10) {
		formattedTimestamp += '0';
	}

	formattedTimestamp += minutes + ':';

	if (seconds < 10) {
		formattedTimestamp += '0';
	}

	formattedTimestamp += seconds;

	return formattedTimestamp;
};

fs.readFile('./tracks.txt', 'utf8' , (error, data) => {
	if (error) {
		console.error(error)
		return
	}

	var chapterStrings = data.split("\n");

	chapterStrings.forEach(chapterString => {
		var chapterData = chapterString.split("\t");
		var timestamp = parseInt(chapterData[0]);
		var chapterName = chapterData[2];

		if (timestamp != NaN && chapterName) {
			console.log(formatTimestamp(timestamp), chapterName + '<br />');
		}
	});
});

