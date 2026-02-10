# Auctions Data

## auctions.json

One entry per player whose contract **start year** matches the snapshot year (i.e. they were acquired that season via auction). Inferred purely from `contracts-YEAR.txt` snapshot files.

**Schema (per entry):**
- `season` — year of the auction
- `sleeperId` — Sleeper player ID, or `null` for historical players
- `name` — player name
- `positions` — array (e.g. `["QB"]`, `["DL", "LB"]`)
- `rosterId` — franchise roster ID for that year (who ended up with the player)
- `salary` — contract salary
- `startYear`, `endYear` — contract term

The auction seeder uses this file and decides transaction type (UFA vs RFA matched/unmatched) by cross-referencing RFA conversion data. Contract-setting timestamp uses the league’s contract due date.

## Generating

```bash
node data/auctions/generate.js
node data/auctions/generate.js --dry-run
```

Requires `config/pso.js` for owner → rosterId mapping by year. Rows with unknown or blank owner are skipped (and warned).
