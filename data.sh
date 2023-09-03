#!/bin/sh

cd /app

cd data
mkdir -p ../public/data
node schedule.js > ../public/data/schedule.json
node cash.js > ../public/data/cash.json
node players.js > ../public/data/players.json
node picks.js > ../public/data/picks.json
cd ..

cd trade
mkdir -p ../public/trade
node index.js render
