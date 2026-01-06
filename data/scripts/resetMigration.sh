#!/bin/bash
#
# Reset and reseed all migration-related collections.
#
# This script:
#   1. Drops migration collections (preserves games and leader reports)
#   2. Runs all seed scripts in the correct order
#
# Usage:
#   ./data/scripts/resetMigration.sh [--dry-run]
#
# Prerequisites:
#   - Docker containers running (pso-mongo, web)
#   - Network access (for Sleeper, WordPress, and Google Sheets APIs)
#
# Interactive steps will prompt for unresolved player names.
# Resolutions are cached in data/scripts/player-resolutions.json.

set -e

DRY_RUN=false
if [ "$1" = "--dry-run" ]; then
    DRY_RUN=true
    echo "=== DRY RUN MODE ==="
    echo ""
fi

# Collections created by the migration (safe to drop)
MIGRATION_COLLECTIONS="franchises people regimes players contracts budgets picks transactions leagueconfigs rosters"

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
            echo "[dry-run] make sleeper"
        else
            make sleeper
        fi
    fi
else
    echo "Sleeper data not found. Fetching..."
    if [ "$DRY_RUN" = true ]; then
        echo "[dry-run] make sleeper"
    else
        make sleeper
    fi
fi
echo ""

# Step 1: Seed league config
echo "=== Step 1: Seeding league config ==="
if [ "$DRY_RUN" = true ]; then
    echo "[dry-run] docker compose run --rm web node data/scripts/seedLeagueConfig.js"
else
    docker compose run --rm web node data/scripts/seedLeagueConfig.js
fi
echo ""

# Step 2: Seed entities (franchises, people, regimes)
echo "=== Step 2: Seeding entities ==="
if [ "$DRY_RUN" = true ]; then
    echo "[dry-run] docker compose run --rm web node data/scripts/seedEntities.js"
else
    docker compose run --rm web node data/scripts/seedEntities.js
fi
echo ""

# Step 3: Sync players from Sleeper
echo "=== Step 3: Syncing players from Sleeper ==="
if [ "$DRY_RUN" = true ]; then
    echo "[dry-run] docker compose run --rm web node data/scripts/syncPlayers.js"
else
    docker compose run --rm web node data/scripts/syncPlayers.js
fi
echo ""

# Step 4: Seed contracts (interactive)
echo "=== Step 4: Seeding contracts (interactive) ==="
if [ "$DRY_RUN" = true ]; then
    echo "[dry-run] docker compose run --rm -it web node data/scripts/seedContracts.js"
else
    docker compose run --rm -it web node data/scripts/seedContracts.js
fi
echo ""

# Step 5: Seed budgets
echo "=== Step 5: Seeding budgets ==="
if [ "$DRY_RUN" = true ]; then
    echo "[dry-run] docker compose run --rm web node data/scripts/seedBudgets.js"
else
    docker compose run --rm web node data/scripts/seedBudgets.js
fi
echo ""

# Step 6: Seed picks
echo "=== Step 6: Seeding picks ==="
if [ "$DRY_RUN" = true ]; then
    echo "[dry-run] docker compose run --rm web node data/scripts/seedPicks.js"
else
    docker compose run --rm web node data/scripts/seedPicks.js
fi
echo ""

# Step 7: Seed trades (interactive, needs network)
echo "=== Step 7: Seeding trades (interactive, needs network) ==="
if [ "$DRY_RUN" = true ]; then
    echo "[dry-run] docker compose run --rm -it web node data/scripts/seedTrades.js"
else
    docker compose run --rm -it web node data/scripts/seedTrades.js
fi
echo ""

# Step 8: Seed draft selections (interactive, needs network)
echo "=== Step 8: Seeding draft selections (interactive, needs network) ==="
if [ "$DRY_RUN" = true ]; then
    echo "[dry-run] docker compose run --rm -it web node data/scripts/seedDraftSelections.js"
else
    docker compose run --rm -it web node data/scripts/seedDraftSelections.js
fi
echo ""

# Step 9: Seed cuts (interactive, needs network)
echo "=== Step 9: Seeding cuts (interactive, needs network) ==="
if [ "$DRY_RUN" = true ]; then
    echo "[dry-run] docker compose run --rm -it web node data/scripts/seedCuts.js --auto-historical-before=2016"
else
    docker compose run --rm -it web node data/scripts/seedCuts.js --auto-historical-before=2016
fi
echo ""

# Step 10: Fix legacy trade notes
echo "=== Step 10: Adding legacy trade notes ==="
if [ "$DRY_RUN" = true ]; then
    echo "[dry-run] docker compose run --rm web node data/scripts/addLegacyTradeNotes.js"
else
    docker compose run --rm web node data/scripts/addLegacyTradeNotes.js
fi
echo ""

echo "=== Done! ==="
echo ""
echo "If any interactive scripts prompted for new player resolutions,"
echo "don't forget to commit changes to data/scripts/player-resolutions.json"
