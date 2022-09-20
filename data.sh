#!/bin/sh

cd /app

cd data
mkdir -p ../public/data
node cash.js > ../public/data/cash.json
node players.js > ../public/data/players.json
node picks.js > ../public/data/picks.json
cd ..
cd trade
node index.js render
