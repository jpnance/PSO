#!/bin/bash
#
# Seed foundation data only (no transactions).
#
# This sets up:
#   - League config
#   - Franchises, people, regimes
#   - Players (from Sleeper)
#   - Picks structure
#
# After running this, the database is ready for chronological
# transaction seeding starting with the 2008 auction.
#
# Usage:
#   ./data/maintenance/seed-foundation.sh

set -e
trap 'echo ""; echo "Aborted."; exit 130' INT

echo "=== Seed Foundation ==="
echo ""

# Preflight
if ! docker ps --format '{{.Names}}' | grep -q "pso-mongo"; then
    echo "ERROR: pso-mongo not running"
    exit 1
fi
echo "✓ pso-mongo is running"
echo ""

# Collections to reset
COLLECTIONS="franchises people regimes players picks leagueconfigs transactions"

echo "This will drop: $COLLECTIONS"
echo ""
read -p "Continue? [y/N] " confirm
if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
    echo "Aborted."
    exit 1
fi

echo ""
echo "--- Dropping collections ---"
docker exec -i pso-mongo mongosh pso --quiet --eval "
    var collections = '$COLLECTIONS'.split(' ');
    collections.forEach(function(c) {
        var count = db.getCollection(c).countDocuments({});
        if (count > 0) {
            print('  Dropping ' + c + ' (' + count + ' docs)');
            db[c].drop();
        }
    });
"

echo ""
echo "--- Seeding league config ---"
docker compose run --rm web node data/seed/league-config.js

echo ""
echo "--- Seeding entities (franchises, people, regimes) ---"
docker compose run --rm web node data/seed/entities.js

echo ""
echo "--- Syncing players from Sleeper ---"
docker compose run --rm web node data/maintenance/sync-players.js

echo ""
echo "--- Seeding picks structure ---"
docker compose run --rm web node data/seed/picks.js

echo ""
echo "=== Foundation Complete ==="
echo ""
echo "Database is ready for transaction seeding."
echo "Next step: run the 2008 auction seeder:"
echo ""
echo "  docker compose run --rm -it web node data/seed/auction-2008.js"
echo ""
