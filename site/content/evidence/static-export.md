---
title: Static export
description: When a Kovo app can be exported as static HTML and what checks keep the replay honest.
order: 3
---

# Static export

Static export replays route documents and writes the result to files. It is useful for docs and
content-heavy apps, but it is not a second runtime model. The source note is
[`docs/static-export.md`](https://github.com/kovojs/kovo/blob/main/docs/static-export.md); this page
summarizes the public decision points.

## Use static export when

- Routes can be enumerated at build time.
- The app does not require mutation handling on the deployed host.
- Every emitted asset and client module can be served from the static output.
- Dynamic example apps are either excluded or hosted as separate services.

## Keep a server when

- Mutations, authenticated reads, or machine ingress must run at request time.
- Route paths depend on data that is not available during export.
- You need live query transports or deploy-skew recovery against prior query tokens.

## Checks to run

The site export path exercises the same route data as the Kovo app:

```sh
pnpm --filter @kovojs/site run build
pnpm --filter @kovojs/site run check:links
pnpm --filter @kovojs/site run smoke:navigation
```

For app projects, pair static export with the graph checks from [Testing with @kovojs/test](/guides/testing/)
and [Reading kovo check & kovo explain](/guides/kovo-explain/). If a route cannot be replayed
faithfully, keep it on the server path.
