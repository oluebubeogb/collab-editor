# ---- build client ----
FROM node:22-bookworm AS client-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci --registry https://registry.npmjs.org/
COPY client/ ./
# Optional: bake public API/WS URLs at build time (same-origin → leave empty)
ARG VITE_API_URL=
ARG VITE_WS_URL=
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_WS_URL=$VITE_WS_URL
RUN npm run build

# ---- server (API + WS + static SPA) ----
FROM node:22-bookworm
WORKDIR /app

# better-sqlite3 and y-leveldb need native toolchain
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY server/package*.json ./server/
WORKDIR /app/server
RUN npm ci --omit=dev --registry https://registry.npmjs.org/

COPY server/ ./
COPY --from=client-build /app/client/dist /app/client/dist

ENV PORT=1234
ENV HOST=0.0.0.0
ENV DATA_DIR=/app/server/data
ENV SQLITE_PATH=/app/server/data/collab.db

EXPOSE 1234
VOLUME ["/app/server/data"]

CMD ["node", "index.js"]
