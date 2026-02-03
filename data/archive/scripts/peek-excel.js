#!/usr/bin/env node
/**
 * Peek at Excel files to see what's in them
 */

var XLSX = require('xlsx');
var path = require('path');

var files = [
    'dynasty.xls',
    'teams.xls',
    'PSO Spreadsheet.xls'
];

files.forEach(function(file) {
    var filePath = path.join(__dirname, file);
    console.log('\n' + '='.repeat(60));
    console.log('FILE: ' + file);
    console.log('='.repeat(60));
    
    try {
        var workbook = XLSX.readFile(filePath);
        console.log('Sheets: ' + workbook.SheetNames.join(', '));
        
        workbook.SheetNames.forEach(function(sheetName) {
            console.log('\n--- Sheet: ' + sheetName + ' ---');
            var sheet = workbook.Sheets[sheetName];
            var range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
            console.log('Range: ' + (sheet['!ref'] || 'empty'));
            console.log('Rows: ' + (range.e.r - range.s.r + 1) + ', Cols: ' + (range.e.c - range.s.c + 1));
            
            // Get first 5 rows as JSON
            var data = XLSX.utils.sheet_to_json(sheet, { header: 1, range: 0 });
            console.log('First 5 rows:');
            data.slice(0, 5).forEach(function(row, i) {
                // Truncate long rows
                var display = row.slice(0, 10).map(function(cell) {
                    if (cell === undefined || cell === null) return '';
                    var s = String(cell);
                    return s.length > 20 ? s.substring(0, 17) + '...' : s;
                });
                console.log('  ' + i + ': ' + JSON.stringify(display));
            });
        });
    } catch (e) {
        console.log('Error: ' + e.message);
    }
});
