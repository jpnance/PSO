ci:
	docker run --rm -it -v $(PWD):/app -w /app node:14-alpine npm ci

seed:
	@echo "Use something like:"
	@echo "docker exec -i pso-mongo sh -c \"mongorestore --drop --archive\" < ~/backups/pso/pso.dump"

sleeper:
	docker run --rm -it -v $(PWD):/app node:14-alpine sh -c "wget -O /app/public/data/sleeper-data.json https://api.sleeper.app/v1/players/nfl"

data:
	docker exec -it -w /app pso-cron sh data.sh

results:
	docker exec -it -w /app pso-cron sh results.sh
