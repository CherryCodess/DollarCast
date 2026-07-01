# $cast Deployment Runbook

## Services

Run these as separate long-lived services:

- `web`: Next.js UI and BFF API
- `weather-service`: FastAPI probability and source service
- `edge-scanner`: background Kalshi/orderbook/probability scanner
- `weather-worker`: background NBM/HRRR/NWS/METAR ingestion
- `retention-worker`: background database and GRIB cache cleanup
- `postgres`: local development only, use managed Postgres in production
- `redis`: local development only, use managed Redis in production

## Managed Postgres And Redis

For production, point services at managed infrastructure:

```text
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DB?schema=public
WEATHER_DATABASE_URL=postgresql+psycopg://USER:PASSWORD@HOST:5432/DB
REDIS_URL=rediss://USER:PASSWORD@HOST:6379
```

Use `DATABASE_URL` for `web`, `edge-scanner`, and `retention-worker`.
Use `WEATHER_DATABASE_URL` for `weather-service` and `weather-worker`.

Run migrations before starting workers:

```bash
npx prisma migrate deploy
```

## Health Checks

HTTP:

```bash
curl -f http://localhost:3000/api/health
curl -f http://localhost:3000/api/admin-status
curl -f http://localhost:3000/api/metrics
curl -f http://localhost:8000/health
curl -f http://localhost:8000/ingestion/status
```

Docker:

```bash
docker compose ps
docker compose logs -f web
docker compose logs -f edge-scanner
docker compose logs -f weather-worker
docker compose logs -f retention-worker
```

## Metrics

`/api/metrics` returns Prometheus-style gauges for:

- edge scan duration
- scanned market/candidate counts
- eligible candidate count
- Kalshi circuit breaker state
- mapping issue count
- weather source freshness
- storage row counts

## Alert Rules

Minimum production alerts:

- `web` health check failing for 2 consecutive checks
- `weather-service` health check failing for 2 consecutive checks
- `edge-scanner` unhealthy or no fresh scan within 10 minutes
- `weather-worker` unhealthy or no active/completed heartbeat within 2 hours
- `retention-worker` unhealthy or no cleanup within 3 intervals
- Kalshi circuit breaker open
- mapping issue count > 0
- NBM, HRRR, NWS, or METAR freshness = stale/unavailable
- forecast rows or edge snapshots growing unexpectedly

## Restart Policy

Docker Compose uses:

```text
restart: unless-stopped
```

for all services, so containers restart after process failure or host restart unless intentionally stopped.

## Storage

Retention is enabled by default:

```text
RETENTION_CLEANUP_ENABLED=true
RETENTION_WORKER_INTERVAL_SECONDS=3600
GRIB_CACHE_RETENTION_HOURS=24
```

Inspect local Docker storage:

```bash
docker system df
docker system df -v
```

Run one cleanup manually:

```bash
docker compose run --rm retention-worker npm run retention:cleanup
```
