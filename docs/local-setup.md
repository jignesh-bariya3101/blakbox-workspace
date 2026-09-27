# Local setup

Works on Windows, macOS, and Linux. Folder names are `server` and `client` on every OS. Use `127.0.0.1` in the browser, not `localhost` or `::1`.

## A. Docker (recommended after clone)

You need Docker Desktop or Docker Engine with Compose v2. You do **not** copy `.env` files for this path.

### 1. Open a terminal in the repo root

The folder that contains `docker-compose.yml`.

### 2. Start everything

```bash
docker compose up --build
```

Wait until the `backend` and `frontend` services are healthy (first start can take a few minutes).

What this does for you:

1. Starts PostgreSQL and keeps data in the `postgres_data` volume
2. Starts MinIO and keeps files in the `minio_data` volume
3. Creates the private `blakbox` bucket
4. Runs `prisma migrate deploy` (all migrations) then starts the API
5. Serves the UI on nginx

The browser calls **`http://127.0.0.1:3000`** (the real API). There is no API proxy.

### 3. Open the app

In the browser go to:

**http://127.0.0.1:8080**

Use `127.0.0.1` for the page (not `localhost`) so the session cookie matches the API host.

Register a new account. There is no seed user.

### 4. Useful URLs

| What | URL |
|---|---|
| UI | http://127.0.0.1:8080 |
| API | http://127.0.0.1:3000 |
| API health | http://127.0.0.1:3000/health |
| Postgres (host tools) | `127.0.0.1:5433` user `postgres` / password `postgres` / db `blakbox_dev` |
| MinIO API | http://127.0.0.1:9000 |
| MinIO console | http://127.0.0.1:9001 (`minioadmin` / `minioadmin`) |

### 5. Stop (keep database and files)

```bash
docker compose down
```

Named volumes stay. Start again with `docker compose up --build`.

### 6. Backup Postgres

```bash
docker compose exec postgres pg_dump -U postgres blakbox_dev > blakbox-backup.sql
```

Restore later:

```bash
docker compose exec -T postgres psql -U postgres blakbox_dev < blakbox-backup.sql
```

### 7. Wipe everything (including volumes)

```bash
docker compose down -v
```

That deletes the Postgres and MinIO volumes.

### Env vars (Docker)

All API variables are in **`docker/backend.env`**. Compose loads that file. You do not create `server/.env` for Docker.

The UI API URL is a **build argument**: `VITE_API_BASE_URL=http://127.0.0.1:3000` in `docker-compose.yml`. After you change it, rebuild:

```bash
docker compose up --build
```

---

## B. Without Docker

1. Install Node.js 22 and Postgres 17. Create database `blakbox_dev`.
2. From the repo root (works in cmd, PowerShell, and bash):

```bash
node scripts/copy-env.mjs
```

3. Edit `server/.env` if your Postgres is not `postgres` / `postgres` on port `5432`. If Postgres is the Compose service, use port `5433`.
4. In one terminal:

```bash
cd server
npm ci
npx prisma migrate deploy
npm run dev
```

5. In a second terminal:

```bash
cd client
npm ci
npm run dev
```

6. Open http://127.0.0.1:5173

`.env.example` uses `STORAGE_DRIVER=memory`, so MinIO is optional on this path.

---

## Tests

```bash
node scripts/copy-env.mjs
cd server
npx prisma migrate deploy
npm test
```

```bash
cd client
npm test
```

API tests need a reachable Postgres URL in `server/.env`. If that Postgres is Compose, use port **5433**.

UI end-to-end (API on :3000 and Vite on :5173):

```bash
cd client
npm run test:e2e
```
