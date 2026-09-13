# ---- Build stage: install server deps ----
FROM node:20-alpine AS build
WORKDIR /app
COPY server/package.json server/package-lock.json* ./
RUN npm install

# ---- Runtime stage ----
FROM node:20-alpine
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080
ENV CANBAN_DB_PATH=/data/canban.db

# Copy the static frontend (project root: index.html, styles.css, script.js)
COPY index.html styles.css script.js /app/

# Copy the server and its installed dependencies
COPY server /app/server
COPY --from=build /app/node_modules /app/server/node_modules

# The SQLite DB is written to /data — mount a volume here for persistence.
RUN mkdir -p /data && chown -R node:node /data /app

USER node
EXPOSE 8080

WORKDIR /app/server
CMD ["node", "server.js"]
