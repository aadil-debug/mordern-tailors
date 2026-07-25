# Modern Tailors

A custom tailoring business website for Modern Tailors, Santacruz East, Mumbai. Serves a pre-built static frontend from `dist/` via a lightweight Node.js server, with a built-in admin dashboard for managing gallery images, offers, and content.

## Stack

- **Runtime:** Node.js (ESM, no build step needed — frontend is pre-built in `dist/`)
- **Server:** `server.js` — plain `http` module, no frameworks
- **Data storage:** JSON files in `data/` (flat-file DB)
- **Frontend:** Pre-built Vite/React bundle in `dist/`

## How to run

The workflow `Start application` runs `node server.js`, which starts the server on port 5000.

## Environment variables

| Variable | Description | Default |
|---|---|---|
| `ADMIN_PASSWORD` | Password for the admin dashboard | `fazal1234` |
| `PORT` | Port to listen on | `5000` |

Set `ADMIN_PASSWORD` as a secret (never commit it). See `.env.example` for reference.

## Admin dashboard

Visit `/admin` to access the admin panel. Log in with the `ADMIN_PASSWORD`. From there you can:
- Manage gallery images (upload, reorder, delete, add)
- Edit offer banner text and colours
- Update item labels and categories
- Use AI image regeneration (via Pollinations.ai — no API key required)

## User preferences

- Keep the existing project structure and stack — do not migrate or restructure unless explicitly asked.
