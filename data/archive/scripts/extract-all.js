#!/usr/bin/env node
/**
 * Extract contract/auction data from all archive sources
 * Outputs unified CSV format: Source,Year,EspnId,Owner,Name,Position,Start,End,Salary
 */

var fs = require('fs');
var path = require('path');

var results = [];

// Helper to add a result
function add(source, year, espnId, owner, name, position, start, end, salary) {
    results.push({
        source: source,
        year: year,
        espnId: espnId || '',
        owner: owner || '',
        name: name || '',
        position: position || '',
        start: start || '',
        end: end || '',
        salary: salary || ''
    });
}

// Parse XML player entries (simple regex-based, not a full XML parser)
function parseXmlPlayers(content, source, defaultYear) {
    // Check if it's team-structured or flat
    var teamMatch = content.match(/<team>[\s\S]*?<name>([^<]+)<\/name>([\s\S]*?)<\/team>/g);
    
    if (teamMatch) {
        // Team-structured XML
        teamMatch.forEach(function(teamBlock) {
            var teamNameMatch = teamBlock.match(/<name>([^<]+)<\/name>/);
            var teamName = teamNameMatch ? teamNameMatch[1] : '';
            
            // Map team names to owner names
            var ownerMap = {
                'Melrose Place Schwingers': 'Patrick',
                'Trevor': 'Trevor',
                'Keyon': 'Keyon',
                'Koci': 'Koci',
                'Daniel': 'Daniel',
                'Jeff': 'Jeff',
                'James': 'James',
                'John': 'John',
                'Syed': 'Syed',
                'David': 'David',
                'Schexes': 'Schexes'
            };
            var owner = ownerMap[teamName] || teamName;
            
            var playerMatches = teamBlock.match(/<player>[\s\S]*?<\/player>/g) || [];
            playerMatches.forEach(function(p) {
                var id = (p.match(/<id>(\d+)<\/id>/) || [])[1];
                var name = (p.match(/<name>([^<]+)<\/name>/) || [])[1];
                var position = (p.match(/<position>([^<]+)<\/position>/) || [])[1] || '';
                var salary = (p.match(/<salary>(\d+)<\/salary>/) || [])[1];
                var start = (p.match(/<start>([^<]+)<\/start>/) || [])[1];
                var end = (p.match(/<end>([^<]+)<\/end>/) || [])[1];
                
                if (name) {
                    add(source, defaultYear, id, owner, name, position, start, end, salary);
                }
            });
        });
    } else {
        // Flat player list (in <drafted> section)
        var playerMatches = content.match(/<player>[\s\S]*?<\/player>/g) || [];
        playerMatches.forEach(function(p) {
            var id = (p.match(/<id>(\d+)<\/id>/) || [])[1];
            var name = (p.match(/<name>([^<]+)<\/name>/) || [])[1];
            var position = (p.match(/<position>([^<]+)<\/position>/) || [])[1] || '';
            var salary = (p.match(/<salary>(\d+)<\/salary>/) || [])[1];
            var start = (p.match(/<start>([^<]+)<\/start>/) || [])[1];
            var end = (p.match(/<end>([^<]+)<\/end>/) || [])[1];
            
            if (name) {
                add(source, defaultYear, id, '', name, position, start, end, salary);
            }
        });
    }
}

// Parse results.html (2008 auction)
function parseResultsHtml(content) {
    var rows = content.match(/<tr>[\s\S]*?<\/tr>/g) || [];
    rows.forEach(function(row) {
        var cells = row.match(/<td[^>]*>([^<]*)<\/td>/g);
        if (!cells || cells.length < 6) return;
        
        var extractText = function(td) {
            // Remove font tags and extract text
            return td.replace(/<[^>]+>/g, '').trim();
        };
        
        var no = extractText(cells[0]);
        var name = extractText(cells[1]);
        var position = extractText(cells[2]);
        var team = extractText(cells[3]);
        var owner = extractText(cells[4]);
        var price = extractText(cells[5]).replace('$', '');
        
        if (name && owner && price) {
            add('results.html', 2008, '', owner, name, position, 2008, 2008, price);
        }
    });
}

