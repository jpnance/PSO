# Facts Layer

This directory contains parsers that extract **raw facts** from data sources.

## Design Principles

1. **No inference**: Parsers extract exactly what the source says, nothing more
2. **Preserve raw strings**: Contract notations like "2019" or "09/11" are kept as-is
3. **Minimal normalization**: Only decode HTML entities and trim whitespace
4. **Testable**: Each parser can be unit tested with sample input/output

## Fact Types

### TradeFact
Extracted from WordPress trade posts.

```javascript
{
  tradeId: 123,
  date: Date,
  url: 'https://...',
  parties: [{
    owner: 'Schex',
    players: [{
      name: 'Josh Allen',
      salary: 44,
      contractStr: '22/26',  // Raw, unparsed
      espnId: '12345'        // If available from link
    }],
    picks: [{
      round: 1,
      season: 2025,
      fromOwner: 'Koci'
    }],
    cash: [{
      amount: 500,
      season: 2025,
      fromOwner: 'Nance'
    }],
    rfaRights: [{
      name: 'Cooper Kupp',
      espnId: '67890'
    }]
  }]
}
```

### CutFact
Extracted from Google Sheets cuts data.

```javascript
{
  owner: 'Schex',
  name: 'Player Name',
  hint: 'DEN',           // Disambiguation hint if present
  position: 'WR',
  startYear: 2022,       // null if 'FA'
  endYear: 2024,
  salary: 50,
  cutYear: 2024
}
```

### DraftFact
Extracted from Google Sheets draft data.

```javascript
{
  season: 2024,
  pickNumber: 1,
  round: 1,
  owner: 'Schex',
  playerName: 'Caleb Williams'
}
```

### SnapshotFact
Extracted from contracts-YEAR.txt files.

```javascript
{
  season: 2024,
  espnId: '12345',       // null if '-1'
  owner: 'Schex',
  playerName: 'Josh Allen',
  position: 'QB',
  startYear: 2022,
  endYear: 2024,
  salary: 44
}
```

### SleeperTransactionFact
Extracted from Sleeper transaction JSON files.

```javascript
{
  type: 'trade' | 'waiver' | 'free_agent',
  timestamp: Date,
  status: 'complete',
  rosterIds: [1, 2],
  adds: { playerId: rosterId },
  drops: { playerId: rosterId },
  draftPicks: [...],
  waiverBudget: [...]
}
```

## Usage

```javascript
var tradeFacts = require('./data/facts/trade-facts');
var cutFacts = require('./data/facts/cut-facts');

// Parse from raw source
var trades = tradeFacts.parseTradePost(htmlContent, tradeDate);
var cuts = cutFacts.parseCutsSheet(sheetRows);

// Or fetch and parse
var allTrades = await tradeFacts.fetchAll();
var allCuts = await cutFacts.fetchAll();
```
