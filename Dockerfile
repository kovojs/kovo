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

# git is occasionally needed by install scripts; corepack pins pnpm per
# package.json "packageManager".
RUN corepack enable

WORKDIR /app

# Install first against just the manifests so the dependency layer caches across
# source-only changes.
COPY . .
RUN pnpm install --frozen-lockfile

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
