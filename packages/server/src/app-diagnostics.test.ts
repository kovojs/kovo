import { describe, expect, it } from 'vitest';
import { trustedHtml } from '@kovojs/browser';

import { createApp } from './app.js';
import { publicAccess } from './access.js';
import { guards } from './guards.js';
import { route } from './route.js';

type SessionShape = { session?: { user?: { id: string } | null } | null };

describe('app diagnostics — prefetch guard gate (bugs-1 F36 / KV419)', () => {
  it('flags prefetch:"moderate" on a guarded route, not on public or conservative routes', () => {
    const app = createApp({
      routes: [
        route('/admin', {
          access: publicAccess('test admin page'),
          guard: guards.authed<SessionShape>(),
          prefetch: 'moderate',
          page: () => trustedHtml('<main>admin</main>'),
        }),
        // public + moderate is fine (idempotent, not session-dependent)
        route('/public', {
          access: publicAccess('public test page'),
          prefetch: 'moderate',
          page: () => trustedHtml('<main>public</main>'),
        }),
        // guarded + conservative is fine (no prerender)
        route('/account', {
          access: publicAccess('test account page'),
          guard: guards.authed<SessionShape>(),
          prefetch: 'conservative',
          page: () => trustedHtml('<main>account</main>'),
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
      routes: [
        route('/', {
          access: publicAccess('test home page'),
          prefetch: 'conservative',
          page: () => trustedHtml('<main>home</main>'),
        }),
      ],
    });
    expect(app.diagnostics.filter((diagnostic) => diagnostic.code === 'KV419')).toHaveLength(0);
  });

  // I3 (ROUTING-NAV-3 / SPEC §8:756): prefetchJustification hatch suppresses KV419.
  it('suppresses KV419 when a non-empty prefetchJustification is supplied (I3a)', () => {
    const app = createApp({
      routes: [
        route('/admin', {
          access: publicAccess('test admin page'),
          guard: guards.authed<SessionShape>(),
          prefetch: 'moderate',
          prefetchJustification: 'Route is read-only; render is safe for credentialed prerender.',
          page: () => trustedHtml('<main>admin</main>'),
        }),
      ],
    });
    expect(app.diagnostics.filter((diagnostic) => diagnostic.code === 'KV419')).toHaveLength(0);
  });

  // I3b: guarded + moderate + no justification → still one KV419.
  it('flags KV419 for guarded + moderate when prefetchJustification is absent (I3b)', () => {
    const app = createApp({
      routes: [
        route('/dashboard', {
          access: publicAccess('test dashboard page'),
          guard: guards.authed<SessionShape>(),
          prefetch: 'moderate',
          page: () => trustedHtml('<main>dashboard</main>'),
        }),
      ],
    });
    const kv419 = app.diagnostics.filter((diagnostic) => diagnostic.code === 'KV419');
    expect(kv419).toHaveLength(1);
    expect(kv419[0]?.fileName).toBe('/dashboard');
  });

  // I3c: limitation note — session-dependence without a guard is not detectable from
  // the static route definition; an unguarded route reading session data is NOT flagged.
  // This test documents the known limitation rather than claiming full SPEC §8:756 coverage.
  it('does NOT flag KV419 for an unguarded moderate route (I3c — known limitation: session-dep detection requires guard)', () => {
    const app = createApp({
      routes: [
        // No guard, but in a real app this page might read session data internally.
        route('/feed', {
          access: publicAccess('test public feed'),
          prefetch: 'moderate',
          page: () => trustedHtml('<main>public feed</main>'),
        }),
      ],
    });
    // Current implementation can only detect session-dependence via guard presence;
    // unguarded routes are not flagged even if they are session-dependent.
    expect(app.diagnostics.filter((diagnostic) => diagnostic.code === 'KV419')).toHaveLength(0);
  });

  it('emits KV436 for missing explicit access decisions without using guards as a substitute', () => {
    const app = createApp({
      routes: [
        route('/guarded-missing-access', {
          guard: guards.authed<SessionShape>(),
          page: () => trustedHtml('<main>guarded</main>'),
        } as any),
      ],
    });

    const kv436 = app.diagnostics.filter((diagnostic) => diagnostic.code === 'KV436');
    expect(kv436).toHaveLength(1);
    expect(kv436[0]?.fileName).toBe('/guarded-missing-access');
  });
});
