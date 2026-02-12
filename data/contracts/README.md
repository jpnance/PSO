# Contracts Data

## contracts.json

One entry per player whose contract **start year** matches the snapshot year (i.e. they signed a contract that season). Inferred purely from `contracts-YEAR.txt` snapshot files.

This file contains ALL contracts regardless of how the player was acquired (draft, auction, FA). For auction-specific data, see `data/auctions/`.

**Schema (per entry):**
- `season` — year the contract was signed
- `sleeperId` — Sleeper player ID, or `null` for historical players
- `name` — player name
- `positions` — array (e.g. `["QB"]`, `["DL", "LB"]`)
- `rosterId` — franchise roster ID for that year
- `salary` — contract salary
- `startYear`, `endYear` — contract term

## Generating

```bash
node data/contracts/generate.js
node data/contracts/generate.js --dry-run
```

Requires `config/pso.js` for owner → rosterId mapping by year. Rows with unknown or blank owner are skipped (and warned).
