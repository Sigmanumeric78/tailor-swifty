.PHONY: install-backend install-frontend migrate seed run-backend run-frontend test-backend test-frontend test

install-backend:
	python3 -m venv backend/.venv
	backend/.venv/bin/python -m pip install --upgrade pip
	backend/.venv/bin/pip install -r backend/requirements.txt

install-frontend:
	cd frontend && npm install --no-audit --no-fund

migrate:
	cd backend && .venv/bin/alembic upgrade head

seed:
	cd backend && .venv/bin/python -m scripts.seed

run-backend:
	cd backend && .venv/bin/uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

run-frontend:
	cd frontend && npm run dev

test-backend:
	cd backend && .venv/bin/pytest -q

test-frontend:
	cd frontend && npm test -- --run

test: test-backend test-frontend
