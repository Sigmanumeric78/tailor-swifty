# Tailored Outfit Platform

A privacy-bounded adult shirt fitting workflow. The React application collects eight backend-defined measurements and style preferences; FastAPI validates and normalizes the data, then a versioned deterministic rule engine stores and returns one explainable recommendation. The experimental server-camera mode transmits one stripped, compressed photograph at a time to a separate stateless in-memory processor and persists only reviewed numeric results.

The manual workflow remains the primary validated product path. The camera workflow uses MediaPipe/OpenCV but has not been validated for measurement accuracy; see `docs/server-camera-processing.md`.

## Implemented scope

- Adult consent for the `generate_outfit_recommendation` purpose
- Random non-identifying participant codes protected by short-lived participant access tokens
- Backend-owned versioned shirt measurement schema
- Centimetre and inch input normalized to integer millimetres
- Repeat attempts, broad-range warnings, cross-field checks, and third-attempt warnings
- Three versioned shirt templates and slim, regular, and relaxed ease profiles
- Deterministic 100-point scoring with stable tie-breaking
- PostgreSQL models, constraints, idempotency keys, recommendation snapshots, and Alembic migration
- Six-screen responsive React flow with recoverable errors and print-friendly results

## Checked toolchain

The implementation was built with:

```text
Node.js 22.16.0
npm 10.9.4
Python 3.13.13
Git 2.54.0
Vite 7.3.6
```

Vite 7 requires Node.js 20.19+ or 22.12+. The checked Node.js version is supported. Python 3.11 or newer is required.

PostgreSQL and `psql` were not installed on the implementation machine, so PostgreSQL migration execution and the live browser-to-database journey remain unverified there. The migration was successfully compiled as PostgreSQL SQL; automated API tests use isolated SQLite only as a test dependency override.

## Fedora PostgreSQL setup

Run these commands yourself; the application does not install or start system packages automatically:

```bash
sudo dnf install postgresql-server postgresql-contrib
sudo postgresql-setup --initdb --unit postgresql
sudo systemctl enable --now postgresql
sudo -u postgres psql -c "CREATE USER tailor_app WITH PASSWORD 'choose_a_local_password';"
sudo -u postgres psql -c "CREATE DATABASE tailor_db OWNER tailor_app;"
```

Confirm the service and connection:

```bash
systemctl status postgresql
psql "postgresql://tailor_app:choose_a_local_password@localhost:5432/tailor_db" -c "select version();"
```

## Installation

From the project root:

```bash
make install-backend
make install-frontend
cp backend/.env.example backend/.env
```

Edit `backend/.env` so `DATABASE_URL` contains the password selected above. Percent-encode special URL characters in the password. The real `.env` is ignored by Git.

Apply the database schema and verify the versioned catalog configuration:

```bash
make migrate
make seed
```

The catalog and provisional ease values are versioned Python data rather than mutable database rows in this slice, so `make seed` validates and reports those configured records.

## Run locally

Use two terminals from the project root.

Terminal 1:

```bash
make run-backend
```

Terminal 2:

```bash
make run-frontend
```

Open `http://127.0.0.1:5173`. The Vite server proxies `/api` and `/health` to `http://127.0.0.1:8000`. FastAPI documentation is at `http://127.0.0.1:8000/docs`.

## Tests

```bash
make test-backend
make test-frontend
make test
```

Build the frontend production bundle with:

```bash
cd frontend
npm run build
```

Backend tests cover conversion, validation, unknown codes, repeat tolerance, database uniqueness and rollback, idempotency, deterministic ranking, snapshot persistence, and the complete API acceptance path. Frontend tests cover the eight dynamic fields, physical-value-safe unit switching, back-navigation state, field-level backend errors, result navigation, and result details.

## API

```text
GET  /health
GET  /api/v1/measurement-schema?garments=shirt
GET  /api/v1/catalog?category=shirt
POST /api/v1/participants
POST /api/v1/consents/start
POST /api/v1/camera-processing/session
POST /api/v1/measurement-sessions
POST /api/v1/measurement-sessions/{id}/measurements
POST /api/v1/measurement-sessions/{id}/validate
POST /api/v1/measurement-sessions/{id}/submit
POST /api/v1/recommendations
GET  /api/v1/recommendations/{id}
```

The separate processor Function URL exposes `POST /analyze` and `POST /finalize`. It requires short-lived signed sessions and intentionally has no image persistence or runtime S3 permission.

`POST /api/v1/participants` returns a 30-minute HMAC-signed participant access token. Every route that creates consent or operates on that participant's measurement sessions and recommendations requires it as `Authorization: Bearer <token>`. The token is bound to the participant UUID and remains only in React memory; it is never persisted or placed in a URL. A page refresh intentionally restarts the anonymous fitting session. Participant access, camera sessions, front observations, and side observations use distinct token-purpose values so they cannot substitute for one another.

Final submission and recommendation creation require an `Idempotency-Key` header. Keys are protected with database uniqueness constraints.

## Troubleshooting

**PostgreSQL connection refused**

```bash
systemctl status postgresql
sudo systemctl start postgresql
ss -ltn | grep 5432
```

Check that `backend/.env` uses the same database, user, password, host, and port created above. Run the direct `psql` connection command to distinguish credentials from application configuration.

**Port 8000 is occupied**

```bash
ss -ltnp | grep 8000
cd backend
.venv/bin/uvicorn app.main:app --reload --host 127.0.0.1 --port 8001
```

If the backend uses port 8001, update both proxy targets in `frontend/vite.config.js` for that run.

**Port 5173 is occupied**

```bash
cd frontend
npm run dev -- --port 5174
```

**Migration authentication failure**

Confirm that `backend/.env` exists, the password is URL-encoded, and the role can connect using the direct `psql` command. Alembic reads the same `DATABASE_URL` as FastAPI.
