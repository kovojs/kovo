# Per-visitor demo image for the interactive Kovo examples (commerce / crm /
# stackoverflow). Each example is served through its REAL server paths via Vite
# SSR (the framework serves SSR at runtime — see examples/*/scripts/serve.mjs),
# with a fresh, isolated PGlite-backed instance per browser session
# (scripts/demo-session/, SPEC.md §9.5).
#
# One image serves any one example, chosen at runtime by the EXAMPLE env var, so
# the same image backs three Cloud Run services. Because the runtime is Vite SSR,
# dev dependencies (vite-plus, tailwind) must stay installed — we do NOT prune to
# production deps.
#
# Build:  docker build -t kovo-examples .
# Run:    docker run -e EXAMPLE=commerce -e PORT=8080 -p 8080:8080 kovo-examples
FROM node:24-slim

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

# Build each example's client assets (Tailwind CSS -> dist/assets/*). The
# per-session demo serve streams SSR from source but serves built /assets/* from
# dist, so the apps render fully styled.
RUN pnpm -C examples/commerce run build \
  && pnpm -C examples/crm run build \
  && pnpm -C examples/stackoverflow run build

# Cloud Run sends traffic to $PORT and the container must listen on 0.0.0.0.
ENV HOST=0.0.0.0
ENV PORT=8080
ENV NODE_ENV=production
# Default target; override per service: --set-env-vars EXAMPLE=crm|stackoverflow
ENV EXAMPLE=commerce
# Memory guardrails for the per-session PGlite instances (override per service).
ENV KOVO_DEMO_MAX_SESSIONS=40
ENV KOVO_DEMO_IDLE_MS=1200000

EXPOSE 8080

# Shell form so $EXAMPLE expands at container start.
CMD node examples/$EXAMPLE/scripts/demo-serve.mjs
