# Codex Start Prompt - Tailored Outfit Platform

Copy everything below the line into Codex while it is opened in a new, empty project folder. Attach `tailored_outfit_platform_implementation_blueprint.pdf` to the same Codex conversation if file attachments are available.

---

You are the primary implementation engineer for a local-first full-stack application called **Tailored Outfit Platform**.

The attached `tailored_outfit_platform_implementation_blueprint.pdf` is the product and architecture specification. Read it completely before modifying files. This prompt defines the implementation order and the scope of the first coding pass. If this prompt and the PDF appear to conflict, follow the narrower safety boundary and report the conflict.

## Objective

Build a working local application that:

1. Lets an adult select a shirt as the first supported garment.
2. Collects the eight required shirt measurements.
3. Accepts centimetres or inches and normalizes values to integer millimetres.
4. Collects basic style preferences.
5. Validates the submission in FastAPI.
6. Produces one deterministic, explainable shirt recommendation.
7. Persists the participant, consent, measurement session, measurement attempts and recommendation snapshot in local PostgreSQL.
8. Runs completely locally with no hosting, cloud service, external API or GPU requirement.

This is the first vertical slice. Design the code so trousers, T-shirts, guardian consent, 100,000 synthetic participants and the remaining blueprint phases can be added without rewriting the foundation.

## Locked technology choices

- Frontend: React with JavaScript, Vite, React Router, React Hook Form and TanStack Query.
- Backend: Python 3.11+, FastAPI, Pydantic Settings, SQLAlchemy 2 and Psycopg 3.
- Database: local PostgreSQL.
- Migrations: Alembic.
- Backend tests: Pytest and HTTPX.
- Frontend tests: Vitest, jsdom and React Testing Library.
- Styling: plain CSS or CSS Modules.
- Identifiers: UUIDs.
- Normalized measurement unit: integer millimetres.
- Recommendation logic: deterministic, versioned Python rules. No LLM and no machine learning.

Do not replace PostgreSQL with MongoDB. Do not introduce Redux, Zustand, Docker, Redis, Celery, Kafka, a vector database, microservices or a second database.

## Environment and workspace rules

- Work inside the current workspace. Do not create an unnecessary nested repository if the selected workspace is already the project root.
- Inspect the workspace and any existing `AGENTS.md` before editing.
- Preserve existing user files and unrelated changes.
- Check `node --version`, `npm --version`, `python3 --version`, `git --version` and `psql --version` before scaffolding.
- Current Vite requires a supported modern Node version. If the installed version is unsupported, report the exact mismatch before continuing with frontend installation.
- Do not install Fedora system packages or use `sudo` without explicit permission.
- If PostgreSQL is not installed or not running, still create the database configuration, migrations and setup instructions, but do not pretend integration tests passed. Tell me the exact Fedora commands I need to run.
- Use a Python virtual environment inside `backend/.venv`.
- Keep secrets in `.env`; commit only `.env.example` with placeholders.
- Do not deploy, host, containerize or configure production infrastructure.
- Do not commit or push Git changes unless I explicitly request it.

## Required repository structure

Create this structure, adapting only when a tool-generated file requires it:

```text
tailored-outfit/
|-- README.md
|-- Makefile
|-- .gitignore
|-- frontend/
|   |-- src/
|   |   |-- api/
|   |   |-- components/
|   |   |-- pages/
|   |   |-- features/
|   |   |   |-- consent/
|   |   |   |-- measurements/
|   |   |   `-- recommendations/
|   |   |-- App.jsx
|   |   `-- main.jsx
|   |-- vite.config.js
|   `-- package.json
`-- backend/
    |-- app/
    |   |-- api/
    |   |-- core/
    |   |-- models/
    |   |-- repositories/
    |   |-- schemas/
    |   |-- services/
    |   |-- data/
    |   `-- main.py
    |-- alembic/
    |-- scripts/
    |-- tests/
    |-- alembic.ini
    |-- requirements.txt
    `-- .env.example
```

Use imports and package names that work when commands are run from the directories documented in `README.md`.

## Data model required in the first vertical slice

