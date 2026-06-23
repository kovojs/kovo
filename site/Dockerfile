# Static Cloud Run image for the Kovo docs site.
#
# Build from the repository root so pnpm workspaces resolve:
#   docker build -f site/Dockerfile -t kovo-docs .
# Run:
#   docker run -e PORT=8080 -p 8080:8080 kovo-docs
FROM node:24-slim@sha256:c2d5ade763cacfb03fe9cb8e8af5d1be5041ff331921fa26a9b231ca3a4f780a

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable

WORKDIR /app

COPY . .

RUN pnpm install --frozen-lockfile \
  && pnpm rebuild esbuild \
  && pnpm --filter @kovojs/site run build

RUN chown -R node:node /app

ENV HOST=0.0.0.0
ENV PORT=8080
ENV NODE_ENV=production

EXPOSE 8080

USER node

CMD ["node", "site/scripts/serve-static.mjs", "--strictPort"]
