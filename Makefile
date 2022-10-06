ci:
	docker run --rm -v $(PWD):/app node:14-alpine sh -c "cd /app && npm ci"

seed:
	@echo "Use something like:"
	@echo "docker exec -i pso-mongo sh -c \"mongorestore --drop --archive\" < ~/backups/pso/pso.dump"

sleeper:
	docker run --rm -v $(PWD):/app node:14-alpine sh -c "wget -O /app/public/data/sleeper-data.json https://api.sleeper.app/v1/players/nfl"

data:
	docker exec pso-cron sh -c "cd /app && sh data.sh"

results:
	docker exec pso-cron sh -c "cd /app && sh results.sh"
