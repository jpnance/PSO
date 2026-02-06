# Database Seeding

This directory contains scripts for seeding the PSO database from historical data sources.

## Quick Start

```bash
# Nuke everything and rebuild from scratch
runt seed-fresh

# Just seed 2008
runt seed-2008

# Validate existing data
runt seed-fresh --validate-only
```

## Architecture

The seeding process builds player transaction history **chronologically**, one season at a time. This approach ensures:

1. **State tracking** - We always know each player's current contract/roster state
2. **Validation** - Each transaction can be validated against known state
3. **Sanity checks** - Pre-computed contract data in trades.json serves as validation

### Omnibus Seeder (`index.js`)

Entry point that orchestrates full database seeding:

1. Clears all transactions and historical players
2. Seeds foundation (entities: franchises, regimes, persons)
3. Seeds each season in order (2008, 2009, ...)
4. Runs final validation

### Season Seeders (`season-YYYY.js`)

Each season seeder runs sub-seeders in the correct order:

**2008 (`season-2008.js`):**
1. `auction-2008.js` - Auction results and contracts
2. `trades-2008.js` - Trades (validates against chronological state)
3. `fa-2008.js` - FA pickups and cuts (inferred from snapshots)
4. Validation via `player-chains.js`

## Data Sources

### 2008

| Source | Location | Contains |
|--------|----------|----------|
| Auction results | `data/archive/sources/html/results.html` | Who won each player, winning bid |
| Contracts snapshot | `data/archive/snapshots/contracts-2008.txt` | End-of-auction roster state with contract terms |
| Trades | `data/trades/trades.json` | All trades with timestamps, parties, assets |
| Postseason state | `data/archive/sources/extracted-all.csv` | End-of-year roster (teams.xls rows for 2008) |

### 2020+

Sleeper transaction logs provide complete FA activity with timestamps.

## Contract Conventions

### Multi-year contracts (auction, RFA conversion)
- `startYear`: First year of contract
- `endYear`: Final year of contract
- Example: 3-year deal signed in 2008 → `startYear: 2008, endYear: 2010`

### FA pickups (single-year)
- `startYear`: `null` (indicates FA pickup, not multi-year)
- `endYear`: Year acquired
- Example: FA pickup in 2008 → `startYear: null, endYear: 2008`

### Unsigned (pre-contract)
- `startYear`: `null`
- `endYear`: `null`
- Used for players traded during auction before contracts due

## Inference and Limitations

### What we can infer (2008)

**FA pickups:** Player appears on end-of-season roster with "FA/2008" designation but wasn't in the auction → must have been picked up mid-season.

**Cuts:** Player was auctioned but doesn't appear on end-of-season roster → must have been cut.

**Trade-aware attribution:** If an FA pickup appears on the end-of-season roster owned by Team B, but trades show Team A traded them to Team B, we attribute the FA pickup to Team A.

### Known limitations (pre-2020)

**Multiple transactions invisible:** If a player was cut and picked up multiple times within a season, we only see the endpoints.

Example:
1. Auctioned by Team A
2. Cut by Team A (Oct 1) → *not recorded*
3. Picked up by Team B (Oct 15) → *not recorded*
4. Cut by Team B (Nov 1) → *not recorded*
5. Picked up by Team C (Nov 15) → *this is what we record*

We record: auction to A, cut from A, pickup by C. The Team B chapter is lost.

**Exception:** If a player appears in a mid-season trade, we know their state at that moment, which can help fill in gaps.

**Timestamps are conventional:** For inferred transactions, we use conventional timestamps:
- FA drops: First Thursday of October at 12:00:32 ET
- FA pickups: First Thursday of October at 12:00:33 ET

## Validation

The `player-chains.js` script validates that every player has a legal transaction chain:

```bash
# Full report
docker compose exec web node data/analysis/player-chains.js --report

# Specific player
docker compose exec web node data/analysis/player-chains.js --player="Kirk Morrison"
```

### Valid state transitions

| From State | Transaction Type | To State |
|------------|------------------|----------|
| available | auction-ufa | rostered |
| available | fa (pickup) | rostered |
| available | draft-select | rostered |
| rostered | fa (cut) | available |
| rostered | trade | rostered (different franchise) |
| rostered | contract | rostered (same franchise) |
| rfa-held | auction-rfa | rostered |
| rfa-held | rfa-lapsed | available |

## Pre-computed Contract Data

The `enrich-trade-contracts.js` script pre-computes contract terms for all players in trades.json:

```bash
docker compose run --rm web node data/maintenance/enrich-trade-contracts.js
```

This adds a `contract` field to each player in trades:

```json
{
  "name": "Kirk Morrison",
  "salary": 1,
  "contractStr": "2008",
  "contract": {
    "start": null,
    "end": 2008,
    "source": "certain"
  }
}
```

The trades seeder validates chronological state against this pre-computed data.
