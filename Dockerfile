FROM node:20-slim

WORKDIR /app

# ── Backend deps (incluyendo Playwright) ──────────────────────────────────────
COPY backend/package*.json ./backend/
RUN cd backend && npm ci
# Instala Chromium y sus dependencias de sistema (versión determinada por package.json)
RUN cd backend && npx playwright install chromium --with-deps

# ── Frontend deps + build ─────────────────────────────────────────────────────
COPY shared ./shared
COPY frontend/package*.json ./frontend/
RUN cd frontend && npm ci

COPY frontend ./frontend
RUN cd frontend && npm run build

# ── Backend source ─────────────────────────────────────────────────────────────
COPY backend ./backend

ENV NODE_ENV=production

EXPOSE 4000

CMD ["node", "backend/src/index.js"]
