# Static Cloud Run image for the Kovo docs site.
#
# Build from the repository root so pnpm workspaces resolve:
#   docker build -f site/Dockerfile -t kovo-docs .
# Run:
#   docker run -e PORT=8080 -p 8080:8080 kovo-docs
FROM node:24-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable

WORKDIR /app

COPY . .

RUN pnpm install --frozen-lockfile \
  && pnpm rebuild esbuild \
  && pnpm --filter @kovojs/site run build

ENV HOST=0.0.0.0
ENV PORT=8080
ENV NODE_ENV=production

EXPOSE 8080

CMD ["node", "site/scripts/serve-static.mjs", "--strictPort"]
