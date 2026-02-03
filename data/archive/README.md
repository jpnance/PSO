# Archive

Historical data files organized by purpose.

## Directory Structure

### `snapshots/`
**Actively parsed by the facts engine.** These files are read by `data/facts/snapshot-facts.js` and other seeders.

- `contracts-YYYY.txt` — Post-season roster snapshots (CSV: ID, Owner, Player, Position, Start, End, Salary)
- `postseason-YYYY.txt` — Additional post-season snapshots
- `extracted-all.csv` — Aggregated data from early-year spreadsheets and XML files
- `nfl-draft-2009.txt` — NFL draft results used to infer the 2009 PSO rookie draft

### `sources/`
**Raw source material kept for provenance.** Not directly parsed by the app, but used to generate the snapshot files.

- `excel/` — Original spreadsheets (dynasty.xls, PSO Spreadsheet.xls, teams.xls)
- `html/` — Web page snapshots from 2008-2009 (auction results, owner rosters, rookies.html/php)
- `xml/` — XML contract snapshots from 2008-2009 with ESPN player IDs
- `logs/` — Auction chat logs (auction2008.txt, auction2009.txt, auction2009-2.txt)

### `scripts/`
**One-time extraction utilities.** Used to parse source files and generate snapshot CSVs.

- `extract-all.js` — Extracts data from all source files into extracted-all.csv
- `generate-contracts.js` — Generates contracts CSV from XML files
- `parse-xml-contracts.js` — Analyzes XML files to identify player contracts
- `peek-excel.js` — Utility to examine Excel file contents

### `legacy/`
**Superseded or unclear files.** Kept for reference but not actively used.

- `contracts-2008-old.txt`, `contracts-2009-old.txt` — Earlier versions of contract snapshots
- `contracts.txt` — Simple player:years format (purpose unclear)
- `contract-history.txt` — Historical contract data (used by legacy auction-historical.js)
- `basic.txt` — Large file, unknown contents
- `koci.txt` — Unknown context
- `cuts-2008-reconstructed.txt` — Attempted reconstruction of 2008 cuts

## Historical Context

The XML files contain **player IDs** from ESPN circa 2008. These IDs appear in the snapshot CSVs.

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
