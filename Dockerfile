# --- Oberfläche bauen ---
FROM node:26-bookworm-slim AS web
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npx vite build

# --- Server bauen (better-sqlite3 für die Actual-API wird hier kompiliert) ---
FROM node:26-bookworm AS server
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --no-audit --no-fund
COPY server/ ./
RUN npx tsc -p . && npm prune --omit=dev

# --- Laufzeit ---
FROM node:26-bookworm-slim
# Sprachen für Tesseract (Debian-Pakete tesseract-ocr-<code>), z. B. --build-arg TESSERACT_SPRACHEN="deu eng fra"
ARG TESSERACT_SPRACHEN="deu eng"
# poppler: PDF -> Bild/Text, libheif: iPhone-Fotos (HEIC), tesseract: Texterkennung ohne KI-Bildmodell,
# postgresql-client-17 (aus dem PostgreSQL-Repository): pg_dump für Backups, passend zum Postgres-17-Server
RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql-common ca-certificates \
 && /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y \
 && apt-get install -y --no-install-recommends \
      postgresql-client-17 poppler-utils libheif-examples tini tesseract-ocr \
      $(for s in $TESSERACT_SPRACHEN; do printf "tesseract-ocr-%s " "$s"; done) \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app/server
COPY --from=server /app/server/node_modules ./node_modules
COPY --from=server /app/server/dist ./dist
COPY --from=server /app/server/migrations ./migrations
COPY --from=server /app/server/sprachen ./sprachen
COPY --from=server /app/server/package.json ./
COPY --from=web /app/web/dist /app/web
COPY LICENSE THIRD_PARTY_LICENSES.md /app/

ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    WEB_DIR=/app/web
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD node -e "fetch('http://127.0.0.1:8080/api/gesundheit').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/index.js"]
