#!/usr/bin/env node

/**
 * Fish for Sleeper GraphQL mutation names by triggering "Did you mean...?" errors.
 * 
 * Usage:
 *   SLEEPER_JWT=<token> node tools/fish-mutations.js
 */

const JWT = process.env.SLEEPER_JWT;

if (!JWT) {
  console.error('Usage: SLEEPER_JWT=<token> node tools/fish-mutations.js');
  process.exit(1);
}

const probes = [
  'waiver',
  'waiver_budget',
  'waiver_position',
  'waiver_order',
  'waiver_priority',
  'waiver_settings',
  'budget',
  'faab',
  'roster',
  'roster_settings',
  'roster_waiver',
  'commish',
  'commissioner',
  'settings',
  'update',
  'edit',
  'set',
  'priority',
  'order',
  'league',
  'league_settings',
  'league_waiver',
  'league_update',
  'league_edit',
  'team',
  'owner',
  'transaction',
  'trade',
  'claim',
  'drop',
  'add',
  'pick',
  'draft',
  'lineup',
  'player',
  'message',
  'chat',
  'invite',
  'kick',
  'leave',
  'join',
  'create',
  'delete',
  'remove',
  'cancel',
  'accept',
  'reject',
  'process',
  'execute',
  'submit',
  'save',
  'modify',
  'change',
  'admin',
  'manage',
  'config',
  'bulk',
  'batch',
];

async function probe(name) {
  const res = await fetch('https://sleeper.com/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': JWT,
      'Origin': 'https://sleeper.com',
      'Referer': 'https://sleeper.com/',
      'X-Sleeper-GraphQL-Op': name,
      'User-Agent': 'Mozilla/5.0',
    },
    body: JSON.stringify({
      operationName: name,
      query: `mutation ${name} { ${name} }`
    })
  });
  
  const data = await res.json();
  const error = data.errors?.[0]?.message || '';
  
  const match = error.match(/Did you mean (.+)\?/);
  if (match) {
    console.log(`"${name}" → suggestions: ${match[1]}`);
  }
}

(async () => {
  console.log('Fishing for mutation names...\n');
  
  const seen = new Set();
  
  for (const name of probes) {
    await probe(name);
    await new Promise(r => setTimeout(r, 100));
  }
  
  console.log('\nDone.');
})();
