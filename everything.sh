#!/bin/sh

cd ~/Workspace/PSO

cd data
node index.js 2020
cd scripts
mongo pso_dev playoffAppearances.js
mongo pso_dev recordOccurrences.js
mongo pso_dev regularSeasonWinningPercentage.js
mongo pso_dev regularSeasonWins.js
mongo pso_dev weeklyScoringTitles.js
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
