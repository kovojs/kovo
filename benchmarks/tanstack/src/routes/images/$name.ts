import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { createFileRoute } from '@tanstack/react-router';

const imageDir = path.join(process.cwd(), '../shared/images');

export const Route = (createFileRoute('/images/$name') as any)({
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
