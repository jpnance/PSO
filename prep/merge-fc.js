const fs = require('fs');

function parseCsv(filename) {
	var lines = fs.readFileSync(filename, 'utf-8').split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.trim());
	var headers = parseCsvLine(lines[0]);
	var rows = [];

	for (var i = 1; i < lines.length; i++) {
		var fields = parseCsvLine(lines[i]);
		var row = {};
		headers.forEach((h, j) => { row[h] = fields[j] || ''; });
		rows.push(row);
	}

	return { headers: headers, rows: rows };
}

function parseCsvLine(line) {
	var fields = [];
	var current = '';
	var inQuotes = false;

	for (var i = 0; i < line.length; i++) {
		if (inQuotes) {
			if (line[i] === '"' && line[i + 1] === '"') {
				current += '"';
				i++;
			}
			else if (line[i] === '"') {
				inQuotes = false;
			}
			else {
				current += line[i];
			}
		}
		else {
			if (line[i] === '"') {
				inQuotes = true;
			}
			else if (line[i] === ',') {
				fields.push(current);
				current = '';
			}
			else {
				current += line[i];
			}
		}
	}

	fields.push(current);
	return fields;
}

function escapeCsv(value) {
	if (value == null) return '';
	var str = String(value);
	if (str.includes(',') || str.includes('"') || str.includes('\n')) {
		return '"' + str.replace(/"/g, '""') + '"';
	}
	return str;
}

var primary = parseCsv('sleeper-fc.csv');
var secondary = parseCsv('eastenders.csv');

var secondaryById = {};
secondary.rows.forEach((row) => { secondaryById[row['Player ID']] = row; });

var comparisons = [
	{ primary: '2025 GP', secondary: '2025 GP' },
	{ primary: '2025 Pts', secondary: '2025 Pts (EE)' },
	{ primary: '2026 GP', secondary: '2026 GP' },
	{ primary: '2026 Pts', secondary: '2026 Pts (EE)' },
	{ primary: 'ADP', secondary: 'ADP' },
];

var diffs = [];

primary.rows.forEach((row) => {
	var match = secondaryById[row['Player ID']];
	if (!match) return;

	comparisons.forEach((comp) => {
		var a = parseFloat(row[comp.primary]) || 0;
		var b = parseFloat(match[comp.secondary]) || 0;
		if (Math.abs(a - b) > 0.1) {
			diffs.push({
				id: row['Player ID'],
				name: row['Name'],
				field: comp.primary,
				fresh: a,
				old: b,
			});
		}
	});
});

if (diffs.length > 0) {
	console.error('=== Discrepancies (fresh vs old) ===');
	diffs.forEach((d) => {
		console.error(d.name + ' | ' + d.field + ': ' + d.fresh + ' vs ' + d.old);
	});
	console.error('=== ' + diffs.length + ' total ===\n');
}
else {
	console.error('No discrepancies found.\n');
}

var mergeFields = ['Max', 'Round', 'Notes'];
var infoHeaders = ['Player ID', 'Name', 'Age', 'Pos', 'Team', 'Injury'];
var outHeaders = infoHeaders.concat(mergeFields).concat(primary.headers.slice(infoHeaders.length));

console.log(outHeaders.join(','));

primary.rows.forEach((row) => {
	var match = secondaryById[row['Player ID']];

	var fields = infoHeaders.map((h) => {
		return h === 'Name' ? escapeCsv(row[h]) : row[h];
	});

	mergeFields.forEach((f) => {
		fields.push(escapeCsv(match ? match[f] : ''));
	});

	primary.headers.slice(infoHeaders.length).forEach((h) => {
		fields.push(row[h]);
	});

	console.log(fields.join(','));
});
