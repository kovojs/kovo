import { describe, expect, it, vi } from 'vitest';

import { installLoaderQueryRuntime } from './loader-query.js';
import { FakeRoot } from './runtime-test-fakes.js';

// SPEC.md §780: the second bfcache defense is LOADER-LEVEL and must run for every document —
// including a query-less guarded route that configures no query store. Before this fix such a
// route registered zero `pageshow` listeners, so a persisted Safari/WebKit restore presented the
// prior principal's private DOM after logout. installLoaderQueryRuntime always runs (loader.ts
// wires it unconditionally), so it is where the loader-level reload guard is installed.

interface GlobalRecord {
  addEventListener?: unknown;
  removeEventListener?: unknown;
  document?: unknown;
  location?: unknown;
}

function withStubbedGlobals(
  options: { sessionDependent: boolean },
  run: (context: {
    pageShowListeners: Map<string, (event: unknown) => void>;
    reload: ReturnType<typeof vi.fn>;
  }) => void,
): void {
  const globalRecord = globalThis as unknown as GlobalRecord;
  const original = {
    addEventListener: globalRecord.addEventListener,
    removeEventListener: globalRecord.removeEventListener,
    document: globalRecord.document,
    location: globalRecord.location,
  };
  const pageShowListeners = new Map<string, (event: unknown) => void>();
  const reload = vi.fn();

  try {
    globalRecord.addEventListener = (type: string, listener: (event: unknown) => void) => {
      pageShowListeners.set(type, listener);
    };
    globalRecord.removeEventListener = (type: string, listener: (event: unknown) => void) => {
      if (pageShowListeners.get(type) === listener) pageShowListeners.delete(type);
    };
    globalRecord.document = {
      querySelector(selector: string) {
        return selector === 'meta[name="kovo-session"]' && options.sessionDependent
          ? { getAttribute: (name: string) => (name === 'content' ? 'principal-fp' : null) }
          : null;
      },
    };
    globalRecord.location = { reload };

    run({ pageShowListeners, reload });
  } finally {
    for (const key of [
      'addEventListener',
      'removeEventListener',
      'document',
      'location',
    ] as const) {
      if (original[key] === undefined) delete globalRecord[key];
      else globalRecord[key] = original[key];
    }
  }
}

describe('loader query runtime bfcache reload (SPEC §780)', () => {
  it('registers the loader-level pageshow reload for a query-less guarded document', () => {
    withStubbedGlobals({ sessionDependent: true }, ({ pageShowListeners, reload }) => {
      const root = new FakeRoot();

      // Query-less: no queryStore and no queryRefetch — the old code registered no pageshow at all.
      const runtime = installLoaderQueryRuntime({ root });

      // SPEC §780: the second bfcache defense is installed on the global pageshow target even
      // when no query store is configured (a query-less guarded route).
      expect(pageShowListeners.has('pageshow')).toBe(true);
      // The visible-return refetch path stays inert for a query-less route, so nothing lands on root.
      expect(root.listeners.has('pageshow')).toBe(false);

      pageShowListeners.get('pageshow')?.({ persisted: true, type: 'pageshow' });
      expect(reload).toHaveBeenCalledTimes(1);

      reload.mockClear();
      pageShowListeners.get('pageshow')?.({ persisted: false, type: 'pageshow' });
      expect(reload).not.toHaveBeenCalled();

      runtime.dispose();
      expect(pageShowListeners.has('pageshow')).toBe(false);
    });
  });

  it('does not register a reload handler for an anonymous query-less document', () => {
    withStubbedGlobals({ sessionDependent: false }, ({ pageShowListeners, reload }) => {
      installLoaderQueryRuntime({ root: new FakeRoot() });

      // SPEC §780: no kovo-session posture -> the page stays fully bfcache-eligible (no reload).
      expect(pageShowListeners.has('pageshow')).toBe(false);
      expect(reload).not.toHaveBeenCalled();
    });
  });
});