// Parse basic.txt (Google Sheets XML feed for 2009)
function parseBasicTxt(content) {
    // Format: <title type='text'>Owner</title><content type='text'>playername: X, position: Y, start: Z, salary: $N</content>
    var entries = content.match(/<entry>[\s\S]*?<\/entry>/g) || [];
    entries.forEach(function(entry) {
        var ownerMatch = entry.match(/<title[^>]*>([^<]+)<\/title>/);
        var contentMatch = entry.match(/<content[^>]*>([^<]+)<\/content>/);
        
        if (!ownerMatch || !contentMatch) return;
        
        var owner = ownerMatch[1];
        var contentText = contentMatch[1];
        
        var playerName = (contentText.match(/playername:\s*([^,]+)/) || [])[1];
        var position = (contentText.match(/position:\s*([^,]+)/) || [])[1];
        var start = (contentText.match(/start:\s*(\d+)/) || [])[1];
        var end = (contentText.match(/end:\s*(\d+)/) || [])[1];
        var salary = (contentText.match(/salary:\s*\$?(\d+)/) || [])[1];
        
        if (playerName) {
            add('basic.txt', 2009, '', owner.trim(), playerName.trim(), 
                position ? position.trim() : '', start || '', end || '', salary || '');
        }
    });
}

// Parse koci.txt (2012 data)
function parseKociTxt(content) {
    var lines = content.split('\n');
    var inContracts = false;
    var inAuction = false;
    
    lines.forEach(function(line) {
        line = line.trim();
        if (!line) return;
        
        if (line === '2012:') {
            inContracts = true;
            inAuction = false;
            return;
        }
        if (line.includes('auction nomination order')) {
            inContracts = false;
            inAuction = true;
            return;
        }
        if (line === 'Player Position Start End Salary') return;
        
        if (inContracts) {
            // Format: Name Position Start End Salary
            // e.g., "Yeremiah Bell DB 2010 2012 15"
            var match = line.match(/^(.+?)\s+(QB|RB|WR|TE|K|DL|LB|DB)\s+(\d+)\s+(\d+)\s+\$?(\d+)$/);
            if (match) {
                add('koci.txt-contracts', 2012, '', 'Koci', match[1], match[2], match[3], match[4], match[5]);
            }
        }
        
        if (inAuction) {
            // Format: Owner Position Player
            // e.g., "Patrick LB Navorro Bowman"
            var parts = line.split(/\s+/);
            if (parts.length >= 3) {
                var owner = parts[0];
                var position = parts[1];
                var playerName = parts.slice(2).join(' ');
                add('koci.txt-auction', 2012, '', owner, playerName, position, 2012, '', '');
            }
        }
    });
}

// Parse owner HTML files (2008 rosters)
function parseOwnerHtml(content, owner) {
    var rows = content.match(/<tr>[\s\S]*?<\/tr>/g) || [];
    rows.forEach(function(row) {
        var cells = row.match(/<td>([^<]*)<\/td>/g);
        if (!cells || cells.length < 5) return;
        
        var extractText = function(td) {
            return td.replace(/<[^>]+>/g, '').trim();
        };
        
        var slot = extractText(cells[0]);
        var name = extractText(cells[1]);
        var position = extractText(cells[2]);
        var team = extractText(cells[3]);
        var price = extractText(cells[4]).replace('$', '');
        
        if (name && price) {
            add(owner + '.html', 2008, '', owner, name, position, 2008, 2008, price);
        }
    });
}

// Parse teams.xls (2008 contracts by owner)
function parseTeamsXls() {
    var XLSX = require('xlsx');
    var filePath = path.join(__dirname, 'teams.xls');
    if (!fs.existsSync(filePath)) return;
    
    console.log('Parsing teams.xls...');
    var workbook = XLSX.readFile(filePath);
    
    // Skip 'Pool' sheet, process owner sheets
    workbook.SheetNames.forEach(function(sheetName) {
        if (sheetName === 'Pool') return;
        
        var sheet = workbook.Sheets[sheetName];
        var data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        
        // Map sheet names to owner names
        // Note: The "Luke" sheet in teams.xls is actually Jeff's franchise in 2008
        // (Jake/Luke didn't take over until 2009)
        var ownerMap = {
            'Patrick': 'Patrick',
            'Syed': 'Syed', 
            'Daniel': 'Daniel',
            'John': 'John',
            'Koci': 'Koci',
            'Luke': 'Jeff',  // Jeff owned this franchise in 2008
            'James': 'James',
            'Trevor': 'Trevor',
            'Keyon': 'Keyon',
            'Schexes': 'Schexes'
        };
        var owner = ownerMap[sheetName] || sheetName;
        
        // Skip header row
        for (var i = 1; i < data.length; i++) {
            var row = data[i];
            if (!row || !row[0]) continue;
            
            var name = row[0];
            var position = row[1] || '';
            var start = row[2];
            var end = row[3];
            var base = row[4];
            
            // Skip rows with no meaningful data
            if (!name || name === '--' || !base) continue;
            
            add('teams.xls', 2008, '', owner, name, position, start, end, base);
        }
    });
}

