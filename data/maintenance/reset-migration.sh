#!/bin/bash
#
# Reset and reseed all migration-related collections.
#
# This script:
#   1. Drops migration collections (preserves games and leader reports)
#   2. Runs all seed scripts in the correct order
#
# Usage:
#   ./data/maintenance/reset-migration.sh [--dry-run]
#
# Prerequisites:
#   - Docker containers running (pso-mongo, web)
#   - Network access (for Sleeper, WordPress, and Google Sheets APIs)
#
# Interactive steps will prompt for unresolved player names.
# Resolutions are cached in data/config/player-resolutions.json.

set -e

# Trap Ctrl+C and exit immediately
trap 'echo ""; echo "Aborted by user."; exit 130' INT

# Load specific vars from .env (can't source directly due to JSON values)
if [ -f .env ]; then
    GOOGLE_API_KEY=$(grep '^GOOGLE_API_KEY=' .env | cut -d'=' -f2)
fi

DRY_RUN=false
if [ "$1" = "--dry-run" ]; then
    DRY_RUN=true
    echo "=== DRY RUN MODE ==="
    echo ""
fi

# =============================================================================
# Preflight checks
# =============================================================================

echo "=== Preflight Checks ==="
PREFLIGHT_FAILED=false

# Check GOOGLE_API_KEY env var
if [ -z "$GOOGLE_API_KEY" ]; then
    echo "ERROR: GOOGLE_API_KEY environment variable is not set"
    echo "  Required for Google Sheets API access"
    PREFLIGHT_FAILED=true
else
    echo "✓ GOOGLE_API_KEY is set"
fi

# Check network connectivity
echo -n "Checking network connectivity... "
if curl -s --max-time 5 "https://sheets.googleapis.com" > /dev/null 2>&1; then
    echo "✓ Google Sheets API reachable"
else
    echo ""
    echo "ERROR: Cannot reach Google Sheets API"
    echo "  Check your network connection"
    PREFLIGHT_FAILED=true
fi

echo -n "Checking WordPress API... "
if curl -s --max-time 5 "https://thedynastyleague.wordpress.com" > /dev/null 2>&1; then
    echo "✓ WordPress API reachable"
else
    echo ""
    echo "ERROR: Cannot reach WordPress API (thedynastyleague.wordpress.com)"
    echo "  Check your network connection"
    PREFLIGHT_FAILED=true
fi

# Check Docker containers
echo -n "Checking Docker containers... "
if docker ps --format '{{.Names}}' | grep -q "pso-mongo"; then
    echo "✓ pso-mongo is running"
else
    echo ""
    echo "ERROR: pso-mongo container is not running"
    echo "  Start it with: docker compose up -d"
    PREFLIGHT_FAILED=true
fi

if [ "$PREFLIGHT_FAILED" = true ]; then
    echo ""
    echo "Preflight checks failed. Please fix the issues above and try again."
    exit 1
fi

echo ""

# =============================================================================
# Migration
# =============================================================================

# Collections created by the migration (safe to drop)
MIGRATION_COLLECTIONS="franchises people regimes players contracts budgets picks transactions leagueconfigs rosters proposals seasons"

# Collections to preserve (pre-existing data)
# games, championships, playoffAppearances, regularSeasonWinningPercentage, 
# regularSeasonWins, weeklyScoringTitles

echo "=== PSO Migration Reset ==="
echo ""
echo "This will DROP the following collections:"
for c in $MIGRATION_COLLECTIONS; do
    echo "  - $c"
done
echo ""
echo "The following collections will be PRESERVED:"
echo "  - games"
echo "  - championships"
echo "  - playoffAppearances"
echo "  - regularSeasonWinningPercentage"
echo "  - regularSeasonWins"
echo "  - weeklyScoringTitles"
echo ""

if [ "$DRY_RUN" = false ]; then
    read -p "Continue? [y/N] " confirm
    if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
        echo "Aborted."
        exit 1
    fi
    echo ""
fi

# Step -1: Drop migration collections
echo "=== Step -1: Dropping migration collections ==="
if [ "$DRY_RUN" = true ]; then
    echo "[dry-run] Would drop: $MIGRATION_COLLECTIONS"
else
    docker exec -i pso-mongo mongosh pso --quiet --eval "
        var collections = '$MIGRATION_COLLECTIONS'.split(' ');
        collections.forEach(function(c) {
            var count = db.getCollection(c).countDocuments({});
            if (count > 0) {
                print('  Dropping ' + c + ' (' + count + ' docs)');
                db[c].drop();
            } else {
                print('  Skipping ' + c + ' (empty or does not exist)');
            }
        });
    "
fi
echo ""

# Step 0: Fetch Sleeper data (if stale or missing)
SLEEPER_FILE="public/data/sleeper-data.json"
MAX_AGE_DAYS=7

