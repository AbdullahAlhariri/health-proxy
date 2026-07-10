# HC Webhook Client

Self-hosted receiver for the [HC Webhook](https://github.com/mcnaveen/health-connect-webhook)
Android app. Astro (SSR, Node adapter) + MongoDB + Mongoose, fully dockerized.

Your Galaxy Watch → Samsung Health → Health Connect → HC Webhook app → **this**.

## Quick start

```bash
cp .env.example .env        # then set a real WEBHOOK_SECRET
docker compose up -d --build
```

- Dashboard: `http://<host>:4321/`
- Webhook endpoint: `POST http://<host>:4321/api/webhooks/health-connect`
- Query API: `GET http://<host>:4321/api/sleep?date=yesterday`

MongoDB is intentionally **not** exposed on the host — only the app container
reaches it over the compose network. Data persists in the `mongo-data` volume.

## Configure the HC Webhook app

1. In Samsung Health, enable syncing to **Health Connect** (sleep permission).
2. In HC Webhook: enable the **Sleep** data type and grant its Health Connect
   permission.
3. Add a webhook URL: `https://your-domain/api/webhooks/health-connect`
4. Add a **custom header** on that URL:
   `X-Webhook-Secret: <the value from your .env>`
   (the app has no built-in auth — this header is the auth)
5. Pick a sync schedule, tap **Sync Now** to test.

Put nginx + certbot in front for TLS in production; proxy to port 4321.

## API

### Sleep

`GET /api/sleep?date=yesterday` — "the night of *date*" means any session that
**ends** on that calendar day in `TIMEZONE` (i.e. the sleep you woke up from):

```json
{
  "date": "2026-07-08",
  "timezone": "Europe/Amsterdam",
  "sessions": [
    {
      "sleptFrom": "2026-07-07T22:41:00.000Z",
      "sleptUntil": "2026-07-08T05:12:00.000Z",
      "localFrom": "00:41",
      "localUntil": "07:12",
      "durationSeconds": 23460,
      "durationPretty": "6h 31m",
      "stageTotals": { "LIGHT": 14200, "DEEP": 5400, "REM": 3100, "AWAKE": 760 },
      "stages": [ ... ]
    }
  ]
}
```

Also accepts `?date=today`, `?date=YYYY-MM-DD`, or no param (last 14 sessions).

### Other metrics

```
GET /api/metrics/steps?date=yesterday       # intervals + totalCount
GET /api/metrics/distance?date=yesterday    # intervals + totalMeters
GET /api/metrics/heart_rate?date=today      # samples + min/avg/max bpm
GET /api/metrics/exercise?date=yesterday    # sessions with mapped typeName
```

Same `date` semantics; without `?date` you get the most recent records.

## Design notes

- **Idempotent ingest.** HC Webhook retries failed deliveries and re-sends full
  windows in explicit-range mode, so sleep sessions are **upserted** on
  `session_end_time` (unique per session), never blindly inserted.
- **Derived start time.** The payload's `sleep` records carry only
  `session_end_time` + `duration_seconds`; `sessionStartTime` is computed on
  ingest (`end − duration`).
- **Raw archive.** Every delivery is stored verbatim in `raw_payloads`
  (TTL: 90 days) so ingest bugs can be replayed. Other data types you enable
  in the app (steps, heart rate, …) land there automatically even before you
  model them.
- **Numeric Health Connect codes are mapped on ingest.** Real payloads deliver
  sleep stages ("4" = LIGHT, "5" = DEEP, "6" = REM, "1" = AWAKE) and exercise
  types ("8" = BIKING, "79" = WALKING) as numeric strings; both the raw code
  and a readable name are stored. Unknown exercise codes become `TYPE_<code>`.
- **Rolling buckets for steps/distance.** These arrive as local-day intervals
  where the newest bucket is partial and keeps growing, so they upsert on
  `start_time` and each sync overwrites the bucket with the latest snapshot.
- **Heart rate at scale.** Deliveries can contain 1000+ samples; they are
  ingested with a single unordered `bulkWrite` of upserts keyed on sample time.
- **Record `metadata`** (data origin app, recording method, device) is present
  in real payloads though undocumented — it is captured on every record type.
- **Timestamps are UTC** in Health Connect; conversion to `TIMEZONE` happens
  at query/render time only.

## Local development

```bash
npm install
docker compose up -d mongo   # or point MONGODB_URI at any Mongo
MONGODB_URI=mongodb://localhost:27017/healthdata WEBHOOK_SECRET=dev npm run dev
```

Note: the compose file doesn't map Mongo to the host, so for local dev either
add a `ports: ["27017:27017"]` mapping temporarily or run Mongo separately.

Test a delivery:

```bash
curl -X POST localhost:4321/api/webhooks/health-connect \
  -H 'Content-Type: application/json' \
  -H 'X-Webhook-Secret: dev' \
  -d '{
    "timestamp": "2026-07-08T06:00:00Z",
    "app_version": "1.0",
    "sleep": [{
      "session_end_time": "2026-07-08T05:12:00Z",
      "duration_seconds": 23460,
      "stages": [
        {"stage":"LIGHT","start_time":"2026-07-07T22:41:00Z","end_time":"2026-07-08T01:00:00Z","duration_seconds":8340},
        {"stage":"DEEP","start_time":"2026-07-08T01:00:00Z","end_time":"2026-07-08T02:30:00Z","duration_seconds":5400},
        {"stage":"REM","start_time":"2026-07-08T02:30:00Z","end_time":"2026-07-08T03:22:00Z","duration_seconds":3120},
        {"stage":"LIGHT","start_time":"2026-07-08T03:22:00Z","end_time":"2026-07-08T05:12:00Z","duration_seconds":6600}
      ]
    }]
  }'
```
