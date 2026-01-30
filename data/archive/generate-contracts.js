#!/usr/bin/env node
/**
 * Generate clean contracts-YEAR.txt files from authoritative sources
 * 
 * Trust hierarchy:
 * - 2008: xml/newDynastyData.xml (ESPN IDs + Position) + xml/dynastyData.xml (Owner from team structure)
 * - 2009: dynastyData.xml (ESPN IDs + Position + Contract) + basic.txt (Owner)
 */

var fs = require('fs');
var path = require('path');

var archiveDir = __dirname;

// Helper to normalize names for matching
function normalizeName(name) {
    return name.toLowerCase()
        .replace(/[.']/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

// Parse flat XML player list
function parseFlatXml(content) {
    var players = [];
    var matches = content.match(/<player>[\s\S]*?<\/player>/g) || [];
    matches.forEach(function(p) {
        var id = (p.match(/<id>(\d+)<\/id>/) || [])[1];
        var name = (p.match(/<name>([^<]+)<\/name>/) || [])[1];
        var position = (p.match(/<position>([^<]+)<\/position>/) || [])[1] || '';
        var salary = (p.match(/<salary>(\d+)<\/salary>/) || [])[1];
        var start = (p.match(/<start>([^<]+)<\/start>/) || [])[1];
        var end = (p.match(/<end>([^<]+)<\/end>/) || [])[1];
        
        if (name) {
            players.push({
                espnId: id || '',
                name: name,
                position: position,
                start: start || '',
                end: end || '',
                salary: salary || ''
            });
        }
    });
    return players;
}

// Parse team-structured XML to get owner mapping by ESPN ID
function parseTeamXml(content) {
    var ownerByEspnId = {}; // espnId -> owner
    var ownerByName = {}; // normalized name -> owner (fallback)
    
    var teamMatches = content.match(/<team>[\s\S]*?<\/team>/g) || [];
    teamMatches.forEach(function(teamBlock) {
        var teamIdMatch = teamBlock.match(/<id>(\d+)<\/id>/);
        
        // Map team/franchise IDs to 2008 owner names (from pso.js franchiseNames)
        var teamIdToOwner = {
            '1': 'Patrick',
            '2': 'Koci',
            '3': 'Syed',
            '4': 'John',
            '5': 'Trevor',
            '6': 'Keyon',
            '7': 'Jeff',
            '8': 'Daniel',
            '9': 'James',
            '10': 'Schexes'
        };
        
        var teamId = teamIdMatch ? teamIdMatch[1] : '';
        var owner = teamIdToOwner[teamId] || '';
        
        var playerMatches = teamBlock.match(/<player>[\s\S]*?<\/player>/g) || [];
        playerMatches.forEach(function(p) {
            var espnId = (p.match(/<id>(\d+)<\/id>/) || [])[1];
            var name = (p.match(/<name>([^<]+)<\/name>/) || [])[1];
            if (owner) {
                if (espnId) {
                    ownerByEspnId[espnId] = owner;
                }
                if (name) {
                    ownerByName[normalizeName(name)] = owner;
                }
            }
        });
    });
    
    return { byEspnId: ownerByEspnId, byName: ownerByName };
}

// Name aliases (canonical name -> alternate names)
var nameAliases = {
    'beanie wells': ['chris wells']
};

// Parse basic.txt for 2009 owner mapping
function parseBasicTxt(content) {
    var ownerMap = {};
    var entries = content.match(/<entry>[\s\S]*?<\/entry>/g) || [];
    entries.forEach(function(entry) {
        var ownerMatch = entry.match(/<title[^>]*>([^<]+)<\/title>/);
        var contentMatch = entry.match(/<content[^>]*>([^<]+)<\/content>/);
        
        if (!ownerMatch || !contentMatch) return;
        
        var owner = ownerMatch[1].trim();
        var contentText = contentMatch[1];
        var playerName = (contentText.match(/playername:\s*([^,]+)/) || [])[1];
        
        if (playerName && owner) {
            var norm = normalizeName(playerName.trim());
            ownerMap[norm] = owner;
            
            // Check if this is an alias and also map the canonical name
            Object.keys(nameAliases).forEach(function(canonical) {
                if (nameAliases[canonical].indexOf(norm) !== -1) {
                    ownerMap[canonical] = owner;
                }
            });
        }
    });
    return ownerMap;
}

// Generate CSV output
function generateCsv(players, year) {
    var lines = ['ID,Owner,Name,Position,Start,End,Salary'];
    
    players.forEach(function(p) {
        var escapeCsv = function(val) {
            val = String(val || '');
            if (val.includes(',') || val.includes('"')) {
                return '"' + val.replace(/"/g, '""') + '"';
            }
            return val;
        };
        
        var salary = p.salary ? '$' + p.salary : '';
        
        lines.push([
            escapeCsv(p.espnId),
            escapeCsv(p.owner || ''),
            escapeCsv(p.name),
            escapeCsv(p.position),
            escapeCsv(p.start),
            escapeCsv(p.end),
            escapeCsv(salary)
        ].join(','));
    });
    
    return lines.join('\n');
}

// === GENERATE 2008 ===
console.log('Generating 2008 contracts...');

var xml2008Flat = fs.readFileSync(path.join(archiveDir, 'xml/newDynastyData.xml'), 'utf8');
var xml2008Team = fs.readFileSync(path.join(archiveDir, 'xml/dynastyData.xml'), 'utf8');

var players2008 = parseFlatXml(xml2008Flat);
var owners2008 = parseTeamXml(xml2008Team);

// Hardcoded owners for players in free agency pool at snapshot time
// (verified from 2008 auction chat logs)
var hardcodedOwners2008 = {
    '9824': 'Patrick',   // T.J. Rushing - "1 to pat, going once... sold"
    '1245': 'Daniel'     // Jason Taylor - "15 to daniel, going once... sold"
};

// Merge owner info - prefer ESPN ID match, fall back to name match, then hardcoded
players2008.forEach(function(p) {
    if (p.espnId && owners2008.byEspnId[p.espnId]) {
        p.owner = owners2008.byEspnId[p.espnId];
    } else if (p.espnId && hardcodedOwners2008[p.espnId]) {
        p.owner = hardcodedOwners2008[p.espnId];
    } else {
        var norm = normalizeName(p.name);
        if (owners2008.byName[norm]) {
            p.owner = owners2008.byName[norm];
        }
    }
});

var withOwner2008 = players2008.filter(function(p) { return p.owner; }).length;
console.log('  Total players: ' + players2008.length);
console.log('  With owner: ' + withOwner2008);

var csv2008 = generateCsv(players2008, 2008);
fs.writeFileSync(path.join(archiveDir, 'contracts-2008-new.txt'), csv2008);
console.log('  Written to: contracts-2008-new.txt');

// === GENERATE 2009 ===
console.log('\nGenerating 2009 contracts...');

var xml2009 = fs.readFileSync(path.join(archiveDir, 'dynastyData.xml'), 'utf8');
var basic2009 = fs.readFileSync(path.join(archiveDir, 'basic.txt'), 'utf8');

var players2009 = parseFlatXml(xml2009);
var owners2009 = parseBasicTxt(basic2009);

// Merge owner info
players2009.forEach(function(p) {
    var norm = normalizeName(p.name);
    if (owners2009[norm]) {
        p.owner = owners2009[norm];
    }
});

var withOwner2009 = players2009.filter(function(p) { return p.owner; }).length;
console.log('  Total players: ' + players2009.length);
console.log('  With owner: ' + withOwner2009);

var csv2009 = generateCsv(players2009, 2009);
fs.writeFileSync(path.join(archiveDir, 'contracts-2009-new.txt'), csv2009);
console.log('  Written to: contracts-2009-new.txt');

// Summary of players without owners
console.log('\n=== Players without owners (2008) ===');
players2008.filter(function(p) { return !p.owner; }).slice(0, 10).forEach(function(p) {
    console.log('  ' + p.name + ' (' + p.position + ')');
});
if (players2008.filter(function(p) { return !p.owner; }).length > 10) {
    console.log('  ... and ' + (players2008.filter(function(p) { return !p.owner; }).length - 10) + ' more');
}

console.log('\n=== Players without owners (2009) ===');
players2009.filter(function(p) { return !p.owner; }).slice(0, 10).forEach(function(p) {
    console.log('  ' + p.name + ' (' + p.position + ')');
});
if (players2009.filter(function(p) { return !p.owner; }).length > 10) {
    console.log('  ... and ' + (players2009.filter(function(p) { return !p.owner; }).length - 10) + ' more');
}
