import { describe, expect, it, vi } from 'vitest';

import { inlineSourceInstallCases, type InlineSourceInstall } from './inline-loader-test-utils.js';

// SPEC.md §780: the inline loader (the production bootstrap shipped in document shells) carries the
// SAME second bfcache defense as the modular loader. A persisted restore (event.persisted) of a
// session-dependent document — one carrying the per-principal kovo-session fingerprint meta that
// document-core stamps only for guarded/session-dependent docs — MUST revalidate with a full server
// reload (location.reload) rather than presenting the prior principal's restored DOM. Anonymous
// documents carry no such meta, so they do not register the reload defense. This drives every
// generated/extracted installer variant so the regenerated inline-loader.ts artifact stays in
// parity. Anonymous documents may still register query-refresh liveness listeners; the bfcache
// reload defense stays gated on the kovo-session meta.

type Listener = (event: unknown) => void | Promise<void>;

function withInstalledInlineLoader(
  options: { sessionDependent: boolean; install: InlineSourceInstall },
  run: (context: { pageShow: Listener | undefined; reload: ReturnType<typeof vi.fn> }) => void,
): void {
  const globalRecord = globalThis as unknown as Record<string, unknown>;
  const originals = {
    addEventListener: globalRecord.addEventListener,
    removeEventListener: globalRecord.removeEventListener,
    document: globalRecord.document,
    location: globalRecord.location,
    importModule: globalRecord.__kovoInlineImport,
  };
  const listeners = new Map<string, Listener>();
  const reload = vi.fn();

  try {
    globalRecord.addEventListener = (type: string, listener: Listener) => {
      listeners.set(type, listener);
    };
    globalRecord.removeEventListener = (type: string, listener: Listener) => {
      if (listeners.get(type) === listener) listeners.delete(type);
    };
    globalRecord.document = {
      querySelector(selector: string) {
        return selector === 'meta[name="kovo-session"]' && options.sessionDependent
          ? { getAttribute: (name: string) => (name === 'content' ? 'principal-fp' : null) }
          : null;
      },
      querySelectorAll() {
        return [];
      },
    };
    globalRecord.location = {
      hash: '',
      href: 'https://kovo.test/',
      origin: 'https://kovo.test',
      pathname: '/',
      reload,
      search: '',
    };

    options.install(async () => ({}), globalRecord);

    // Fire and assert inside the stubbed scope: the inline handler reads the global `location`,
    // which is restored in `finally`.
    run({ pageShow: listeners.get('pageshow'), reload });
  } finally {
    globalRecord.addEventListener = originals.addEventListener;
    globalRecord.removeEventListener = originals.removeEventListener;
    globalRecord.document = originals.document;
    globalRecord.location = originals.location;
    if (originals.importModule === undefined) delete globalRecord.__kovoInlineImport;
    else globalRecord.__kovoInlineImport = originals.importModule;
  }
}

describe.each(inlineSourceInstallCases)(
  'inline loader bfcache reload — %s (SPEC §780)',
  (_label, install) => {
    it('reloads a persisted bfcache restore of a session-dependent document', () => {
      withInstalledInlineLoader({ sessionDependent: true, install }, ({ pageShow, reload }) => {
        // The kovo-session meta is present, so the inline bootstrap registers the pageshow handler.
        expect(pageShow).toBeTypeOf('function');

        pageShow?.({ persisted: true, type: 'pageshow' });
        // SPEC §780: a persisted restore revalidates from the server.
        expect(reload).toHaveBeenCalledTimes(1);

        reload.mockClear();
        // A non-persisted pageshow already ran the loader/sessionProvider — no reload.
        pageShow?.({ persisted: false, type: 'pageshow' });
        expect(reload).not.toHaveBeenCalled();

        // A malformed carrier cannot prove the non-persisted posture, so the
        // session defense fails closed toward a server reload.
        pageShow?.({ type: 'pageshow' });
        expect(reload).toHaveBeenCalledTimes(1);
      });
    });

    it('does not reload a persisted bfcache restore of an anonymous document', () => {
      withInstalledInlineLoader({ sessionDependent: false, install }, ({ pageShow, reload }) => {
        // SPEC §780: anonymous/exportable documents do not install the session reload defense.
        pageShow?.({ persisted: true, type: 'pageshow' });
        pageShow?.({ persisted: false, type: 'pageshow' });
        expect(reload).not.toHaveBeenCalled();
      });
    });
  },
);
