# Backend

FastAPI backend for Genui Chat. Serves a streaming agent that queries `db.csv` and exposes generative UI tools (pie chart, flight card).

## Setup

Ensure `OPENAI_API_KEY` is set (e.g. in the repo root `.env`, which is auto-loaded).

```bash
pip install -r requirements.txt
```

## Running

```bash
cd backend
python server.py
```

Runs on **port 8003** by default.
