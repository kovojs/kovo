# Per-visitor demo image for the interactive Kovo examples (commerce / crm /
# stackoverflow). This is intentionally a hosted demo/dev image: each example is
# served through Vite SSR with a fresh, isolated PGlite-backed instance per
# browser session (scripts/demo-session/, SPEC.md §9.5).
#
# App-author production deploys should use `kovo build` and the generated native
# preset artifacts (`dist/server`, `.vercel/output`, or `dist/cloudflare`)
# instead of this Vite-from-source demo container.
#
# One image serves any one example, chosen at runtime by the EXAMPLE env var, so
# the same image backs three Cloud Run services. Because the runtime is Vite SSR,
# dev dependencies such as vite-plus must stay installed — we do NOT prune to
# production deps.
#
# Build:  docker build -t kovo-examples .
# Run:    docker run -e EXAMPLE=commerce -e KOVO_COMMERCE_CSRF_SECRET=... \
#           -e KOVO_COMMERCE_AUTH_CSRF_SECRET=... -e PORT=8080 -p 8080:8080 kovo-examples
FROM node:24-slim@sha256:c2d5ade763cacfb03fe9cb8e8af5d1be5041ff331921fa26a9b231ca3a4f780a

# The Rust `vp` (vite-plus) binary initializes its HTTPS client from the SYSTEM CA
# trust store at both build and serve time; Debian -slim images ship without it, so
# install ca-certificates or `vp build`/serve panics with "No CA certificates were
# loaded from the system". Kept as an early layer so it caches across source edits.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# corepack pins pnpm per package.json "packageManager".
RUN corepack enable

WORKDIR /app

COPY . .
# pnpm 10 skips unapproved dependency build scripts (you'll see "Ignored build
# scripts: esbuild" on install). esbuild ships its platform binary via an optional
# dep so SSR/build usually works regardless, but we explicitly rebuild it here so
# the linux-x64 binary is guaranteed wired before the example builds run — keeping
# the fix Docker-local instead of changing the monorepo's install semantics.
RUN pnpm install --frozen-lockfile \
  && pnpm rebuild esbuild

# Build each example's client assets (CSS and manifests -> dist/assets/*). The
# per-session demo serve streams SSR from source but serves built /assets/* from
# dist, so the apps render fully styled.
RUN pnpm -C examples/commerce run build:demo \
  && pnpm -C examples/crm run build \
  && pnpm -C examples/stackoverflow run build

RUN chown -R node:node /app

# Cloud Run sends traffic to $PORT and the container must listen on 0.0.0.0.
ENV HOST=0.0.0.0
ENV PORT=8080
ENV NODE_ENV=production
# Default target; override per service: --set-env-vars EXAMPLE=crm|stackoverflow
ENV EXAMPLE=commerce
# Production demo services must set per-example CSRF secrets instead of relying
# on source-level EXAMPLE_ONLY fallbacks.
# Memory guardrails for the per-session PGlite instances (override per service).
ENV KOVO_DEMO_MAX_SESSIONS=40
ENV KOVO_DEMO_WARM_SESSIONS=10
ENV KOVO_DEMO_IDLE_MS=1200000

EXPOSE 8080

USER node

# Shell form so $EXAMPLE expands at container start.
CMD node examples/$EXAMPLE/scripts/demo-serve.mjs
