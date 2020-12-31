#!/bin/sh

cd ~/Workspace/PSO

MONGODB_URI=$(grep MONGODB_URI .env | sed -E "s/MONGODB_URI=//")
SEASON=$(grep SEASON .env | sed -E "s/SEASON=//")

cd data
node index.js $SEASON
cd scripts
mongo $MONGODB_URI marginOfVictory.js
mongo $MONGODB_URI playoffAppearances.js
mongo $MONGODB_URI recordOccurrences.js
mongo $MONGODB_URI regularSeasonWinningPercentage.js
mongo $MONGODB_URI regularSeasonWins.js
mongo $MONGODB_URI weeklyScoringTitles.js
mongo $MONGODB_URI highestScoringLosses.js
mongo $MONGODB_URI lowestScoringWins.js
cd ..
cd ..

cd h2h
node index.js render
cd ..

cd history
node index.js render
cd ..

cd jaguar
node index.js render
cd ..
