# Kanban & Todo (with authentication)

A self-hosted Kanban board + todo list with **username/password authentication**
and **per-user, SQLite-backed persistence**.

## Features

- Kanban boards (cards, columns, drag-and-drop) and a todo list with subtasks
- Halliburton brand color palette (light & dark themes)
- SVG icons instead of emojis
- **Per-user accounts**: everyone sees only their own boards/todos
- **SQLite persistence** via a mounted volume — data survives restarts/rebuilds
- Sessions via httpOnly cookies; passwords hashed with bcrypt

## Architecture

```
Browser ──HTTP──▶ Node/Express server (:8080)
                     │
                     ├── serves static frontend (index.html, script.js, styles.css)
                     └── /api/* endpoints
                            ├─ auth (register/login/logout/me)
                            └─ per-user state (get/save)
                                 └── better-sqlite3 ──▶ /data/canban.db (volume)
```

## Running locally (without a container)

> **Note:** runs best on Node ≥ 20. On Node 26 `better-sqlite3` may need a
> compatible version; the Podman image fixes this by pinning Node 20.

```bash
cd server
npm install
node server.js          # serve on http://localhost:8080
```

Open http://localhost:8080, then **Sign Up** to create an account and start using it.

## Deploying with Podman

Build and run with a named volume so your data persists:

```bash
# build (installs deps on Node 20 where better-sqlite3 compiles cleanly)
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
