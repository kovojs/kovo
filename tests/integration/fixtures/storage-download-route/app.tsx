// plans/open-design-areas.md storage capability floor: a storage-backed download route authorizes by app data first,
// then serves bytes through the swappable StorageCapability.
import { createMemoryStorage } from '@kovojs/core';
import { createApp, guards, notFound, respond, route, s } from '@kovojs/server';
import { defineFixture, type KovoFixtureRequest } from '@kovojs/test/integration/define';

interface StorageSession {
  user: { id: string; roles: readonly string[] };
}
type StorageRequest = KovoFixtureRequest & { session?: StorageSession | null };

interface FileRow {
  [key: string]: unknown;
  filename: string;
  owner_id: string;
  storage_key: string;
}

let storage = createMemoryStorage({ now: () => new Date('2026-06-16T12:00:00.000Z') });

function readSessionCookie(request: Request): StorageSession | null {
  const raw = request.headers.get('cookie') ?? '';
  const entry = raw
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('storage_user='));
  if (!entry) return null;

  const id = decodeURIComponent(entry.slice('storage_user='.length));
  return id ? { user: { id, roles: [] } } : null;
}

const downloadRoute = route('/files/download', {
  guard: guards.authed<StorageRequest>(),
  search: s.object({ key: s.string() }),
  async page({ search }, request: StorageRequest) {
    const [row] = await request.db.query<FileRow>(
      'select owner_id, storage_key, filename from files where storage_key = $1',
      [search.key],
    );
    if (!row || row.owner_id !== request.session?.user.id) return notFound();

    let stored: Awaited<ReturnType<typeof storage.stream>>;
    try {
      stored = await storage.stream(row.storage_key);
    } catch {
      return notFound();
    }
    if (!stored) return notFound();

    return respond.stream(stored.body, {
      contentType: stored.contentType ?? 'application/octet-stream',
      etag: stored.etag,
      filename: row.filename,
    });
  },
});

export default defineFixture({
  app: createApp<StorageSession>({
    routes: [downloadRoute],
    sessionProvider: (request) => readSessionCookie(request),
  }),
  schema: `create table files (
    storage_key text primary key,
    owner_id text not null,
    filename text not null
  )`,
  seed: async (db) => {
    storage = createMemoryStorage({ now: () => new Date('2026-06-16T12:00:00.000Z') });
    await storage.put('receipts/u1/order-1.txt', 'paid by u1\n', {
      contentType: 'text/plain; charset=utf-8',
      etag: '"receipt-u1-v1"',
      metadata: { owner: 'u1' },
    });
    await storage.put('receipts/u2/order-2.txt', 'paid by u2\n', {
      contentType: 'text/plain; charset=utf-8',
      etag: '"receipt-u2-v1"',
      metadata: { owner: 'u2' },
    });
    await db.write('files', {
      filename: 'order-1.txt',
      owner_id: 'u1',
      storage_key: 'receipts/u1/order-1.txt',
    });
    await db.write('files', {
      filename: 'order-2.txt',
      owner_id: 'u2',
      storage_key: 'receipts/u2/order-2.txt',
    });
    await db.write('files', {
      filename: 'escape.txt',
      owner_id: 'u1',
      storage_key: '../escape.txt',
    });
  },
});
