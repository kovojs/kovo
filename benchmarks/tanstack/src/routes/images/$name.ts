import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { createFileRoute } from '@tanstack/react-router';

const imageDir = path.join(process.cwd(), '../shared/images');

// The call shape below must stay EXACTLY `createFileRoute('<path>')({ ... })`.
//
// TanStack Start's Vite plugin strips the `server` block out of the client bundle by matching that
// call shape in the AST. This file previously read `(createFileRoute('/images/$name') as any)({...})`
// to silence the type error below, and the parenthesized `as` expression stopped the plugin from
// matching — so `server.handlers` stayed in the client graph, `node:fs/promises` was externalized to
// `__vite-browser-external`, and the build died with:
//
//   "readFile" is not exported by "__vite-browser-external", imported by src/routes/images/$name.ts
//
// Suppress the type error at the property instead of casting the call, so the entrant keeps
// building. `server` is a real runtime option in @tanstack/react-start 1.168.26 but is not in the
// generated route-options type; if TanStack types it, this directive fails loudly and can be
// deleted. Recorded in plans/good-perf.md O15 ("Repair or retire the TanStack entrant").
export const Route = createFileRoute('/images/$name')({
  // @ts-expect-error -- see above: runtime-supported server route options are missing from the type.
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const pathname = new URL(request.url).pathname;
        const name = decodeURIComponent(pathname.slice(pathname.lastIndexOf('/') + 1));
        if (!/^product-\d\d\.webp$/.test(name)) {
          return new Response('not found', { status: 404 });
        }
        const body = await readFile(path.join(imageDir, name));
        return new Response(body, {
          headers: {
            'Cache-Control': 'public, max-age=31536000, immutable',
            'Content-Type': 'image/webp',
          },
        });
      },
    },
  },
});
