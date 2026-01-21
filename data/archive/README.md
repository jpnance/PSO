# What Are Those?

Files here are relics from the past that have been unearthed and are believed to contribute context to the early days of PSO but have not yet been parsed. Eventually, they may become part of `doc/`.

## Inventory

### Auction Chat Logs
- `auction2008.txt` — IRC log from the founding auction draft (Aug 18-19, 2008)
- `auction2009.txt`, `auction2009-2.txt` — Chat logs from the 2009 auction (shows RFA matching in action)

### XML Contract Snapshots
- `xml/dynastyData.xml` — 2008 opening day: team-based structure with rosters and contracts
- `xml/backupDynastyData.xml` — Same as above, appears to be a backup copy
- `xml/oldDynastyData.xml` — 2008 flat player list (no positions, no team assignments)
- `xml/newDynastyData.xml` — 2008 flat player list with positions added
- `xml/newDynastyData2.xml` — Same as above
- `dynastyData.xml` (root) — 2009 snapshot: includes FA pickups and 2009 rookie class

### HTML Snapshots
- `results.html` — Complete 2008 auction results (all 297 picks with owner, price, position)
- `cash.html` — Budget tracking page from the 2008 auction
- Per-owner roster snapshots: `schex.html`, `koci.html`, `daniel.html`, `james.html`, `jeff.html`, `john.html`, `keyon.html`, `patrick.html`, `syed.html`, `trevor.html`
- `rookies.html` — Unknown context (possibly rookie draft or eligible rookies list)

### Spreadsheets
- `dynasty.xls`, `teams.xls`, `PSO Spreadsheet.xls` — Excel files (not yet examined)

### Other
- `basic.txt` — Large file, unknown contents
- `contracts.txt` — Simple player:years format (possibly contract lengths)

## What We Know

The XML files contain **player IDs** that appear to be from ESPN or MFL circa 2008. These IDs could potentially be used to reconcile with external data sources.

**Original Team Names (2008):**
1. Melrose Place Schwingers
2. Four-Toed Creed
3. Upper East Siders
4. Gossip Girl Blair Waldorf
5. Desperate Housewives
6. Primetime Playmakers
7. Ewing Oil Co.
8. Gossip Girl Jenny Humphrey
9. Team Reynolds
10. Cliff Barnes Losers

## Parser Script

`parse-xml-contracts.js` extracts all contracts from all XML files and groups them by player ID. Run with:

```bash
node data/archive/parse-xml-contracts.js
```

This identifies 386 unique player IDs and 174 players with multiple distinct contracts (showing evolution from 2008 → 2009).

## Known Issues

- Minor salary discrepancies between team-based and flat XML files for some 2008 contracts
- Some player name spelling variations (e.g., "Chad Ochocinco" vs "Chad Johnson", "Aaron Schobel" vs "Aaron Schoebel")
