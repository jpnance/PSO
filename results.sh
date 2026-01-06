#!/bin/sh

cd /app

SEASON=$(grep SEASON .env | sed -E "s/SEASON=//")

cd data
node index.js $SEASON
cd scripts
node championships.js
node highestScoringLosses.js
node lowestScoringWins.js
node marginOfVictory.js
node playoffAppearances.js
node recordOccurrences.js
node regularSeasonWinningPercentage.js
node regularSeasonWins.js
node regularSeasonAllPlay.js
node seasonSummaries.js
node weeklyScoringTitles.js
cd ..
cd ..

cd h2h
mkdir -p ../public/h2h
node index.js render
cd ..

cd history
mkdir -p ../public/history
node index.js render
cd ..

cd jaguar
mkdir -p ../public/jaguar
node index.js render
cd ..