Implement SQLAlchemy models and an initial Alembic migration for:

### participants

- `id`: UUID primary key
- `public_code`: random, unique, non-identifying code
- `status`: active, withdrawn or deleted
- `created_at`
- `updated_at`

Do not collect a name, phone number, email, precise address or date of birth.

### consent_records

- `id`: UUID primary key
- `participant_id`: foreign key
- `consent_version`
- `purpose`
- `granted`
- `granted_at`
- `withdrawn_at`, nullable

For this slice, support the purpose `generate_outfit_recommendation`. Keep the schema ready for separate optional research consent later.

### measurement_sessions

- `id`: UUID primary key
- `participant_id`: foreign key
- `age_months_at_measurement`
- `garment_categories`
- `measurement_method`
- `unit_entered`
- `protocol_version`
- `measurement_schema_version`
- `status`: draft, submitted, validated, accepted or flagged
- `quality_score`, nullable initially
- timestamps

### measurement_values

- `id`: UUID primary key
- `session_id`: foreign key
- `measurement_code`
- `value_mm`: integer
- `attempt_number`: integer
- `confidence`, nullable
- `validation_status`
- `created_at`

Add a unique constraint on `(session_id, measurement_code, attempt_number)`.

### recommendation_runs

- `id`: UUID primary key
- `session_id`: foreign key
- `rules_version`
- `catalog_version`
- `measurement_schema_version`
- `input_snapshot`: JSON/JSONB
- `result_snapshot`: JSON/JSONB
- `score_breakdown`: JSON/JSONB
- `created_at`

Use explicit foreign-key deletion behavior. Do not add broad cascading deletes without tests proving the intended data-rights behavior.

## Shirt measurement schema

Create one versioned backend-owned measurement-definition source. The frontend must render its fields from the API instead of duplicating the field definitions.

Required shirt fields:

- `neck_circumference`
- `chest_circumference`
- `waist_circumference`
- `hip_circumference`
- `shoulder_width`
- `sleeve_length`
- `armhole_depth`
- `shirt_length`

Each definition must contain:

- stable code
- label
- measurement kind
- instruction
- garments requiring it
- whether repetition is required
- broad development-only minimum and maximum warnings
- measurement schema version

Do not present the broad development ranges as medically or scientifically validated. Keep all ranges configurable.

## Validation rules

Implement three levels:

1. **Error**: required value missing, non-numeric, zero, negative, NaN, infinity, unsupported code or invalid unit.
2. **Warning**: unusual but potentially possible value or inconsistent relationship.
3. **Information**: optional measurement could improve precision.

Do not reject someone merely because their proportions differ from an expected body type.

Important measurements should support two attempts. Store both attempts. If their difference exceeds a configurable tolerance, return a warning requesting a third attempt. Do not overwrite earlier attempts.

## Fit and recommendation rules

Create versioned seed data for at least three shirt templates:

- classic cotton Oxford shirt
- breathable linen shirt
- relaxed overshirt

Each template should contain style, occasion, climate, fabric, colour and fit tags.

Create configurable development ease profiles for slim, regular and relaxed fits. Clearly label the values as provisional and requiring review by a qualified tailor or apparel-pattern specialist.

Use:

```text
finished_measurement_mm = body_measurement_mm + ease_allowance_mm
```

Rank deterministically using:

- occasion: maximum 30 points
- climate and fabric: maximum 20 points
- fit: maximum 20 points
- style: maximum 15 points
- colour: maximum 15 points

Break ties by total score descending, exact-match count descending and garment ID ascending. Return the best result for this first slice while keeping the response compatible with returning the top three later.

Every result must include:

- garment template
- total score
- score breakdown
- human-readable reasons
- warnings
- normalized body measurements
- target finished-garment measurements
- rules, catalog and schema versions

## First-slice API contract

Implement:

```text
GET  /health
GET  /api/v1/measurement-schema?garments=shirt
GET  /api/v1/catalog?category=shirt
POST /api/v1/consents/start
POST /api/v1/participants
POST /api/v1/measurement-sessions
POST /api/v1/measurement-sessions/{id}/measurements
POST /api/v1/measurement-sessions/{id}/validate
POST /api/v1/measurement-sessions/{id}/submit
POST /api/v1/recommendations
GET  /api/v1/recommendations/{id}
```

