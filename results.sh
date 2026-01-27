#!/bin/sh

cd /app

SEASON=$(grep SEASON .env | sed -E "s/SEASON=//")

cd data/fetch
node games.js $SEASON
cd ../analysis
node seasons.js $SEASON
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
cd ../..

mkdir -p public/h2h
node generators/h2h.js render

mkdir -p public/history
node generators/history.js render