echo "=== Step 0: Checking Sleeper data ==="
if [ -f "$SLEEPER_FILE" ]; then
    # Check file age (in days)
    if [ "$(uname)" = "Darwin" ]; then
        # macOS
        FILE_AGE_SECONDS=$(( $(date +%s) - $(stat -f %m "$SLEEPER_FILE") ))
    else
        # Linux
        FILE_AGE_SECONDS=$(( $(date +%s) - $(stat -c %Y "$SLEEPER_FILE") ))
    fi
    FILE_AGE_DAYS=$(( FILE_AGE_SECONDS / 86400 ))
    
    if [ "$FILE_AGE_DAYS" -lt "$MAX_AGE_DAYS" ]; then
        echo "Sleeper data is ${FILE_AGE_DAYS} day(s) old (max: ${MAX_AGE_DAYS}). Skipping fetch."
    else
        echo "Sleeper data is ${FILE_AGE_DAYS} day(s) old. Refreshing..."
        if [ "$DRY_RUN" = true ]; then
            echo "[dry-run] bash ./runts/sleeper"
        else
            bash ./runts/sleeper
        fi
    fi
else
    echo "Sleeper data not found. Fetching..."
    if [ "$DRY_RUN" = true ]; then
        echo "[dry-run] bash ./runts/sleeper"
    else
        bash ./runts/sleeper
    fi
fi
echo ""

# Step 1: Seed league config
echo "=== Step 1: Seeding league config ==="
if [ "$DRY_RUN" = true ]; then
    echo "[dry-run] docker compose run --rm web node data/seed/league-config.js"
else
    docker compose run --rm web node data/seed/league-config.js
fi
echo ""

# Step 2: Seed entities (franchises, people, regimes)
echo "=== Step 2: Seeding entities ==="
if [ "$DRY_RUN" = true ]; then
    echo "[dry-run] docker compose run --rm web node data/seed/entities.js"
else
    docker compose run --rm web node data/seed/entities.js
fi
echo ""

# Step 3: Sync players from Sleeper
echo "=== Step 3: Syncing players from Sleeper ==="
if [ "$DRY_RUN" = true ]; then
    echo "[dry-run] docker compose run --rm web node data/maintenance/sync-players.js"
else
    docker compose run --rm web node data/maintenance/sync-players.js
fi
echo ""

# Step 4: Seed contracts (interactive)
echo "=== Step 4: Seeding contracts (interactive) ==="
if [ "$DRY_RUN" = true ]; then
    echo "[dry-run] docker compose run --rm web node data/seed/contracts.js"
else
    docker compose run --rm web node data/seed/contracts.js
fi
echo ""

# Step 5: Seed picks
echo "=== Step 5: Seeding picks ==="
if [ "$DRY_RUN" = true ]; then
    echo "[dry-run] docker compose run --rm web node data/seed/picks.js"
else
    docker compose run --rm web node data/seed/picks.js
fi
echo ""

# Step 6: Seed 2009 draft (inferred from salary/position data)
echo "=== Step 6: Seeding 2009 draft (inferred) ==="
if [ "$DRY_RUN" = true ]; then
    echo "[dry-run] docker compose run --rm web node data/seed/draft-2009.js"
else
    docker compose run --rm web node data/seed/draft-2009.js
fi
echo ""

# Step 7: Seed draft selections (interactive, needs network)
# Must run before trades so rookie contract heuristic has draft data available
echo "=== Step 7: Seeding draft selections (interactive, needs network) ==="
if [ "$DRY_RUN" = true ]; then
    echo "[dry-run] docker compose run --rm web node data/seed/draft-selections.js --auto-historical-before=2016"
else
    docker compose run --rm -it web node data/seed/draft-selections.js --auto-historical-before=2016
fi
echo ""

# Step 8: Seed trades (interactive, needs network)
echo "=== Step 8: Seeding trades (interactive, needs network) ==="
if [ "$DRY_RUN" = true ]; then
    echo "[dry-run] docker compose run --rm web node data/seed/trades.js"
else
    docker compose run --rm web node data/seed/trades.js
fi
echo ""

# Step 9: Seed FA transactions from Sleeper/Fantrax (interactive for trade facilitation)
echo "=== Step 9: Seeding FA transactions (interactive) ==="
if [ "$DRY_RUN" = true ]; then
    echo "[dry-run] docker compose run --rm web node data/seed/fa-transactions.js"
else
    docker compose run --rm -it web node data/seed/fa-transactions.js
fi
echo ""

# Step 10: Seed FA pickups from snapshot diffs (2014-2019)
echo "=== Step 10: Seeding FA pickups from snapshots ==="
if [ "$DRY_RUN" = true ]; then
    echo "[dry-run] docker compose run --rm web node data/seed/fa-snapshot.js"
else
    docker compose run --rm web node data/seed/fa-snapshot.js
fi
echo ""

# Step 10b: Seed FA pickups from trades (2008-2019)
# Players picked up as FA and then traded away before postseason snapshot
echo "=== Step 10b: Seeding FA pickups from trades ==="
if [ "$DRY_RUN" = true ]; then
    echo "[dry-run] docker compose run --rm web node data/seed/fa-trades.js"