Use a stable `/api/v1` prefix and structured error responses with stable error codes. Require an `Idempotency-Key` for final submission and recommendation creation. Enforce idempotency with a database uniqueness constraint, not only frontend button disabling.

Keep route handlers thin. Put conversion, validation, consent, fit calculation and recommendation logic in separate services.

## React flow for the first slice

Implement these pages:

1. Introduction
2. Adult consent
3. Shirt measurement wizard
4. Style preferences
5. Submission review
6. Recommendation result

The measurement wizard must:

- fetch definitions from `/api/v1/measurement-schema`
- show instructions for each measurement
- accept cm or inches
- retain values when navigating backward
- display field-level backend errors beside the correct field
- support keyboard navigation and visible focus
- work at mobile and desktop widths
- show loading, empty and recoverable error states

Configure Vite to proxy `/api` and `/health` to `http://127.0.0.1:8000`. Frontend code must call relative API paths rather than hard-coded backend URLs.

## Tests required before calling the slice complete

Backend:

- health endpoint
- measurement-schema response
- cm-to-mm and inch-to-mm conversion
- missing and invalid measurement values
- unknown measurement code rejection
- repeat-attempt tolerance
- database uniqueness constraints
- transaction rollback
- idempotent submit and recommendation creation
- deterministic score calculation and tie-breaking
- recommendation snapshot persistence
- API happy path from participant creation to recommendation retrieval

Frontend:

- shirt selection renders the correct eight fields
- unit switching preserves the physical value
- back navigation preserves form state
- backend field errors render beside their inputs
- valid form reaches the result screen
- result displays score, reasons, warnings and finished measurements

Create one fixed acceptance fixture. For a fixed participant session, catalog version and rules version, the expected recommendation and score must be exact.

## Documentation required

Update `README.md` with:

- prerequisites and checked versions
- Fedora PostgreSQL setup commands, without running them automatically
- database/user creation steps
- `.env` setup
- Alembic migration command
- backend start command
- frontend start command
- test commands
- seed command
- troubleshooting for PostgreSQL connection failure and occupied ports
- an explicit statement that ease values are provisional and the child flow is not yet approved for real data

Add Makefile targets for at least:

```text
install-backend
install-frontend
migrate
seed
run-backend
run-frontend
test-backend
test-frontend
test
```

## Work method

1. Inspect the workspace and tools.
2. Write a short implementation plan with verifiable checkpoints.
3. Scaffold the smallest end-to-end structure.
4. Implement database models and migrations.
5. Implement and test backend services before connecting the full UI.
6. Implement the React flow against the real API contract.
7. Run backend and frontend tests.
8. Run the application locally if PostgreSQL is available.
9. Fix failures rather than weakening or deleting tests.
10. Review changed files for leaked secrets, hard-coded local paths, duplicated schemas and unhandled errors.

Do not claim completion when a required command was not executed. If a system dependency blocks execution, finish all safely possible code, clearly identify what remains unverified, and provide the exact next command.

## Completion response

At the end, report:

- what was implemented
- important architectural decisions
- files created or changed
- commands executed
- tests passed and tests not run
- known limitations
- exact local startup steps
- the next recommended phase

Stop after this tested adult-shirt vertical slice. Do not begin real child-data collection, hosting, deployment, camera measurement, virtual try-on, machine learning or the full 100,000-record synthetic load in this first pass.

---

## Continuation prompt after the first slice passes

Use this only after Codex reports that the adult-shirt vertical slice is working:

```text
Continue the Tailored Outfit Platform using the attached implementation blueprint and the existing repository state. Inspect the current code and test results first. Implement the next incomplete roadmap phase only, preserve all passing behavior, add tests before declaring it complete, and do not introduce hosting, Docker, cloud services, machine learning or real child-data collection. At the end, report the exact phase completed, commands run, test results, limitations and next phase.
```
