import { describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import { guards } from './guards.js';
import { route } from './route.js';

type SessionShape = { session?: { user?: { id: string } | null } | null };

describe('app diagnostics — prefetch guard gate (bugs-1 F36 / KV419)', () => {
  it('flags prefetch:"moderate" on a guarded route, not on public or conservative routes', () => {
    const app = createApp({
      routes: [
        route('/admin', {
          guard: guards.authed<SessionShape>(),
          prefetch: 'moderate',
          page: () => '<main>admin</main>',
        }),
        // public + moderate is fine (idempotent, not session-dependent)
        route('/public', { prefetch: 'moderate', page: () => '<main>public</main>' }),
        // guarded + conservative is fine (no prerender)
        route('/account', {
          guard: guards.authed<SessionShape>(),
          prefetch: 'conservative',
          page: () => '<main>account</main>',
        }),
      ],
    });

    const kv419 = app.diagnostics.filter((diagnostic) => diagnostic.code === 'KV419');
    expect(kv419).toHaveLength(1);
    expect(kv419[0]?.fileName).toBe('/admin');
    expect(kv419[0]?.message).toContain('prefetch');
  });

  it('produces no KV419 when no route mixes a guard with prefetch:"moderate"', () => {
    const app = createApp({
      routes: [route('/', { prefetch: 'conservative', page: () => '<main>home</main>' })],
    });
    expect(app.diagnostics.filter((diagnostic) => diagnostic.code === 'KV419')).toHaveLength(0);
  });
});
