# Worker Dispatch System

A simple booking & dispatch tool. A manager assigns workers to job sites and
tracks each worker's live status; workers open it on their phones to confirm
and update their progress. Runs locally on your PC or deploys to Vercel.

## Requirements
- [Node.js](https://nodejs.org) 18 or newer.

## Run locally
```bash
npm install
npm start
```
Then open:
- **Manager app:** http://localhost:3000  (default password: `admin`)
- **Worker app:** http://localhost:3000/worker  (sign in with a PIN, e.g. `1001`)

Locally, data is stored in a `data.json` file (created on first run) and the
default password is `admin` — fine for a LAN tool. **Both of these change for
production**, see below.

## Deploy to Vercel
Vercel runs the app as stateless serverless functions with a read-only
filesystem, so the file-based storage and in-memory sessions used locally won't
work there. Instead it uses **Upstash Redis** for both data and login sessions.

1. **Create a Redis store.** In the Vercel dashboard → *Storage* → add the
   **Upstash** (Redis) integration to the project. This injects
   `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` automatically.
   (Vercel KV's `KV_REST_API_URL` / `KV_REST_API_TOKEN` also work.)
2. **Set the manager password.** Project → *Settings* → *Environment Variables*
   → add `MANAGER_PASSWORD` (required — without it, manager login is disabled in
   production). Optionally add `BUSINESS_NAME` and the Twilio variables.
3. **Deploy.** Push the repo and import it in Vercel, or run `vercel`. No build
   step is needed; `vercel.json` routes everything to the Express app.

See [`.env.example`](.env.example) for the full list of variables. The first
request seeds the Redis store with sample data; clear the `dispatch:data` key in
Upstash to reset.

### Letting workers use it on their phones
Both phones and PC must be on the **same WiFi**. Find your PC's local IP
(`ipconfig` on Windows → look for *IPv4 Address*, e.g. `192.168.1.20`), then
workers open `http://192.168.1.20:3000/worker` in their phone browser.

## How it works
- **Workers** — name, role, phone, availability (available / unavailable) and a
  login PIN.
- **Sites** — name, address, optional map coordinates, how many workers are
  needed, and a status (active / on hold / completed).
- **Bookings** — assign a worker to a site for a date. Each booking moves through:

  `Pending → Assigned → En route → On-site → Checked-out → Completed`

  The manager can set any status from the board; workers advance their own job
  step-by-step from their phone. Check-in / check-out times are recorded and
  feed the **Reports** page (hours per worker, coverage per site).

## Screens
| Manager | Worker |
|---------|--------|
| Board, Week, Map, Bookings, Workers, Sites, Reports | Today's jobs with one-tap status buttons |

## Notifying workers
When you create a booking (or from the Board / Bookings list), you can notify the
worker:
- **WhatsApp (free, no setup):** click **Notify** — it opens WhatsApp with a
  ready-to-send message containing the site, address, date and time. Requires the
  worker to have a phone number.
- **Automatic SMS (optional):** set the `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`
  and `TWILIO_FROM` environment variables (locally in `.env`, or in the Vercel
  dashboard). Once set, an SMS is sent automatically whenever a booking is
  created. Leave them blank to stay on the free WhatsApp links.

## Week view
The **Week** tab shows a 7-day Mon–Sun grid of all bookings (worker → site, with
status). Navigate weeks with Prev / Next, and click **+ add** on any day to create
a booking for that date.

## Maps
The **Map** tab uses real OpenStreetMap street maps (via Leaflet) when you're
online — markers show how many workers are on-site, click one for details. With no
internet, it automatically falls back to an offline coordinate plot. Add lat/lng to
a site to place it on the map.

## Data & config
- **Locally:** all data is stored in `data.json` (created on first run with
  sample data). Delete it to reset to a clean state. The manager password is
  `admin` unless you set the `MANAGER_PASSWORD` environment variable.
- **On Vercel:** data lives in Upstash Redis and the password comes from the
  `MANAGER_PASSWORD` env var. `data.json` is git-ignored and never deployed.
- Secrets (manager password, Twilio keys) are read from environment variables
  in production — never commit them.

## Notes
- The map view plots sites by their coordinates and works fully offline. If you
  have internet and want real street maps, the map module can be swapped for a
  Leaflet/OpenStreetMap view later.
# schedule-system