// Parse dynasty.xls 
function parseDynastyXls() {
    var XLSX = require('xlsx');
    var filePath = path.join(__dirname, 'dynasty.xls');
    if (!fs.existsSync(filePath)) return;
    
    console.log('Parsing dynasty.xls...');
    var workbook = XLSX.readFile(filePath);
    var sheet = workbook.Sheets['Sheet1'];
    var data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    
    data.forEach(function(row) {
        if (!row || !row[1]) return;
        var start = row[0]; // FA or year
        var name = row[1];
        var col2 = row[2]; // salary or something
        var col3 = row[3]; 
        var salary = row[5] || col2;
        
        add('dynasty.xls', 2008, '', '', name, '', start, '', salary);
    });
}

// Main
console.log('Extracting data from archive files...\n');

var archiveDir = __dirname;
var xmlDir = path.join(archiveDir, 'xml');

// XML files
var xmlFiles = [
    { file: 'dynastyData.xml', year: 2009 },
    { file: 'xml/dynastyData.xml', year: 2008 },
    { file: 'xml/oldDynastyData.xml', year: 2008 },
    { file: 'xml/newDynastyData.xml', year: 2008 },
    { file: 'xml/backupDynastyData.xml', year: 2008 }
];

xmlFiles.forEach(function(info) {
    var filePath = path.join(archiveDir, info.file);
    if (fs.existsSync(filePath)) {
        console.log('Parsing ' + info.file + '...');
        var content = fs.readFileSync(filePath, 'utf8');
        parseXmlPlayers(content, info.file, info.year);
    }
});

// results.html
var resultsPath = path.join(archiveDir, 'results.html');
if (fs.existsSync(resultsPath)) {
    console.log('Parsing results.html...');
    parseResultsHtml(fs.readFileSync(resultsPath, 'utf8'));
}

// basic.txt
var basicPath = path.join(archiveDir, 'basic.txt');
if (fs.existsSync(basicPath)) {
    console.log('Parsing basic.txt...');
    parseBasicTxt(fs.readFileSync(basicPath, 'utf8'));
}

// koci.txt
var kociPath = path.join(archiveDir, 'koci.txt');
if (fs.existsSync(kociPath)) {
    console.log('Parsing koci.txt...');
    parseKociTxt(fs.readFileSync(kociPath, 'utf8'));
}

// Owner HTML files
var owners = ['daniel', 'james', 'jeff', 'john', 'keyon', 'koci', 'patrick', 'schex', 'syed', 'trevor'];
owners.forEach(function(owner) {
    var filePath = path.join(archiveDir, owner + '.html');
    if (fs.existsSync(filePath)) {
        console.log('Parsing ' + owner + '.html...');
        var ownerName = owner.charAt(0).toUpperCase() + owner.slice(1);
        parseOwnerHtml(fs.readFileSync(filePath, 'utf8'), ownerName);
    }
});

// Excel files
parseTeamsXls();
parseDynastyXls();

// Output CSV
console.log('\n=== RESULTS ===\n');
console.log('Total records extracted: ' + results.length);

// Group by source
var bySource = {};
results.forEach(function(r) {
    bySource[r.source] = (bySource[r.source] || 0) + 1;
});
console.log('\nBy source:');
Object.keys(bySource).sort().forEach(function(s) {
    console.log('  ' + s + ': ' + bySource[s]);
});

// Write to CSV
var csvPath = path.join(archiveDir, 'extracted-all.csv');
var csvLines = ['Source,Year,EspnId,Owner,Name,Position,Start,End,Salary'];
results.forEach(function(r) {
    var escapeCsv = function(val) {
        val = String(val);
        if (val.includes(',') || val.includes('"')) {
            return '"' + val.replace(/"/g, '""') + '"';
        }
        return val;
    };
    csvLines.push([
        escapeCsv(r.source),
        escapeCsv(r.year),
        escapeCsv(r.espnId),
        escapeCsv(r.owner),
        escapeCsv(r.name),
        escapeCsv(r.position),
        escapeCsv(r.start),
        escapeCsv(r.end),
        escapeCsv(r.salary)
    ].join(','));
});

fs.writeFileSync(csvPath, csvLines.join('\n'));
console.log('\nWritten to: ' + csvPath);
