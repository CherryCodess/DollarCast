.PHONY: dev install test lint typecheck migrate seed

dev:
	docker compose up --build

install:
	npm install

test:
	npm run test

lint:
	npm run lint

typecheck:
	npm run typecheck

migrate:
	npm run db:migrate

seed:
	npm run db:seed
