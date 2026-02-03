#!/usr/bin/env node

/**
 * Parse all XML files in the archive to extract distinct contracts per player ID.
 * 
 * Usage: node parse-xml-contracts.js
 */

const fs = require('fs');
const path = require('path');

// Simple XML parser for our specific structure
function parseXML(content) {
  const players = [];
  
  // Match all <player>...</player> blocks
  const playerRegex = /<player>([\s\S]*?)<\/player>/g;
  let match;
  
  while ((match = playerRegex.exec(content)) !== null) {
    const playerXml = match[1];
    
    const id = extractTag(playerXml, 'id');
    const name = extractTag(playerXml, 'name');
    const position = extractTag(playerXml, 'position');
    const salary = extractTag(playerXml, 'salary');
    const start = extractTag(playerXml, 'start');
    const end = extractTag(playerXml, 'end');
    const type = extractTag(playerXml, 'type');
    
    if (id && salary && end) {
      players.push({
        id,
        name,
        position: position || null,
        contract: {
          salary: parseInt(salary, 10),
          start: start || null,
          end: end || null,
          type: type || null
        }
      });
    }
  }
  
  return players;
}

function extractTag(xml, tag) {
  const regex = new RegExp(`<${tag}>([^<]*)</${tag}>`);
  const match = xml.match(regex);
  return match ? match[1].trim() : null;
}

function extractTeamContext(content) {
  // For team-based XMLs, extract team info for each player
  const teams = {};
  const teamRegex = /<team>([\s\S]*?)<\/team>/g;
  let match;
  
  while ((match = teamRegex.exec(content)) !== null) {
    const teamXml = match[1];
    const teamId = extractTag(teamXml, 'id');
    const teamName = extractTag(teamXml, 'name');
    
    if (teamId && teamName) {
      // Find all player IDs in this team
      const playerIdRegex = /<player>[\s\S]*?<id>(\d+)<\/id>[\s\S]*?<\/player>/g;
      let playerMatch;
      while ((playerMatch = playerIdRegex.exec(teamXml)) !== null) {
        teams[playerMatch[1]] = { teamId, teamName };
      }
    }
  }
  
  return teams;
}

// XML files to parse
const xmlFiles = [
  { path: 'dynastyData.xml', label: 'root/dynastyData.xml (2009)' },
  { path: 'xml/dynastyData.xml', label: 'xml/dynastyData.xml (2008 teams)' },
  { path: 'xml/backupDynastyData.xml', label: 'xml/backupDynastyData.xml (2008 teams)' },
  { path: 'xml/oldDynastyData.xml', label: 'xml/oldDynastyData.xml (2008 flat)' },
  { path: 'xml/newDynastyData.xml', label: 'xml/newDynastyData.xml (2008 flat+pos)' },
  { path: 'xml/newDynastyData2.xml', label: 'xml/newDynastyData2.xml (2008 flat+pos)' },
];

const archiveDir = __dirname;

// Collect all contracts by player ID
const playerContracts = new Map(); // id -> { names: Set, contracts: [] }

for (const file of xmlFiles) {
  const filePath = path.join(archiveDir, file.path);
  
  if (!fs.existsSync(filePath)) {
    console.log(`Skipping ${file.label} (not found)`);
    continue;
  }
  
  const content = fs.readFileSync(filePath, 'utf-8');
  const players = parseXML(content);
  const teamContext = extractTeamContext(content);
  
  console.log(`\nParsed ${file.label}: ${players.length} players`);
  
  for (const player of players) {
    if (!playerContracts.has(player.id)) {
      playerContracts.set(player.id, {
        names: new Set(),
        positions: new Set(),
        contracts: []
      });
    }
    
    const record = playerContracts.get(player.id);
    record.names.add(player.name);
    if (player.position) {
      record.positions.add(player.position);
    }
    
    const team = teamContext[player.id];
    
    record.contracts.push({
      source: file.label,
      salary: player.contract.salary,
      start: player.contract.start,
      end: player.contract.end,
      type: player.contract.type,
      team: team ? team.teamName : null
    });
  }
}

// Analyze and report
console.log('\n' + '='.repeat(80));
console.log('SUMMARY');
console.log('='.repeat(80));
console.log(`Total unique player IDs: ${playerContracts.size}`);

// Find players with multiple distinct contracts
const playersWithMultipleContracts = [];

for (const [id, record] of playerContracts) {
  // Dedupe contracts by salary+start+end
  const uniqueContracts = new Map();
  for (const c of record.contracts) {
    const key = `${c.salary}|${c.start}|${c.end}`;
    if (!uniqueContracts.has(key)) {
      uniqueContracts.set(key, { ...c, sources: [c.source] });
    } else {
      uniqueContracts.get(key).sources.push(c.source);
    }
  }
  
  if (uniqueContracts.size > 1) {
    playersWithMultipleContracts.push({
      id,
      names: Array.from(record.names),
      positions: Array.from(record.positions),
      contracts: Array.from(uniqueContracts.values())
    });
  }
}

console.log(`Players with multiple distinct contracts: ${playersWithMultipleContracts.length}`);

console.log('\n' + '='.repeat(80));
console.log('PLAYERS WITH MULTIPLE CONTRACTS (showing contract evolution)');
console.log('='.repeat(80));

// Sort by player name
playersWithMultipleContracts.sort((a, b) => a.names[0].localeCompare(b.names[0]));

for (const player of playersWithMultipleContracts) {
  console.log(`\n${player.names.join(' / ')} (ID: ${player.id}) [${player.positions.join(', ')}]`);
  
  // Sort contracts by start year
  player.contracts.sort((a, b) => {
    const aStart = a.start === 'FA' ? 9999 : parseInt(a.start);
    const bStart = b.start === 'FA' ? 9999 : parseInt(b.start);
    return aStart - bStart;
  });
  
  for (const c of player.contracts) {
    const teamInfo = c.team ? ` [${c.team}]` : '';
    console.log(`  $${c.salary} (${c.start}-${c.end})${teamInfo}`);
  }
}

// Also output a summary of all players for reference
console.log('\n' + '='.repeat(80));
console.log('ALL PLAYERS WITH CONTRACTS (sorted by ID)');
console.log('='.repeat(80));

const allPlayers = Array.from(playerContracts.entries())
  .sort((a, b) => parseInt(a[0]) - parseInt(b[0]));

for (const [id, record] of allPlayers) {
  const names = Array.from(record.names).join(' / ');
  const positions = Array.from(record.positions).join(', ');
  
  // Get unique contracts
  const uniqueContracts = new Map();
  for (const c of record.contracts) {
    const key = `${c.salary}|${c.start}|${c.end}`;
    if (!uniqueContracts.has(key)) {
      uniqueContracts.set(key, c);
    }
  }
  
  const contractStrs = Array.from(uniqueContracts.values())
    .map(c => `$${c.salary} (${c.start}-${c.end})`)
    .join(', ');
  
  console.log(`${id}: ${names} [${positions}] - ${contractStrs}`);
}