else
    docker compose run --rm web node data/seed/fa-trades.js
fi
echo ""

# Step 10c: Seed FA reacquisitions (players picked up after someone else cut them)
echo "=== Step 10c: Seeding FA reacquisitions ==="
if [ "$DRY_RUN" = true ]; then
    echo "[dry-run] docker compose run --rm web node data/seed/fa-reacquisition.js"
else
    docker compose run --rm web node data/seed/fa-reacquisition.js
fi
echo ""

# Step 10d: Seed FA pickups from cuts data (2009-2019)
# These are players picked up and cut within the same season (before postseason snapshot)
echo "=== Step 10d: Seeding FA pickups from cuts ==="
if [ "$DRY_RUN" = true ]; then
    echo "[dry-run] docker compose run --rm web node data/seed/fa-cuts.js"
else
    docker compose run --rm web node data/seed/fa-cuts.js
fi
echo ""

# Step 10e: Seed cuts (enriches FA drops + creates offseason/in-season cuts)
# Must run AFTER FA pickups so timestamps can be cross-referenced
echo "=== Step 10e: Seeding cuts ==="
if [ "$DRY_RUN" = true ]; then
    echo "[dry-run] docker compose run --rm web node data/seed/cuts.js --auto-historical-before=2016"
else
    docker compose run --rm -it web node data/seed/cuts.js --auto-historical-before=2016
fi
echo ""

# Step 11: Seed budgets (calculated from contracts, trades, cuts)
# Note: addLegacyTradeNotes.js was removed - heuristics are now in seedTrades.js
# and ambiguous contracts are flagged with the `ambiguous` field on trade players.
echo "=== Step 11: Seeding budgets ==="
if [ "$DRY_RUN" = true ]; then
    echo "[dry-run] docker compose run --rm web node data/seed/budgets.js"
else
    docker compose run --rm web node data/seed/budgets.js
fi
echo ""

# Step 12: Apply manual fixups (trade edits now trigger budget recalculation)
echo "=== Step 12: Applying manual fixups ==="
if [ "$DRY_RUN" = true ]; then
    echo "[dry-run] docker compose run --rm web node data/maintenance/apply-fixups.js"
else
    docker compose run --rm web node data/maintenance/apply-fixups.js
fi
echo ""

# Step 13: Compute season data (playoff seeds, results)
echo "=== Step 13: Computing season data ==="
if [ "$DRY_RUN" = true ]; then
    echo "[dry-run] docker compose run --rm web node data/analysis/seasons.js"
else
    docker compose run --rm web node data/analysis/seasons.js
fi
echo ""

# Step 14: Seed auction/contract transactions (interactive)
echo "=== Step 14: Seeding auction transactions (interactive) ==="
for year in 2008 2009 2010 2011 2012 2013 2014 2015 2016 2017 2018 2019 2020 2021 2022 2023 2024 2025; do
    echo "--- Auction year: $year ---"
    # Use --auto-historical for early years (many players won't be in Sleeper)
    if [ "$year" -lt 2015 ]; then
        AUTO_HIST="--auto-historical"
    else
        AUTO_HIST=""
    fi
    if [ "$DRY_RUN" = true ]; then
        echo "[dry-run] docker compose run --rm web node data/seed/auction.js $year $AUTO_HIST"
    else
        docker compose run --rm -it web node data/seed/auction.js $year $AUTO_HIST
    fi
done
echo ""

# Step 14b: Seed auction wins from cuts data (players cut with same-year contracts)
echo "=== Step 14b: Seeding auction wins from cuts ==="
if [ "$DRY_RUN" = true ]; then
    echo "[dry-run] docker compose run --rm web node data/seed/auction-cuts.js"
else
    docker compose run --rm web node data/seed/auction-cuts.js
fi
echo ""

# Step 14c: Seed RFA rights conversions (contracts expiring into RFA rights)
echo "=== Step 14c: Seeding RFA rights conversions ==="
if [ "$DRY_RUN" = true ]; then
    echo "[dry-run] docker compose run --rm web node data/seed/rfa-conversions.js"
else
    docker compose run --rm web node data/seed/rfa-conversions.js
fi
echo ""

# Step 15: Backfill positions for historical players
echo "=== Step 15: Backfilling positions ==="
if [ "$DRY_RUN" = true ]; then
    echo "[dry-run] docker compose run --rm web node data/maintenance/backfill-positions.js"
else
    docker compose run --rm web node data/maintenance/backfill-positions.js
fi
echo ""

# Step 16: Reorder transactions for logical consistency
echo "=== Step 16: Reordering transactions ==="
if [ "$DRY_RUN" = true ]; then
    echo "[dry-run] docker compose run --rm web node data/maintenance/reorder-transactions.js"
else
    docker compose run --rm web node data/maintenance/reorder-transactions.js
fi
echo ""

echo "=== Done! ==="
echo ""
echo "If any interactive scripts prompted for new player resolutions,"
echo "don't forget to commit changes to data/config/player-resolutions.json"
