# Kanban & Todo (with authentication)

A self-hosted Kanban board + todo list with **username/password authentication**
and **per-user, SQLite-backed persistence**.

## Features

- Kanban boards (cards, columns, drag-and-drop) and a todo list with subtasks
- Halliburton brand color palette (light & dark themes)
- SVG icons instead of emojis
- **Per-user accounts**: everyone sees only their own boards/todos
- SQLite persistence via a mounted volume — data survives restarts/rebuilds
- Sessions via httpOnly cookies; passwords hashed with bcrypt
- No native build step: uses Node's built-in `node:sqlite`, so image builds
  are fast and don't compile anything

## Architecture

```
Browser ──HTTP──▶ Node/Express server (:8080)
                     │
                     ├── serves static frontend (index.html, script.js, styles.css)
                     └── /api/* endpoints
                            ├─ auth (register/login/logout/me)
                            └─ per-user state (get/save)
                                 └── node:sqlite ──▶ /data/canban.db (volume)
```

## Running locally (without a container)

> **Requires Node ≥ 22** — the server uses the built-in `node:sqlite` module.
> There is no native dependency to compile anymore, so `npm install` is quick.

```bash
cd server
npm install
node server.js          # serve on http://localhost:8080
```

Open http://localhost:8080, then **Sign Up** to create an account and start using it.

## Deploying with Podman

Build and run with a named volume so your data persists:

```bash
# build (Node 22 base — no native addon compilation)
podman build -t canban .

# run with a persistent volume
podman run -d \
  --name canban \
  -p 8080:8080 \
  -v canban-data:/data \
  canban
```

Or use the included Compose file:

```bash
podman-compose up -d
```

Point your browser at http://localhost:8080.

### Notes

- The SQLite database is written to **`/data/canban.db`** (`CANBAN_DB_PATH`).
  Mount a **named volume** there for persistence across restarts and rebuilds.
- Anonymous / unauthenticated requests to `/api/state` are rejected (401).
- Node prints an `ExperimentalWarning: SQLite is an experimental feature`
  line at startup. It is harmless; `node:sqlite` is stable in Node 24 and
  onward. Suppress it with `NODE_OPTIONS=--no-warnings` if you prefer.
- For production over **HTTPS**, set the env `COOKIE_SECURE=1` so session
  cookies are marked `Secure`:
  ```bash
  podman run -d --name canban -p 8080:8080 -e COOKIE_SECURE=1 -v canban-data:/data canban
  ```

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | HTTP listen port |
| `CANBAN_DB_PATH` | `/data/canban.db` | Path to the SQLite file |
| `COOKIE_SECURE` | unset | Set to `1` to mark session cookies `Secure` (production HTTPS) |
