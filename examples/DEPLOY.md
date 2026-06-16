# Deploying the interactive examples (per-visitor, real server)

The example apps (commerce, crm, stackoverflow) are full Kovo apps backed by an
in-process PGlite database. For a public demo we want each visitor to drive their
**own** throwaway instance through the **real** server paths (SSR routes, `/_m/*`
mutations) — not the docs site's client-side static replay.

`scripts/demo-session/` provides that: a cookie-keyed dispatcher mints a fresh,
seeded PGlite-backed app-shell per browser session and routes app-owned requests
to it, with idle-TTL + LRU eviction so memory stays bounded (SPEC.md §9.5).

## Topology: one Cloud Run service per example, at the domain root

Live servers assume they are mounted at `/` (absolute `/assets/*`, `/c/*`, route
paths). Hosting several under path prefixes would need URL re-rooting (what the
static export does); for live servers it's far simpler to give **each example its
own service at root**. One Docker image backs all three — pick the example with
the `EXAMPLE` env var.

```bash
PROJECT=your-gcp-project
REGION=us-central1
IMAGE=gcr.io/$PROJECT/kovo-examples

# Build + push once.
gcloud builds submit --tag $IMAGE .

# One service per example. State lives in instance memory, so pin to a single
# instance (no cross-instance session loss) and size RAM for the live session set.
for EX in commerce crm stackoverflow; do
  gcloud run deploy kovo-$EX \
    --image $IMAGE \
    --region $REGION \
    --allow-unauthenticated \
    --set-env-vars EXAMPLE=$EX,KOVO_DEMO_MAX_SESSIONS=40,KOVO_DEMO_IDLE_MS=1200000 \
    --memory 2Gi --cpu 1 \
    --min-instances 1 --max-instances 1 \
    --concurrency 40
done
```

### Why these flags

- **`--max-instances 1`** — each session's PGlite lives in one instance's memory.
  Autoscaling to N instances would route a visitor's later requests to an instance
  that never built their session → blank state. Pinning to one instance avoids that.
  (Alternative: `--session-affinity`, but it's best-effort; one instance is simpler
  for a demo.)
- **`--min-instances 1`** — avoid cold-start wiping all live sessions. Drop to 0 to
  scale to zero and accept that idle redeploys/cold-starts reset state (fine for a demo).
- **`--memory 2Gi` + `KOVO_DEMO_MAX_SESSIONS`** — each PGlite instance holds real
  memory; the LRU cap + idle TTL (`KOVO_DEMO_IDLE_MS`, ms) bound the live set. Tune
  together for your instance size.

## Tuning knobs (env)

| Var | Default | Meaning |
| --- | --- | --- |
| `EXAMPLE` | `commerce` | Which example this service serves |
| `PORT` | `8080` | Listen port (Cloud Run sets this) |
| `HOST` | `0.0.0.0` | Bind address |
| `KOVO_DEMO_MAX_SESSIONS` | `40` | LRU cap on live per-visitor instances |
| `KOVO_DEMO_IDLE_MS` | `1200000` | Idle TTL before a session is evicted (20 min) |

## Local check

```bash
pnpm -C examples/commerce run build           # build /assets once
EXAMPLE=commerce PORT=8080 HOST=127.0.0.1 \
  node examples/commerce/scripts/demo-serve.mjs
# Prove isolation through the real path:
node scripts/demo-session/verify-isolation.mjs
```

## Notes

- The docs site stays static (e.g. GitHub Pages). To make its example panels live,
  point the iframes at these service URLs instead of the embedded static export.
- The commerce `/products?after=` "More" link is a pre-existing stub: it is wired to
  a route the example never implements and 404s on **any** server (see
  `plans/examples-in-docs-site.md`). It is unrelated to tenancy. Wiring a real
  `/products` route (the server-side `renderProductGridPageFragment` already exists)
  would make it work — a separate example-behavior change.
