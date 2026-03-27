# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Full-stack dashboard that scrapes fitness studio data from DeportNet.com using Playwright and visualizes it in a React UI. Data flows via Server-Sent Events (SSE): backend scrapes live → streams progress/results → frontend updates incrementally.

## Running the App

Two terminals required:

```bash
# Terminal 1 - Backend (port 4000)
cd backend && npm run dev

# Terminal 2 - Frontend (port 5173)
cd frontend && npm run dev
```

Health check: `curl http://localhost:4000/api/ping`

Debug occupation scraping in isolation:
```bash
cd backend && npm run debug:ocupacion
```

## Frontend Commands

```bash
cd frontend
npm run dev      # dev server
npm run build    # production build
npm run lint     # ESLint
npm run preview  # preview production build
```

## Architecture

```
Frontend (React/Vite :5173)
  └── SSE fetch with AbortController → /api/report/*/stream
Backend (Express :4000)
  └── Validates params → Launches Playwright → Streams SSE events
Playwright
  └── Logs into DeportNet.com → Navigates → Scrapes DOM
Shared (JSON configs)
  └── locales.json, horarios-sedes.json, precios-sedes-planes-activos.json, etc.
```

## Backend Structure

- `backend/src/index.js` — All 6 Express SSE endpoints
- `backend/src/deportnetClient.js` — Playwright browser launch/teardown
- `backend/src/deportnetClientFacade.js` — Exports all report functions
- `backend/src/deportnet/deportnetActions.js` — Login, navigation, clicks
- `backend/src/deportnet/deportnetReaders.js` — DOM scraping, data extraction
- `backend/src/deportnet/reports/` — One file per report type

SSE event protocol per endpoint:
1. `progress` events: `{ processed, total, sede }` during scraping
2. `result` events: report data chunks
3. `done` or `error` event: stream termination

Heartbeat (comment line `:\n\n`) sent every 20s to prevent proxy timeouts during long scrapes.

## Frontend Structure

- `frontend/src/App.jsx` — Tab navigation, all state, SSE orchestration
- `frontend/src/constants/reportDefs.js` — Report metadata and API URL builder
- `frontend/src/utils/consumeSseStream.js` — Reusable SSE stream consumer
- `frontend/src/components/reports/` — One component per report visualization

## Reports

| Report | Endpoint | Notes |
|--------|----------|-------|
| Cobros quincenal | `/api/report/quincenal/stream` | Billing by location |
| Precios sedes | `/api/report/precios-sedes/stream` | Pricing matrix |
| Socios activos | `/api/report/socios-activos/stream` | Member counts |
| Cobros comparativo | `/api/report/cobros-sede-comparativo/stream` | Historical comparison |
| Conversión clase prueba | `/api/report/conversion-clase-prueba/stream` | Trial→paid conversion |
| Ocupación clases | `/api/report/ocupacion/stream` | Class occupancy matrix; max 15 days, one sede per run |

## Shared Data

`shared/` holds config used by both frontend and backend:
- `locales.json` — 9 branch names
- `horarios-sedes.json` — Schedule templates per sede
- `precios-sedes-planes-activos.json` — Active pricing plans
- `clase-prueba-patterns.json` — Trial class name patterns
- `ocupacionPlantilla.cjs` — Occupation matrix builder (CommonJS)

## Backend Environment

`backend/.env` (required):
```
DEPORNET_USER=...
DEPORNET_PASS=...
PORT=4000
```

## Key Technical Decisions

- **SSE over WebSocket**: Frontend uses `fetch` + `AbortController` (not `EventSource`) for compatibility with Vite's proxy.
- **Sequential per-sede scraping**: DeportNet has no public API; each sede requires a separate Playwright login/navigation cycle.
- **Shared JSON configs**: No database; location list and templates are static JSON files read at runtime.
- **Debug artifacts**: `backend/debug/` stores timestamped `.png` screenshots and `.txt` logs from occupation scrapes for troubleshooting.

## GitHub Actions

`.github/workflows/daily-reports.yml` — automated daily report generation workflow.
