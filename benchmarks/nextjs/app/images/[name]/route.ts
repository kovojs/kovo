import { readFile } from 'node:fs/promises';
import path from 'node:path';

const imageDir = path.join(process.cwd(), '../shared/images');

export async function GET(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
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
}
