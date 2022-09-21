ci:
	docker run --rm -v $(PWD):/app node:14-alpine sh -c "cd /app && npm ci"
