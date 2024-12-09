ci:
	docker run --rm -it -v $(PWD):/app -w /app node:14-alpine npm ci

seed:
	@echo "Use something like:"
	@echo "docker exec -i pso-mongo sh -c \"mongorestore --drop --archive\" < ~/backups/pso.dump"

sleeper:
	docker run --rm -it -v $(PWD):/app node:14-alpine sh -c "wget -O /app/public/data/sleeper-data.json https://api.sleeper.app/v1/players/nfl"

pso-data:
	docker exec -it -w /app pso-cron sh data.sh

pso-results:
	docker exec -it -w /app pso-cron sh results.sh

auction-links:
	docker exec -it -w /app pso-cron sh -c "cd auction && node links.js"

pso-auction-render:
	docker exec -it -w /app pso-cron sh -c "cd auction && node index.js site=pso render"

pso-auction-demo-data:
	docker exec -it -w /app pso-cron sh -c "cd auction && node index.js site=pso demo"

colbys-auction-render:
	docker exec -it -w /app pso-cron sh -c "cd auction && node index.js site=colbys season=2023 render"

colbys-auction-demo-data:
	docker exec -it -w /app pso-cron sh -c "cd auction && node index.js site=colbys season=2023 demo"

pso-positions:
	docker exec -it -w /app pso-cron sh -c "cd bots && node positions.js site=pso"

colbys-positions:
	docker exec -it -w /app pso-cron sh -c "cd bots && node positions.js site=colbys"

projections:
	docker exec -it -w /app pso-cron sh -c "cd projections && node index.js"

projections-csv:
	docker exec -it -w /app pso-cron sh -c "cd prep && node csv.js"

rpo:
	docker exec -it -w /app pso-cron sh -c "cd note && node rpo.js"
